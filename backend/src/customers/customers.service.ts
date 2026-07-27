import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    UnauthorizedException,
    Optional,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { Customer } from '../entities/customer.entity';
import {
    validatePakistaniPhone,
    normalizePakistaniPhone,
} from '../utils/phone';
import { PromotionsService } from '../promotions/promotions.service';
import { CouponsService } from '../coupons/coupons.service';
import { CustomerSource } from './customer-sources';

/**
 * Union `add` into `current` brand-id list (deduped). Returns the new array, or
 * `undefined` when nothing changed (so callers can skip a save). `add` empty/null
 * (e.g. owner/GM) is a no-op.
 */
function mergeBrandIds(
    current: number[] | null | undefined,
    add: number[] | null | undefined,
): number[] | undefined {
    if (add == null || add.length === 0) return undefined;
    const set = new Set<number>((current ?? []).map(Number));
    let changed = false;
    for (const id of add) {
        const n = Number(id);
        if (!set.has(n)) {
            set.add(n);
            changed = true;
        }
    }
    return changed ? [...set] : undefined;
}

/** Postgres unique-violation (e.g. the consumer phone partial unique index). */
function isUniqueViolation(e: unknown): boolean {
    const err = e as { code?: string; driverError?: { code?: string } };
    return err?.code === '23505' || err?.driverError?.code === '23505';
}

@Injectable()
export class CustomersService {
    private readonly logger = new Logger(CustomersService.name);

    constructor(
        @InjectRepository(Customer) private repo: Repository<Customer>,
        private dataSource: DataSource,
        @Optional() private promotionsService: PromotionsService,
        @Optional() private couponsService: CouponsService,
    ) {}

    /**
     * Admin listing must be tenant-scoped.
     * - tenant users: only their tenant's customers
     * - super admin (tenantId null): all customers
     * - brand-locked users: only customers who have ordered from their brand
     */
    async findAll(tenantId: number | null, allowedBrandIds?: number[] | null) {
        if (allowedBrandIds != null) {
            // Brand-locked: customers who ordered from their brand(s) OR are
            // explicitly associated via brand_ids (manual add / link).
            const qb = this.repo
                .createQueryBuilder('c')
                .where(
                    `(EXISTS (SELECT 1 FROM orders o
                              WHERE o.customer_id = c.id AND o.brand_id IN (:...allowedBrandIds))
                      OR EXISTS (SELECT 1
                                 FROM jsonb_array_elements_text(COALESCE(c.brand_ids, '[]'::jsonb)) e
                                 WHERE (e)::int IN (:...allowedBrandIds)))`,
                    { allowedBrandIds },
                )
                // Newest first: a just-registered customer lands at the top.
                .orderBy('c.id', 'DESC');
            if (tenantId != null)
                qb.andWhere('c.tenantId = :tenantId', { tenantId });
            const customers = await qb.getMany();
            return this.attachLoyaltyWallets(customers, allowedBrandIds);
        }

        // Owner / unrestricted: return all customers with brand badges
        const customers = await this.repo.find({
            where: tenantId != null ? { tenantId } : {},
            // Newest first: a just-registered customer lands at the top.
            order: { id: 'DESC' },
        });
        if (!customers.length) return customers;

        const brandRows = await this.dataSource.query<
            { customer_id: number; id: number; name: string }[]
        >(
            `SELECT DISTINCT o.customer_id, b.id, b.name
             FROM orders o
             JOIN brands b ON b.id = o.brand_id
             WHERE o.customer_id = ANY($1)`,
            [customers.map((c) => c.id)],
        );

        const brandMap = new Map<number, { id: number; name: string }[]>();
        for (const row of brandRows) {
            if (!brandMap.has(row.customer_id))
                brandMap.set(row.customer_id, []);
            brandMap.get(row.customer_id)!.push({ id: row.id, name: row.name });
        }

        // Resolve names for explicitly-associated brands (brand_ids) so a
        // manually-added customer with no orders yet still shows a brand badge.
        const assocBrandIds = new Set<number>();
        for (const c of customers)
            for (const bid of c.brandIds ?? []) assocBrandIds.add(Number(bid));
        const brandNameMap = new Map<number, string>();
        if (assocBrandIds.size) {
            const nameRows = await this.dataSource.query<
                { id: number; name: string }[]
            >(`SELECT id, name FROM brands WHERE id = ANY($1)`, [
                [...assocBrandIds],
            ]);
            for (const r of nameRows) brandNameMap.set(Number(r.id), r.name);
        }

        const withBrands = customers.map((c) => {
            const fromOrders = brandMap.get(c.id) ?? [];
            const seen = new Set(fromOrders.map((b) => b.id));
            const fromAssoc = (c.brandIds ?? [])
                .map(Number)
                .filter((id) => !seen.has(id) && brandNameMap.has(id))
                .map((id) => ({ id, name: brandNameMap.get(id)! }));
            return { ...c, brands: [...fromOrders, ...fromAssoc] };
        });
        return this.attachLoyaltyWallets(withBrands, null);
    }

