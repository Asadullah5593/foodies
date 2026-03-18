import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    ConflictException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { QueryFailedError } from 'typeorm';
import * as bcrypt from 'bcrypt';
import { Tenant } from '../entities/tenant.entity';
import { User } from '../entities/user.entity';
import { TenantUser } from '../entities/tenant-user.entity';
import { Role } from '../entities/role.entity';
import { RolesService } from '../roles/roles.service';

@Injectable()
export class TenantsService {
    constructor(
        @InjectRepository(Tenant)
        private repo: Repository<Tenant>,
        @InjectRepository(User)
        private userRepo: Repository<User>,
        @InjectRepository(TenantUser)
        private tenantUserRepo: Repository<TenantUser>,
        @InjectRepository(Role)
        private roleRepo: Repository<Role>,
        private rolesService: RolesService,
    ) {}

    /** Admin: tenant user sees only their tenant; super admin (tenantId null) sees all */
    async findAllForAdmin(tenantId: number | null) {
        if (tenantId == null) {
            const list = await this.repo.find({ order: { id: 'ASC' } });
            return list.map((t) => this.toResponse(t));
        }
        const tenant = await this.repo.findOne({ where: { id: tenantId } });
        if (!tenant) return [];
        return [this.toResponse(tenant)];
    }

