import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Customer } from '../entities/customer.entity';
import {
    validatePakistaniPhone,
    normalizePakistaniPhone,
} from '../utils/phone';

@Injectable()
export class CustomersService {
    constructor(
        @InjectRepository(Customer) private repo: Repository<Customer>,
        private dataSource: DataSource,
    ) {}

    /**
     * Admin listing must be tenant-scoped.
     * - tenant users: only their tenant's customers
     * - super admin (tenantId null): all customers
     */
    async findAll(tenantId: number | null) {
        return this.repo.find({
            where: tenantId != null ? { tenantId } : {},
            order: { id: 'ASC' },
        });
    }

    async findOne(id: number, tenantId: number | null) {
        const customer = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
        });
        if (!customer) throw new NotFoundException('Customer not found');
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

    /** Find consumer (no tenant) by phone. Used for consumer app when tenant linkage is removed. */
    async findConsumerByPhone(phone: string): Promise<Customer | null> {
        const normalized = normalizePakistaniPhone(phone);
        if (!normalized) return null;
        return this.repo.findOne({
            where: { phone: normalized, tenantId: IsNull() },
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
    ) {
        const name = dto.name?.trim();
        if (!name) {
            throw new BadRequestException('Customer name is required');
        }
        const phone = this.validateAndNormalizePhone(dto.phone);
        const existing = await this.repo.findOne({
            where: { tenantId, phone },
        });
        if (existing)
            throw new ConflictException(
                'Customer with this phone already exists',
            );
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
            }),
        );
    }

    /** Consumer register: no tenant linkage. Creates customer with tenantId = null. */
    async createForConsumer(
        tenantId: number | null,
        dto: {
            phone: string;
            name: string;
            email: string;
            password: string;
        },
    ) {
        const name = dto.name?.trim();
        if (!name) {
            throw new BadRequestException('Customer name is required');
        }
        const email =
            typeof dto.email === 'string' ? dto.email.trim().toLowerCase() : '';
        if (!email) {
            throw new BadRequestException('Email is required');
        }
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
        const existingEmail = await this.repo.findOne({
            where: { email },
        });
        if (existingEmail)
            throw new ConflictException(
                'Customer with this email already exists',
            );
        const passwordHash = await bcrypt.hash(password, 10);
        return this.repo.save(
            this.repo.create({
                tenantId: tenantId ?? null,
                phone,
                name,
                email,
                password: passwordHash,
                loyaltyPointsBalance: 0,
            }),
        );
    }

    /** Validate customer by email and password; return customer or throw. */
    async validateCustomer(email: string, password: string): Promise<Customer> {
        const customer = await this.findByEmail(email);
        if (!customer || !customer.password) {
            throw new UnauthorizedException('Invalid email or password');
        }
        const ok = await bcrypt.compare(
            typeof password === 'string' ? password : '',
            customer.password,
        );
        if (!ok) {
            throw new UnauthorizedException('Invalid email or password');
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
    ) {
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

    async remove(id: number, tenantId: number | null): Promise<void> {
        const customer = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
        });
        if (!customer) throw new NotFoundException('Customer not found');
        await this.repo.remove(customer);
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
            if (
                absorbEmail &&
                (!tenantCustomer.email ||
                    tenantCustomer.email.trim() === '')
            ) {
                const emailTaken = await qr.manager.findOne(Customer, {
                    where: { email: absorbEmail },
                });
                if (emailTaken && emailTaken.id !== tenantCustomerId) {
                    throw new ConflictException(
                        'Cannot merge: email already belongs to another customer',
                    );
                }
                tenantCustomer.email = absorbEmail;
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
            if (tenantCustomer.longitude == null && consumer.longitude != null) {
                tenantCustomer.longitude = consumer.longitude;
            }
            tenantCustomer.loyaltyPointsBalance =
                (tenantCustomer.loyaltyPointsBalance || 0) +
                (consumer.loyaltyPointsBalance || 0);
            tenantCustomer.phone = normalizePakistaniPhone(consumer.phone)
                ?? tenantCustomer.phone;

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

        return this.repo.save(
            this.repo.create({
                tenantId,
                phone: normalized,
                name: name?.trim() || 'Customer',
                loyaltyPointsBalance: 0,
            }),
        );
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

    /**
     * One-time consumer tenant linking:
     * - If customer already has tenantId, returns it (idempotent) unless different tenant requested.
     * - Merges into existing tenant customer when phone is already registered under that tenant.
     */
    async syncTenantForCustomer(
        customerId: number,
        tenantId: number,
    ): Promise<Customer> {
        return this.linkConsumerToTenant(customerId, tenantId);
    }
}