    /**
     * Attach per-wallet loyalty balances (+ a total) to admin customer rows.
     * Brand-locked admins only see POS wallets for their brands; the shared APP
     * wallet is cross-brand so it is hidden from them.
     */
    private async attachLoyaltyWallets<T extends { id: number }>(
        customers: T[],
        allowedBrandIds: number[] | null,
    ): Promise<
        Array<
            T & {
                loyaltyPointsBalance: number;
                loyaltyWallets: Array<{
                    wallet_type: 'pos' | 'app';
                    brand_id: number | null;
                    brand_name: string | null;
                    balance: number;
                }>;
            }
        >
    > {
        if (!customers.length) return customers as never;
        const rows = await this.dataSource.query<
            {
                customer_id: number;
                wallet_type: 'pos' | 'app';
                brand_id: number | null;
                brand_name: string | null;
                balance: number;
            }[]
        >(
            `SELECT w.customer_id, w.wallet_type, w.brand_id, w.balance, b.name AS brand_name
             FROM loyalty_wallets w
             LEFT JOIN brands b ON b.id = w.brand_id
             WHERE w.customer_id = ANY($1) AND w.balance > 0`,
            [customers.map((c) => c.id)],
        );
        const walletMap = new Map<
            number,
            Array<{
                wallet_type: 'pos' | 'app';
                brand_id: number | null;
                brand_name: string | null;
                balance: number;
            }>
        >();
        for (const r of rows) {
            // Hide the shared APP wallet and other-brand POS wallets from brand-locked admins.
            if (
                allowedBrandIds != null &&
                (r.wallet_type !== 'pos' ||
                    r.brand_id == null ||
                    !allowedBrandIds.includes(r.brand_id))
            ) {
                continue;
            }
            const list = walletMap.get(r.customer_id) ?? [];
            list.push({
                wallet_type: r.wallet_type,
                brand_id: r.brand_id,
                brand_name: r.brand_name,
                balance: Number(r.balance),
            });
            walletMap.set(r.customer_id, list);
        }
        return customers.map((c) => {
            const wallets = walletMap.get(c.id) ?? [];
            return {
                ...c,
                loyaltyWallets: wallets,
                loyaltyPointsBalance: wallets.reduce(
                    (sum, w) => sum + w.balance,
                    0,
                ),
            };
        });
    }