    /** Get current tenant's business settings (for tenant users only). Currency and timezone are hidden (fixed PKR). */
    async getBusinessSettings(tenantId: number) {
        const tenant = await this.repo.findOne({ where: { id: tenantId } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        return this.toBusinessSettingsResponse(tenant);
    }

    /** Update current tenant's business settings (for tenant users only). Currency and timezone are fixed (PKR/UTC) and not updatable here. */
    async updateBusinessSettings(
        tenantId: number,
        dto: {
            name?: string;
            legal_name?: string;
            default_tax_rate?: number;
            loyalty_enabled?: boolean;
        },
    ) {
        const tenant = await this.repo.findOne({ where: { id: tenantId } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        await this.update(tenantId, dto);
        return this.getBusinessSettings(tenantId);
    }

    async findAll() {
        const list = await this.repo.find({ order: { id: 'ASC' } });
        return list.map((t) => this.toResponse(t));
    }

    /** Admin: tenant user can only view own tenant; super admin any */
    async findOneForAdmin(id: number, tenantId: number | null) {
        const tenant = await this.repo.findOne({ where: { id } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        if (tenantId != null && tenant.id !== tenantId) {
            throw new ForbiddenException('You can only view your own tenant');
        }
        return this.toResponse(tenant);
    }

    async findOne(id: number) {
        const tenant = await this.repo.findOne({ where: { id } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        return this.toResponse(tenant);
    }

    async create(dto: {
        name: string;
        slug?: string;
        status?: string;
        legal_name?: string;
        default_currency?: string;
        default_timezone?: string;
        default_tax_rate?: number;
        loyalty_enabled?: boolean;
        owner_email: string;
        owner_password: string;
        owner_name?: string;
    }) {
        const existingUser = await this.userRepo.findOne({
            where: { email: dto.owner_email.trim().toLowerCase() },
        });
        if (existingUser) {
            throw new ConflictException(
                'A user with this email already exists. Please use a different owner email.',
            );
        }
        const slug =
            dto.slug ??
            dto.name
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
        const existingTenant = await this.repo.findOne({ where: { slug } });
        if (existingTenant) {
            throw new ConflictException(
                `A tenant with slug "${slug}" already exists. Please use a different tenant name.`,
            );
        }
        try {
            const tenant = await this.repo.save(
                this.repo.create({
                    name: dto.name,
                    slug,
                    status: dto.status ?? 'active',
                    legalName: dto.legal_name ?? null,
                    defaultCurrency: dto.default_currency ?? 'PKR',
                    defaultTimezone: dto.default_timezone ?? 'UTC',
                    defaultTaxRate: dto.default_tax_rate ?? 0,
                    defaultServiceCharge: 0,
                    loyaltyEnabled: dto.loyalty_enabled ?? false,
                }),
            );
            const ownerRole = await this.rolesService.getRoleBySlug(
                'owner',
                null,
            );
            const hashed = await bcrypt.hash(dto.owner_password, 10);
            const user = await this.userRepo.save(
                this.userRepo.create({
                    name: dto.owner_name ?? dto.name + ' Owner',
                    email: dto.owner_email.trim().toLowerCase(),
                    password: hashed,
                    status: 'active',
                }),
            );
            await this.tenantUserRepo.save(
                this.tenantUserRepo.create({
                    tenantId: tenant.id,
                    userId: user.id,
                    roleId: ownerRole.id,
                }),
            );
            return this.toResponse(tenant);
        } catch (err) {
            const code =
                (err as { code?: string; driverError?: { code?: string } })
                    ?.code ??
                (err as { driverError?: { code?: string } })?.driverError?.code;
            if (err instanceof QueryFailedError && code === '23505') {
                throw new ConflictException(
                    'A tenant or user with this name or email already exists. Please use different values.',
                );
            }
            throw err;
        }
    }

    async update(
        id: number,
        dto: {
            name?: string;
            slug?: string;
            status?: string;
            legal_name?: string;
            default_currency?: string;
            default_timezone?: string;
            default_tax_rate?: number;
            loyalty_enabled?: boolean;
        },
    ) {
        const tenant = await this.repo.findOne({ where: { id } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        if (dto.slug !== undefined) tenant.slug = dto.slug;
        else if (dto.name)
            tenant.slug = dto.name
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
        if (dto.name !== undefined) tenant.name = dto.name;
        if (dto.status !== undefined) tenant.status = dto.status;
        if (dto.legal_name !== undefined) tenant.legalName = dto.legal_name;
        // default_currency and default_timezone are not updated via update() when called from business settings (PKR/UTC fixed)
        if (dto.default_currency !== undefined)
            tenant.defaultCurrency = dto.default_currency;
        if (dto.default_timezone !== undefined)
            tenant.defaultTimezone = dto.default_timezone;
        if (dto.default_tax_rate !== undefined)
            tenant.defaultTaxRate = dto.default_tax_rate;
        // defaultServiceCharge is deprecated; keep it at 0 for all tenants.
        tenant.defaultServiceCharge = 0;
        if (dto.loyalty_enabled !== undefined)
            tenant.loyaltyEnabled = dto.loyalty_enabled;
        await this.repo.save(tenant);
        return this.toResponse(tenant);
    }

    /** Admin: tenant user can only delete own tenant (rare); super admin any */
    async removeForAdmin(id: number, tenantId: number | null) {
        const tenant = await this.repo.findOne({ where: { id } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        if (tenantId != null && tenant.id !== tenantId) {
            throw new ForbiddenException('You can only delete your own tenant');
        }
        await this.repo.remove(tenant);
        return { message: 'Tenant deleted successfully' };
    }

    async updateForAdmin(
        id: number,
        tenantId: number | null,
        dto: {
            name?: string;
            slug?: string;
            status?: string;
            legal_name?: string;
            default_currency?: string;
            default_timezone?: string;
            default_tax_rate?: number;
            default_service_charge?: number;
            loyalty_enabled?: boolean;
        },
    ) {
        const tenant = await this.repo.findOne({ where: { id } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        if (tenantId != null && tenant.id !== tenantId) {
            throw new ForbiddenException('You can only update your own tenant');
        }
        return this.update(id, dto);
    }

    async remove(id: number) {
        const tenant = await this.repo.findOne({ where: { id } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        await this.repo.remove(tenant);
        return { message: 'Tenant deleted successfully' };
    }

    /** Get loyalty settings for a tenant (admin). */
    async getLoyaltySettings(tenantId: number, requesterTenantId: number | null) {
        const tenant = await this.repo.findOne({ where: { id: tenantId } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        if (requesterTenantId != null && tenant.id !== requesterTenantId) {
            throw new ForbiddenException('You can only view your own tenant');
        }
        const def = {
            displayName: 'Reward Points',
            spendPerPoint: 1000,
            minOrderToEarn: 1,
            cashValuePerPoint: 10,
            minOrderToRedeem: 1,
            expiryPeriod: 365,
            expiryUnit: 'day' as const,
        };
        const s = tenant.loyaltySettings ?? {};
        return {
            loyalty_enabled: tenant.loyaltyEnabled,
            display_name: s.displayName ?? def.displayName,
            spend_per_point: s.spendPerPoint ?? def.spendPerPoint,
            min_order_to_earn: s.minOrderToEarn ?? def.minOrderToEarn,
            cash_value_per_point: s.cashValuePerPoint ?? def.cashValuePerPoint,
            min_order_to_redeem: s.minOrderToRedeem ?? def.minOrderToRedeem,
            expiry_period: s.expiryPeriod ?? def.expiryPeriod,
            expiry_unit: s.expiryUnit ?? def.expiryUnit,
        };
    }

    /** Update loyalty settings for a tenant (admin). */
    async updateLoyaltySettings(
        tenantId: number,
        requesterTenantId: number | null,
        dto: {
            loyalty_enabled?: boolean;
            display_name?: string;
            spend_per_point?: number;
            min_order_to_earn?: number;
            cash_value_per_point?: number;
            min_order_to_redeem?: number;
            expiry_period?: number;
            expiry_unit?: 'day' | 'month' | 'year';
        },
    ) {
        const tenant = await this.repo.findOne({ where: { id: tenantId } });
        if (!tenant) throw new NotFoundException('Tenant not found');
        if (requesterTenantId != null && tenant.id !== requesterTenantId) {
            throw new ForbiddenException('You can only update your own tenant');
        }
        if (dto.loyalty_enabled !== undefined) tenant.loyaltyEnabled = dto.loyalty_enabled;
        const def = tenant.loyaltySettings ?? {};
        tenant.loyaltySettings = {
            displayName: dto.display_name ?? def.displayName ?? 'Reward Points',
            spendPerPoint: dto.spend_per_point ?? def.spendPerPoint ?? 1000,
            minOrderToEarn: dto.min_order_to_earn ?? def.minOrderToEarn ?? 1,
            cashValuePerPoint: dto.cash_value_per_point ?? def.cashValuePerPoint ?? 10,
            minOrderToRedeem: dto.min_order_to_redeem ?? def.minOrderToRedeem ?? 1,
            expiryPeriod: dto.expiry_period ?? def.expiryPeriod ?? 365,
            expiryUnit: dto.expiry_unit ?? def.expiryUnit ?? 'day',
        };
        await this.repo.save(tenant);
        return this.getLoyaltySettings(tenantId, requesterTenantId);
    }

    private toBusinessSettingsResponse(t: Tenant) {
        return {
            id: t.id,
            name: t.name,
            slug: t.slug,
            status: t.status,
            legal_name: t.legalName,
            default_tax_rate: Number(t.defaultTaxRate),
            default_service_charge: 0,
            loyalty_enabled: t.loyaltyEnabled,
            loyalty_settings: t.loyaltySettings ?? null,
            settings: t.settings ?? [],
            created_at: t.createdAt?.toISOString() ?? null,
            updated_at: t.updatedAt?.toISOString() ?? null,
        };
    }

    private toResponse(t: Tenant) {
        return {
            id: t.id,
            name: t.name,
            slug: t.slug,
            status: t.status,
            legal_name: t.legalName,
            default_currency: t.defaultCurrency,
            default_timezone: t.defaultTimezone,
            default_tax_rate: Number(t.defaultTaxRate),
            default_service_charge: 0,
            loyalty_enabled: t.loyaltyEnabled,
            loyalty_settings: t.loyaltySettings ?? null,
            settings: t.settings ?? [],
            created_at: t.createdAt?.toISOString() ?? null,
            updated_at: t.updatedAt?.toISOString() ?? null,
        };
    }
}