    async findOne(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        const customer = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
        });
        if (!customer) throw new NotFoundException('Customer not found');
        if (allowedBrandIds != null) {
            // Visible if they ordered from the admin's brand OR are explicitly
            // associated via brand_ids (matches findAll's union).
            const rows = await this.dataSource.query<unknown[]>(
                `SELECT 1
                 WHERE EXISTS (SELECT 1 FROM orders o
                               WHERE o.customer_id = $1 AND o.brand_id = ANY($2::int[]))
                    OR EXISTS (SELECT 1
                               FROM jsonb_array_elements_text(
                                    COALESCE((SELECT brand_ids FROM customers WHERE id = $1), '[]'::jsonb)) e
                               WHERE (e)::int = ANY($2::int[]))
                 LIMIT 1`,
                [customer.id, allowedBrandIds],
            );
            if (rows.length === 0) {
                throw new NotFoundException('Customer not found');
            }
        }
        return customer;
    }

    /** Find customer by id only (for JWT validation). */
    async findById(id: number): Promise<Customer | null> {
        return this.repo.findOne({ where: { id } });
    }

    async findByEmail(email: string): Promise<Customer | null> {
        const trimmed =
            typeof email === 'string' ? email.trim().toLowerCase() : '';
        if (!trimmed) return null;
        return this.repo.findOne({ where: { email: trimmed } });
    }

    async findByPhone(tenantId: number, phone: string) {
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) return null;
        return this.repo.findOne({ where: { tenantId, phone: normalized } });
    }

    /**
     * Find a consumer by phone. When `tenantId` is provided (consumer app/web
     * now register under the deployment's fixed tenant), scopes the lookup to
     * that tenant. When omitted, falls back to legacy unlinked consumers
     * (tenant_id IS NULL).
     */
    async findConsumerByPhone(
        phone: string,
        tenantId?: number | null,
    ): Promise<Customer | null> {
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) return null;
        return this.repo.findOne({
            where:
                tenantId != null
                    ? { phone: normalized, tenantId }
                    : { phone: normalized, tenantId: IsNull() },
        });
    }

    /** Validate and normalize Pakistani phone; throw if invalid. */
    validateAndNormalizePhone(phone: string): string {
        try {
            return validatePakistaniPhone(phone);
        } catch {
            throw new BadRequestException(
                'Invalid Pakistani phone number. Use format: 03XXXXXXXXX (e.g. 03001234567)',
            );
        }
    }

    async create(
        tenantId: number,
        dto: {
            phone: string;
            name: string;
            email?: string | null;
            password?: string | null;
        },
        allowedBrandIds?: number[] | null,
        link?: boolean,
        /** Where the record came from; staff-created rows are 'pos'. */
        source: CustomerSource = 'pos',
    ) {
        const name = dto.name?.trim();
        if (!name) {
            throw new BadRequestException('Customer name is required');
        }
        const phone = this.validateAndNormalizePhone(dto.phone);
        const existing = await this.repo.findOne({
            where: { tenantId, phone },
        });
        if (existing) {
            // Create-or-link: a brand-locked admin adding a phone that already
            // belongs to a sibling brand can link (associate) it to their own
            // brand instead of being blocked. Owner/GM (allowedBrandIds == null)
            // can already see/select everyone, so they just get the conflict.
            if (allowedBrandIds != null && link) {
                const merged = mergeBrandIds(
                    existing.brandIds,
                    allowedBrandIds,
                );
                if (merged !== undefined) {
                    existing.brandIds = merged;
                    await this.repo.save(existing);
                }
                return Object.assign(existing, { linked: true });
            }
            throw new ConflictException({
                message: 'Customer with this phone already exists',
                existing: { id: existing.id, name: existing.name },
            });
        }
        const email =
            typeof dto.email === 'string'
                ? dto.email.trim().toLowerCase() || null
                : null;
        if (email) {
            const existingEmail = await this.repo.findOne({
                where: { email },
            });
            if (existingEmail)
                throw new ConflictException(
                    'Customer with this email already exists',
                );
        }
        let passwordHash: string | null = null;
        if (typeof dto.password === 'string' && dto.password.trim()) {
            passwordHash = await bcrypt.hash(dto.password.trim(), 10);
        }
        return this.repo.save(
            this.repo.create({
                tenantId,
                phone,
                name,
                email: email ?? null,
                password: passwordHash,
                loyaltyPointsBalance: 0,
                source,
                // Brand-locked admin → associate their brand(s); owner/GM → null.
                brandIds: allowedBrandIds ?? null,
            }),
        );
    }

    /** Consumer register: no tenant linkage. Creates customer with tenantId = null. */
    async createForConsumer(
        tenantId: number | null,
        dto: {
            phone: string;
            name: string;
            email?: string | null;
            password: string;
            phoneVerified?: boolean;
        },
        /** Consumer client that registered them (from x-client-platform). */
        source: CustomerSource = 'consumer_app',
    ) {
        const name = dto.name?.trim();
        if (!name) {
            throw new BadRequestException('Customer name is required');
        }
        // Email is optional now that phone is the primary identifier.
        const email =
            typeof dto.email === 'string'
                ? dto.email.trim().toLowerCase() || null
                : null;
        const password =
            typeof dto.password === 'string' ? dto.password.trim() : '';
        if (!password) {
            throw new BadRequestException('Password is required');
        }
        const phone = this.validateAndNormalizePhone(dto.phone);
        const whereConsumer =
            tenantId == null
                ? { phone, tenantId: IsNull() }
                : { tenantId, phone };
        const existing = await this.repo.findOne({ where: whereConsumer });
        if (existing)
            throw new ConflictException(
                'Customer with this phone already exists',
            );
        if (email) {
            const existingEmail = await this.repo.findOne({
                where: { email },
            });
            if (existingEmail)
                throw new ConflictException(
                    'Customer with this email already exists',
                );
        }
        const passwordHash = await bcrypt.hash(password, 10);
        let customer: Customer;
        try {
            customer = await this.repo.save(
                this.repo.create({
                    tenantId: tenantId ?? null,
                    phone,
                    name,
                    email,
                    password: passwordHash,
                    phoneVerified: dto.phoneVerified ?? false,
                    loyaltyPointsBalance: 0,
                    source,
                }),
            );
        } catch (e) {
            // Race between the app-level check above and the DB unique index.
            if (isUniqueViolation(e)) {
                throw new ConflictException(
                    'Customer with this phone already exists',
                );
            }
            throw e;
        }
        // Assign any active, in-window new_customer promotions. Awaited but
        // non-fatal so a promo hiccup never blocks signup, and the reward is
        // present the moment the customer opens their promotions list.
        if (tenantId != null && this.promotionsService) {
            try {
                await this.promotionsService.assignNewCustomerPromotions(
                    tenantId,
                    customer.id,
                );
            } catch (err) {
                this.logger.warn(
                    `Promotion auto-assign failed for customer ${customer.id}`,
                    err as Error,
                );
            }
        }
        // New model: mint vouchers for audience='new_customer' coupons.
        if (tenantId != null && this.couponsService) {
            try {
                await this.couponsService.awardNewCustomerVouchers(
                    tenantId,
                    customer.id,
                );
            } catch (err) {
                this.logger.warn(
                    `New-customer voucher award failed for customer ${customer.id}`,
                    err as Error,
                );
            }
        }
        return customer;
    }

    /**
     * Validate a consumer by phone and password. Pass `tenantId` to scope the
     * lookup to the deployment's consumer tenant (see findConsumerByPhone).
     * Legacy rows created at POS have no password and correctly fail here —
     * such users must set a password via the SMS password-reset flow first.
     */
    async validateCustomerByPhone(
        phone: string,
        password: string,
        tenantId?: number | null,
    ): Promise<Customer> {
        const customer = await this.findConsumerByPhone(phone, tenantId);
        if (!customer || !customer.password) {
            throw new UnauthorizedException('Invalid phone or password');
        }
        const ok = await bcrypt.compare(
            typeof password === 'string' ? password : '',
            customer.password,
        );
        if (!ok) {
            throw new UnauthorizedException('Invalid phone or password');
        }
        return customer;
    }

    /** Update customer location (consumer app). */
    async updateLocation(
        id: number,
        latitude: number,
        longitude: number,
    ): Promise<Customer> {
        const customer = await this.repo.findOne({ where: { id } });
        if (!customer) throw new NotFoundException('Customer not found');
        customer.latitude = latitude;
        customer.longitude = longitude;
        await this.repo.save(customer);
        return this.repo.findOne({ where: { id } }) as Promise<Customer>;
    }

    async update(
        id: number,
        tenantId: number | null,
        dto: {
            name?: string;
            email?: string | null;
            profile_image_url?: string | null;
        },
        allowedBrandIds?: number[] | null,
    ) {
        if (allowedBrandIds != null) {
            await this.findOne(id, tenantId, allowedBrandIds);
        }
        const customer = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
        });
        if (!customer) throw new NotFoundException('Customer not found');
        if (dto.name !== undefined) {
            const name = dto.name?.trim();
            if (!name)
                throw new BadRequestException('Customer name is required');
            customer.name = name;
        }
        if (dto.email !== undefined) {
            const email =
                typeof dto.email === 'string'
                    ? dto.email.trim().toLowerCase() || null
                    : null;
            if (email) {
                const existing = await this.repo.findOne({
                    where: { email },
                });
                if (existing && existing.id !== id)
                    throw new ConflictException(
                        'Another customer already has this email',
                    );
            }
            customer.email = email;
        }
        if (dto.profile_image_url !== undefined) {
            customer.profileImageUrl = dto.profile_image_url ?? null;
        }
        await this.repo.save(customer);
        return this.findOne(id, tenantId);
    }

    /** Set password for a customer (e.g. after OTP verify). */
    async setPassword(customerId: number, newPassword: string) {
        const customer = await this.repo.findOne({
            where: { id: customerId },
        });
        if (!customer) throw new NotFoundException('Customer not found');
        const trimmed =
            typeof newPassword === 'string' ? newPassword.trim() : '';
        if (!trimmed) throw new BadRequestException('Password is required');
        customer.password = await bcrypt.hash(trimmed, 10);
        await this.repo.save(customer);
        return { message: 'Password updated' };
    }

    async remove(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ): Promise<void> {
        if (allowedBrandIds != null) {
            await this.findOne(id, tenantId, allowedBrandIds);
        }
        const customer = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
        });
        if (!customer) throw new NotFoundException('Customer not found');
        await this.repo.remove(customer);
    }

    /**
     * Self-service account deletion (consumer app / App Store requirement).
     * Removes the customer row; orders keep historical customer_name/phone with customer_id set null.
     */
    async deleteConsumerAccount(
        customerId: number,
        password: string,
    ): Promise<{ profileImageUrl: string | null }> {
        const customer = await this.repo.findOne({ where: { id: customerId } });
        if (!customer) throw new NotFoundException('Customer not found');
        if (!customer.password) {
            throw new BadRequestException(
                'This account has no password set. Contact support to delete your account.',
            );
        }
        const trimmed = typeof password === 'string' ? password : '';
        if (!trimmed) {
            throw new BadRequestException('password is required');
        }
        const ok = await bcrypt.compare(trimmed, customer.password);
        if (!ok) {
            throw new UnauthorizedException('Invalid password');
        }
        const profileImageUrl = customer.profileImageUrl ?? null;
        await this.repo.remove(customer);
        return { profileImageUrl };
    }

    /**
     * Merge a consumer row (tenantId null) into an existing tenant-scoped customer.
     * Reassigns FKs, combines loyalty balance, copies login profile fields, deletes consumer.
     */
    async mergeConsumerIntoTenantCustomer(
        consumerId: number,
        tenantCustomerId: number,
    ): Promise<Customer> {
        if (consumerId === tenantCustomerId) {
            const row = await this.repo.findOne({
                where: { id: tenantCustomerId },
            });
            if (!row) throw new NotFoundException('Customer not found');
            return row;
        }

        const qr = this.dataSource.createQueryRunner();
        await qr.connect();
        await qr.startTransaction();
        try {
            const consumer = await qr.manager.findOne(Customer, {
                where: { id: consumerId },
            });
            const tenantCustomer = await qr.manager.findOne(Customer, {
                where: { id: tenantCustomerId },
            });
            if (!consumer || !tenantCustomer) {
                throw new NotFoundException('Customer not found');
            }
            if (consumer.tenantId != null) {
                throw new BadRequestException(
                    'Only consumer accounts can be merged into tenant customers',
                );
            }
            if (tenantCustomer.tenantId == null) {
                throw new BadRequestException(
                    'Target customer must belong to a tenant',
                );
            }

            const absorbEmail =
                typeof consumer.email === 'string'
                    ? consumer.email.trim().toLowerCase()
                    : null;
            if (absorbEmail) {
                consumer.email = null;
                await qr.manager.save(consumer);
            }
            if (
                absorbEmail &&
                (!tenantCustomer.email || tenantCustomer.email.trim() === '')
            ) {
                const emailTaken = await qr.manager
                    .createQueryBuilder(Customer, 'c')
                    .where('LOWER(TRIM(c.email)) = :email', {
                        email: absorbEmail,
                    })
                    .andWhere('c.id != :tenantCustomerId', {
                        tenantCustomerId,
                    })
                    .getOne();
                if (!emailTaken) {
                    tenantCustomer.email = absorbEmail;
                }
            }

            if (!tenantCustomer.password && consumer.password) {
                tenantCustomer.password = consumer.password;
            }
            if (
                (!tenantCustomer.name || tenantCustomer.name.trim() === '') &&
                consumer.name?.trim()
            ) {
                tenantCustomer.name = consumer.name.trim();
            }
            if (!tenantCustomer.profileImageUrl && consumer.profileImageUrl) {
                tenantCustomer.profileImageUrl = consumer.profileImageUrl;
            }
            if (tenantCustomer.latitude == null && consumer.latitude != null) {
                tenantCustomer.latitude = consumer.latitude;
            }
            if (
                tenantCustomer.longitude == null &&
                consumer.longitude != null
            ) {
                tenantCustomer.longitude = consumer.longitude;
            }
            tenantCustomer.loyaltyPointsBalance =
                (tenantCustomer.loyaltyPointsBalance || 0) +
                (consumer.loyaltyPointsBalance || 0);
            tenantCustomer.phone =
                normalizePakistaniPhone(consumer.phone) ?? tenantCustomer.phone;

            await qr.manager.save(tenantCustomer);

            await qr.manager.query(
                `UPDATE orders SET customer_id = $1 WHERE customer_id = $2`,
                [tenantCustomerId, consumerId],
            );
            await qr.manager.query(
                `UPDATE loyalty_transactions SET customer_id = $1 WHERE customer_id = $2`,
                [tenantCustomerId, consumerId],
            );
            await qr.manager.query(
                `UPDATE rider_order_ratings SET customer_id = $1 WHERE customer_id = $2`,
                [tenantCustomerId, consumerId],
            );
            await qr.manager.query(
                `UPDATE brand_order_ratings SET customer_id = $1 WHERE customer_id = $2`,
                [tenantCustomerId, consumerId],
            );
            await qr.manager.query(
                `DELETE FROM carts absorb
                 WHERE absorb.customer_id = $2
                   AND EXISTS (
                     SELECT 1 FROM carts keep
                     WHERE keep.customer_id = $1 AND keep.branch_id = absorb.branch_id
                   )`,
                [tenantCustomerId, consumerId],
            );
            await qr.manager.query(
                `UPDATE carts SET customer_id = $1 WHERE customer_id = $2`,
                [tenantCustomerId, consumerId],
            );
            await qr.manager.remove(consumer);

            await qr.commitTransaction();
            return (await this.repo.findOne({
                where: { id: tenantCustomerId },
            })) as Customer;
        } catch (e) {
            await qr.rollbackTransaction();
            throw e;
        } finally {
            await qr.release();
        }
    }

    /**
     * Find or create tenant-scoped customer for a phone.
     * Links an existing consumer account instead of creating a duplicate row.
     */
    async findOrCreateTenantCustomerForPhone(
        tenantId: number,
        phone: string,
        name?: string | null,
        /** Source of the order that triggered the auto-create. */
        source: CustomerSource = 'pos',
    ): Promise<Customer> {
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) {
            throw new BadRequestException(
                'Invalid Pakistani phone number. Use format: 03XXXXXXXXX (e.g. 03001234567)',
            );
        }

        const existing = await this.repo.findOne({
            where: { tenantId, phone: normalized },
        });
        if (existing) return existing;

        const consumer = await this.findConsumerByPhone(normalized);
        if (consumer) {
            return this.linkConsumerToTenant(consumer.id, tenantId);
        }

        let newCustomer: Customer;
        try {
            newCustomer = await this.repo.save(
                this.repo.create({
                    tenantId,
                    phone: normalized,
                    name: name?.trim() || 'Customer',
                    loyaltyPointsBalance: 0,
                    source,
                }),
            );
        } catch (e) {
            // Two concurrent first orders for the same new phone race the
            // (tenant_id, phone) unique index. Re-fetch the row the winner created
            // instead of 500ing (which would fail the loser's order + loyalty earn).
            if (isUniqueViolation(e)) {
                const existing = await this.repo.findOne({
                    where: { tenantId, phone: normalized },
                });
                if (existing) return existing;
            }
            throw e;
        }
        // Fire-and-forget: assign any active new_customer promotions
        if (this.promotionsService) {
            this.promotionsService
                .assignNewCustomerPromotions(tenantId, newCustomer.id)
                .catch((err) =>
                    this.logger.warn(
                        `Promotion auto-assign failed for customer ${newCustomer.id}`,
                        err,
                    ),
                );
        }
        // Fire-and-forget: mint audience='new_customer' coupon vouchers.
        if (this.couponsService) {
            this.couponsService
                .awardNewCustomerVouchers(tenantId, newCustomer.id)
                .catch((err) =>
                    this.logger.warn(
                        `New-customer voucher award failed for customer ${newCustomer.id}`,
                        err,
                    ),
                );
        }
        return newCustomer;
    }

    /**
     * Link consumer to tenant, or merge into existing tenant row with same phone.
     */
    async linkConsumerToTenant(
        consumerId: number,
        tenantId: number,
    ): Promise<Customer> {
        const customer = await this.repo.findOne({ where: { id: consumerId } });
        if (!customer) throw new NotFoundException('Customer not found');

        if (customer.tenantId != null) {
            if (customer.tenantId === tenantId) return customer;
            throw new BadRequestException(
                'Customer is already linked to a different tenant',
            );
        }

        const phone = normalizePakistaniPhone(customer.phone);
        if (!phone) {
            throw new BadRequestException(
                'Invalid customer phone number (expected Pakistani format: 03XXXXXXXXX)',
            );
        }

        const existing = await this.repo.findOne({
            where: { tenantId, phone },
        });
        if (existing && existing.id !== customer.id) {
            return this.mergeConsumerIntoTenantCustomer(
                consumerId,
                existing.id,
            );
        }

        customer.tenantId = tenantId;
        customer.phone = phone;
        await this.repo.save(customer);
        return (await this.repo.findOne({
            where: { id: consumerId },
        })) as Customer;
    }

    /**
     * Resolve customer id for a consumer order when the user is logged in.
     */
    async resolveCustomerIdForOrder(
        tenantId: number,
        phone: string,
        loggedInCustomerId?: number | null,
    ): Promise<number | null> {
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) return null;

        const tenantCustomer = await this.findByPhone(tenantId, normalized);
        if (tenantCustomer) return tenantCustomer.id;

        if (loggedInCustomerId == null) return null;

        const loggedIn = await this.findById(loggedInCustomerId);
        if (!loggedIn) return null;

        const loggedInPhone = normalizePakistaniPhone(loggedIn.phone);
        if (loggedInPhone !== normalized) return null;

        if (loggedIn.tenantId === tenantId) return loggedIn.id;

        if (loggedIn.tenantId == null) {
            const linked = await this.linkConsumerToTenant(
                loggedIn.id,
                tenantId,
            );
            return linked.id;
        }

        return null;
    }
}
