import {
    BadRequestException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, In, Repository } from 'typeorm';
import { advisoryXactLock, AdvisoryLock } from '../common/db-concurrency';
import {
    Brand,
    BrandDeliveryTiers,
    DeliveryTierConfig,
} from '../entities/brand.entity';
import { Branch } from '../entities/branch.entity';
import { BranchBrand } from '../entities/branch-brand.entity';
import { BrandOrderRating } from '../entities/brand-order-rating.entity';
import { MediaStorageService } from '../media/media-storage.service';
import {
    DELIVERY_TIER_DEFAULTS,
    validateDeliveryTiers,
} from '../orders/delivery-tier.utils';

@Injectable()
export class BrandsService {
    constructor(
        @InjectRepository(Brand)
        private repo: Repository<Brand>,
        @InjectRepository(BranchBrand)
        private branchBrandRepo: Repository<BranchBrand>,
        @InjectRepository(BrandOrderRating)
        private brandRatingRepo: Repository<BrandOrderRating>,
        private mediaStorage: MediaStorageService,
    ) {}

    /** Admin: tenant user sees only their tenant's brands (brand-locked users only their own); super admin (tenantId null) sees all with tenant_name */
    async findAllForAdmin(
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (tenantId != null) {
            const list = await this.repo.find({
                where:
                    allowedBrandIds != null
                        ? { tenantId, id: In(allowedBrandIds) }
                        : { tenantId },
                order: { id: 'ASC' },
            });
            const aggMap = await this.loadRatingAggregates(
                list.map((b) => b.id),
            );
            const statusMap = await this.loadOnlineStatus(
                list.map((b) => b.id),
            );
            return list.map((b) => ({
                ...this.toResponse(b),
                ...this.mergeAdminRatingFields(b.id, aggMap),
                online_status: statusMap.get(b.id)?.status ?? 'none',
                online_branch_count: statusMap.get(b.id)?.count ?? 0,
            }));
        }
        const list = await this.repo.find({
            relations: ['tenant'],
            order: { id: 'ASC' },
        });
        const aggMap = await this.loadRatingAggregates(list.map((b) => b.id));
        const statusMap = await this.loadOnlineStatus(list.map((b) => b.id));
        return list.map((b) => ({
            ...this.toResponse(b),
            ...this.mergeAdminRatingFields(b.id, aggMap),
            online_status: statusMap.get(b.id)?.status ?? 'none',
            online_branch_count: statusMap.get(b.id)?.count ?? 0,
            tenant_name:
                (b as Brand & { tenant?: { name: string } }).tenant?.name ??
                null,
        }));
    }

    /**
     * Aggregate online open/close status per brand across its branches:
     * 'open' (all branches open), 'closed' (all closed), 'partial' (mixed),
     * 'none' (brand not at any branch).
     */
    private async loadOnlineStatus(
        brandIds: number[],
    ): Promise<
        Map<
            number,
            { status: 'open' | 'closed' | 'partial' | 'none'; count: number }
        >
    > {
        const map = new Map<
            number,
            { status: 'open' | 'closed' | 'partial' | 'none'; count: number }
        >();
        if (brandIds.length === 0) return map;
        const rows = await this.branchBrandRepo
            .createQueryBuilder('bb')
            .select('bb.brandId', 'brandId')
            .addSelect('COUNT(*)', 'total')
            .addSelect(
                'COUNT(*) FILTER (WHERE bb.is_open = true)',
                'open_count',
            )
            .where('bb.brandId IN (:...brandIds)', { brandIds })
            .groupBy('bb.brandId')
            .getRawMany<{
                brandId: string | number;
                total: string | number;
                open_count: string | number;
            }>();
        for (const r of rows) {
            const total = Number(r.total);
            const open = Number(r.open_count);
            const status =
                total === 0
                    ? 'none'
                    : open === total
                      ? 'open'
                      : open === 0
                        ? 'closed'
                        : 'partial';
            map.set(Number(r.brandId), { status, count: total });
        }
        return map;
    }

    async findAll(tenantId: number) {
        const list = await this.repo.find({
            where: { tenantId },
            order: { id: 'ASC' },
        });
        return list.map((b) => this.toResponse(b));
    }

    /** Public list for consumer app – all active brands. Optional search filters by brand name (case-insensitive). */
    async findAllPublic(search?: string) {
        const list = await this.repo.find({
            where: { isActive: true },
            order: { id: 'ASC' },
        });
        const filtered = this.filterBrandsBySearch(list, search);
        const aggMap = await this.loadRatingAggregates(
            filtered.map((b) => b.id),
        );
        return filtered.map((b) => this.toPublicResponse(b, aggMap.get(b.id)));
    }

    /** Public list for web home – active brands scoped to a tenant id. Optional search filters by brand name. */
    async findAllPublicByTenantId(tenantId: number, search?: string) {
        const list = await this.repo.find({
            where: { isActive: true, tenantId },
            order: { id: 'ASC' },
        });
        const filtered = this.filterBrandsBySearch(list, search);
        const aggMap = await this.loadRatingAggregates(
            filtered.map((b) => b.id),
        );
        return filtered.map((b) => this.toPublicResponse(b, aggMap.get(b.id)));
    }

    /** Public: active brands at a specific branch (for consumer app). Optional search filters by brand name. */
    async findAllPublicByBranchId(branchId: number, search?: string) {
        const branchBrands = await this.branchBrandRepo.find({
            where: { branchId },
            relations: ['branch'],
        });
        // Consumer-facing: an inactive branch exposes no brands.
        const branch = branchBrands[0]?.branch;
        if (branch && !branch.isActive) return [];
        const brandIds = branchBrands.map((bb) => bb.brandId);
        if (brandIds.length === 0) return [];
        // Per-(branch,brand) online open/close: brands stay listed but carry is_open.
        const openByBrand = new Map<number, boolean>(
            branchBrands.map((bb) => [bb.brandId, bb.isOpen !== false]),
        );
        const list = await this.repo.find({
            where: { id: In(brandIds), isActive: true },
            order: { id: 'ASC' },
        });
        const filtered = this.filterBrandsBySearch(list, search);
        const aggMap = await this.loadRatingAggregates(
            filtered.map((b) => b.id),
        );
        return filtered.map((b) => ({
            ...this.toPublicResponse(b, aggMap.get(b.id)),
            is_open: openByBrand.get(b.id) ?? true,
        }));
    }

    /** Public: active brands by explicit id list (for consumer app helpers). */
    async findAllPublicByIds(ids: number[]) {
        if (!ids.length) return [];
        const list = await this.repo.find({
            where: { id: In(ids), isActive: true },
            order: { id: 'ASC' },
        });
        const aggMap = await this.loadRatingAggregates(list.map((b) => b.id));
        return list.map((b) => this.toPublicResponse(b, aggMap.get(b.id)));
    }

    /**
     * Public (consumer app): flatten nearby branches into one row per (brand, branch).
     * Each row is the public brand response plus the branch it is served from and the
     * customer's distance to that branch. A brand available at several nearby branches
     * yields one row per branch. Optional `search` filters by brand name; optional
     * `brandIdFilter` restricts to a set of brand ids (e.g. brands offering a category).
     */
    async findPublicNearbyRows(
        nearby: Array<{ branch: Branch; distanceKm: number }>,
        search?: string,
        brandIdFilter?: Set<number>,
    ) {
        // Collect candidate brand ids across all nearby branches.
        const brandIds = new Set<number>();
        for (const { branch } of nearby) {
            for (const bb of branch.branchBrands ?? []) {
                brandIds.add(bb.brandId);
            }
        }
        if (brandIds.size === 0) return [];
        const list = await this.repo.find({
            where: { id: In([...brandIds]), isActive: true },
        });
        const allowed = this.filterBrandsBySearch(list, search).filter(
            (b) => !brandIdFilter || brandIdFilter.has(b.id),
        );
        const brandById = new Map(allowed.map((b) => [b.id, b]));
        const aggMap = await this.loadRatingAggregates(
            allowed.map((b) => b.id),
        );
        const rows = nearby.flatMap(({ branch, distanceKm }) =>
            (branch.branchBrands ?? []).flatMap((bb) => {
                const brand = brandById.get(bb.brandId);
                if (!brand) return [];
                return [
                    {
                        ...this.toPublicResponse(brand, aggMap.get(brand.id)),
                        is_open: bb.isOpen !== false,
                        branch_id: branch.id,
                        branch_name: branch.name,
                        distance_km: Math.round(distanceKm * 10) / 10,
                    },
                ];
            }),
        );
        rows.sort(
            (a, b) =>
                a.distance_km - b.distance_km || a.name.localeCompare(b.name),
        );
        return rows;
    }

    private async loadRatingAggregates(
        brandIds: number[],
    ): Promise<Map<number, { avg: number; count: number }>> {
        const map = new Map<number, { avg: number; count: number }>();
        if (brandIds.length === 0) return map;
        const rows = await this.brandRatingRepo
            .createQueryBuilder('br')
            .select('br.brandId', 'brandId')
            .addSelect('COUNT(*)', 'cnt')
            .addSelect('AVG(br.stars)', 'avgstars')
            .where('br.brandId IN (:...ids)', { ids: brandIds })
            .groupBy('br.brandId')
            .getRawMany<{
                brandId: string | number;
                cnt: string | number;
                avgstars: string | null;
            }>();
        for (const row of rows) {
            const r = row as Record<string, unknown>;
            const id = Number(r.brandId ?? r.brand_id);
            const count = Number(r.cnt ?? r.count);
            const avgRaw = r.avgstars ?? r.avg_stars;
            const avg =
                avgRaw != null && avgRaw !== ''
                    ? parseFloat(String(avgRaw))
                    : 0;
            map.set(id, { count, avg });
        }
        return map;
    }

    private mergeAdminRatingFields(
        brandId: number,
        aggMap: Map<number, { avg: number; count: number }>,
    ): { rating_average: number | null; rating_count: number } {
        const agg = aggMap.get(brandId);
        if (!agg || agg.count === 0) {
            return { rating_average: null, rating_count: 0 };
        }
        return {
            rating_count: agg.count,
            rating_average: Math.round(agg.avg * 10) / 10,
        };
    }

    /**
     * Admin / POS: all-time brand rating aggregates (stars average and count only).
     * Does not expose individual reviews.
     */
    async getRatingAggregatesForBrandIds(
        brandIds: number[],
    ): Promise<
        Map<number, { rating_average: number | null; rating_count: number }>
    > {
        const raw = await this.loadRatingAggregates(brandIds);
        const out = new Map<
            number,
            { rating_average: number | null; rating_count: number }
        >();
        for (const [id, agg] of raw) {
            out.set(id, {
                rating_count: agg.count,
                rating_average:
                    agg.count > 0 ? Math.round(agg.avg * 10) / 10 : null,
            });
        }
        return out;
    }

    private filterBrandsBySearch<T extends { name?: string | null }>(
        brands: T[],
        search?: string,
    ): T[] {
        if (!search || typeof search !== 'string') return brands;
        const q = search.trim().toLowerCase();
        if (!q) return brands;
        return brands.filter((b) => (b.name ?? '').toLowerCase().includes(q));
    }

    /** Public: get active brand by id (for consumer app). */
    async findOnePublic(id: number) {
        const brand = await this.repo.findOne({
            where: { id, isActive: true },
        });
        if (!brand) throw new NotFoundException('Brand not found');
        const aggMap = await this.loadRatingAggregates([id]);
        return this.toPublicResponse(brand, aggMap.get(id));
    }

    /** Admin: tenant user can only view own tenant's brand; super admin can view any */
    async findOneForAdmin(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (allowedBrandIds != null && !allowedBrandIds.includes(id)) {
            throw new NotFoundException('Brand not found');
        }
        const brand = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
            relations: tenantId == null ? ['tenant'] : undefined,
        });
        if (!brand) throw new NotFoundException('Brand not found');
        const aggMap = await this.loadRatingAggregates([id]);
        const out = {
            ...this.toResponse(brand),
            ...this.mergeAdminRatingFields(id, aggMap),
        };
        if (
            tenantId == null &&
            (brand as Brand & { tenant?: { name: string } }).tenant
        ) {
            (out as Record<string, unknown>).tenant_name = (
                brand as Brand & { tenant: { name: string } }
            ).tenant.name;
        }
        return out;
    }

    async findOne(id: number, tenantId: number) {
        const brand = await this.repo.findOne({ where: { id, tenantId } });
        if (!brand) throw new NotFoundException('Brand not found');
        return this.toResponse(brand);
    }

    async create(
        dto: {
            name: string;
            logo_url?: string;
            description?: string;
            is_active?: boolean;
            status?: string;
            delivery_flat_fee?: number;
        },
        tenantId: number,
    ) {
        const slug = dto.name
            .toLowerCase()
            .replace(/\s+/g, '-')
            .replace(/[^a-z0-9-]/g, '');
        const isActive =
            dto.is_active ?? (dto.status === 'inactive' ? false : true);
        const brand = await this.repo.save(
            this.repo.create({
                tenantId,
                name: dto.name,
                slug,
                description: dto.description ?? null,
                logoUrl: dto.logo_url ?? null,
                isActive,
                deliveryFlatFee:
                    dto.delivery_flat_fee != null
                        ? Number(dto.delivery_flat_fee)
                        : 0,
            }),
        );
        return this.toResponse(brand);
    }

    async update(
        id: number,
        tenantId: number,
        dto: {
            name?: string;
            logo_url?: string;
            description?: string;
            is_active?: boolean;
            status?: string;
        },
    ) {
        const brand = await this.repo.findOne({ where: { id, tenantId } });
        if (!brand) throw new NotFoundException('Brand not found');
        const oldLogoUrl = brand.logoUrl ?? null;
        if (dto.name !== undefined) {
            brand.name = dto.name;
            brand.slug = dto.name
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
        }
        if (dto.logo_url !== undefined) brand.logoUrl = dto.logo_url;
        if (dto.description !== undefined) brand.description = dto.description;
        if (dto.is_active !== undefined) brand.isActive = dto.is_active;
        if (dto.status !== undefined)
            brand.isActive = dto.status !== 'inactive';
        await this.repo.save(brand);
        if (
            dto.logo_url !== undefined &&
            oldLogoUrl &&
            oldLogoUrl !== brand.logoUrl
        ) {
            await this.mediaStorage.deleteManagedObjectByUrl(
                oldLogoUrl,
                'brands',
            );
        }
        return this.toResponse(brand);
    }

    /** Admin: tenant user can only update/delete own tenant's brand; super admin any */
    async updateForAdmin(
        id: number,
        tenantId: number | null,
        dto: {
            name?: string;
            logo_url?: string;
            description?: string;
            is_active?: boolean;
            status?: string;
            delivery_flat_fee?: number;
        },
    ) {
        const where = tenantId != null ? { id, tenantId } : { id };
        const brand = await this.repo.findOne({ where });
        if (!brand) throw new NotFoundException('Brand not found');
        const oldLogoUrl = brand.logoUrl ?? null;
        if (dto.name !== undefined) {
            brand.name = dto.name;
            brand.slug = dto.name
                .toLowerCase()
                .replace(/\s+/g, '-')
                .replace(/[^a-z0-9-]/g, '');
        }
        if (dto.logo_url !== undefined) brand.logoUrl = dto.logo_url;
        if (dto.description !== undefined) brand.description = dto.description;
        if (dto.is_active !== undefined) brand.isActive = dto.is_active;
        if (dto.status !== undefined)
            brand.isActive = dto.status !== 'inactive';
        if (dto.delivery_flat_fee !== undefined)
            brand.deliveryFlatFee = Number(dto.delivery_flat_fee) || 0;
        await this.repo.save(brand);
        if (
            dto.logo_url !== undefined &&
            oldLogoUrl &&
            oldLogoUrl !== brand.logoUrl
        ) {
            await this.mediaStorage.deleteManagedObjectByUrl(
                oldLogoUrl,
                'brands',
            );
        }
        return this.toResponse(brand);
    }

    private static readonly LOYALTY_DEFAULTS = {
        displayName: 'Reward Points',
        spendPerPoint: 1000,
        minOrderToEarn: 1,
        cashValuePerPoint: 10,
        minOrderToRedeem: 1,
        expiryPeriod: 365,
        expiryUnit: 'day' as const,
    };

    private async findBrandForLoyalty(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ): Promise<Brand> {
        if (allowedBrandIds != null && !allowedBrandIds.includes(id)) {
            throw new NotFoundException('Brand not found');
        }
        const brand = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
        });
        if (!brand) throw new NotFoundException('Brand not found');
        return brand;
    }

    private toLoyaltyResponse(brand: Brand) {
        const def = BrandsService.LOYALTY_DEFAULTS;
        const s = brand.loyaltySettings ?? {};
        return {
            loyalty_enabled: brand.loyaltyEnabled,
            display_name: s.displayName ?? def.displayName,
            spend_per_point: s.spendPerPoint ?? def.spendPerPoint,
            min_order_to_earn: s.minOrderToEarn ?? def.minOrderToEarn,
            cash_value_per_point: s.cashValuePerPoint ?? def.cashValuePerPoint,
            min_order_to_redeem: s.minOrderToRedeem ?? def.minOrderToRedeem,
            expiry_period: s.expiryPeriod ?? def.expiryPeriod,
            expiry_unit: s.expiryUnit ?? def.expiryUnit,
        };
    }

    /** Get loyalty settings for a brand (admin). Brand-locked users only their own. */
    async getLoyaltySettings(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        const brand = await this.findBrandForLoyalty(
            id,
            tenantId,
            allowedBrandIds,
        );
        return this.toLoyaltyResponse(brand);
    }

    /** Update loyalty settings for a brand (admin). Brand-locked users only their own. */
    async updateLoyaltySettings(
        id: number,
        tenantId: number | null,
        allowedBrandIds: number[] | null | undefined,
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
        const brand = await this.findBrandForLoyalty(
            id,
            tenantId,
            allowedBrandIds,
        );
        const def = BrandsService.LOYALTY_DEFAULTS;
        const cur = brand.loyaltySettings ?? {};
        if (dto.loyalty_enabled !== undefined)
            brand.loyaltyEnabled = dto.loyalty_enabled;
        brand.loyaltySettings = {
            displayName: dto.display_name ?? cur.displayName ?? def.displayName,
            spendPerPoint:
                dto.spend_per_point ?? cur.spendPerPoint ?? def.spendPerPoint,
            minOrderToEarn:
                dto.min_order_to_earn ??
                cur.minOrderToEarn ??
                def.minOrderToEarn,
            cashValuePerPoint:
                dto.cash_value_per_point ??
                cur.cashValuePerPoint ??
                def.cashValuePerPoint,
            minOrderToRedeem:
                dto.min_order_to_redeem ??
                cur.minOrderToRedeem ??
                def.minOrderToRedeem,
            expiryPeriod:
                dto.expiry_period ?? cur.expiryPeriod ?? def.expiryPeriod,
            expiryUnit: dto.expiry_unit ?? cur.expiryUnit ?? def.expiryUnit,
        };
        await this.repo.save(brand);
        return this.toLoyaltyResponse(brand);
    }

    /** Merge stored tiers over incoming over defaults (per field), producing a complete config. */
    private mergeDeliveryTiers(
        current: BrandDeliveryTiers | null,
        incoming: {
            saver?: Partial<DeliveryTierConfig>;
            standard?: Partial<DeliveryTierConfig>;
            priority?: Partial<DeliveryTierConfig>;
            saverHoldMinutes?: number;
            maxBatchSize?: number;
        } | null,
    ): BrandDeliveryTiers {
        const def = DELIVERY_TIER_DEFAULTS;
        const cur = current ?? ({} as Partial<BrandDeliveryTiers>);
        const inc = incoming ?? {};
        const mergeTier = (key: 'saver' | 'standard' | 'priority') => {
            const c: Partial<DeliveryTierConfig> = cur[key] ?? {};
            const i: Partial<DeliveryTierConfig> = inc[key] ?? {};
            const d = def[key];
            return {
                enabled: i.enabled ?? c.enabled ?? d.enabled,
                name: i.name ?? c.name ?? d.name,
                bands: i.bands ?? c.bands ?? d.bands,
                etaMinMinutes:
                    i.etaMinMinutes ?? c.etaMinMinutes ?? d.etaMinMinutes,
                etaMaxMinutes:
                    i.etaMaxMinutes ?? c.etaMaxMinutes ?? d.etaMaxMinutes,
            };
        };
        return {
            saver: mergeTier('saver'),
            standard: mergeTier('standard'),
            priority: mergeTier('priority'),
            saverHoldMinutes:
                inc.saverHoldMinutes ??
                cur.saverHoldMinutes ??
                def.saverHoldMinutes,
            maxBatchSize:
                inc.maxBatchSize ?? cur.maxBatchSize ?? def.maxBatchSize,
        };
    }

    private toDeliveryTiersResponse(brand: Brand) {
        return {
            delivery_tiers_enabled: brand.deliveryTiersEnabled,
            delivery_flat_fee: Number(brand.deliveryFlatFee ?? 0),
            tiers: this.mergeDeliveryTiers(brand.deliveryTiers, null),
        };
    }

    /** Get tier-based delivery config for a brand (admin). Brand-locked users only their own. */
    async getDeliveryTiers(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        const brand = await this.findBrandForLoyalty(
            id,
            tenantId,
            allowedBrandIds,
        );
        return this.toDeliveryTiersResponse(brand);
    }

    /** Update tier-based delivery config for a brand (admin). Brand-locked users only their own. */
    async updateDeliveryTiers(
        id: number,
        tenantId: number | null,
        allowedBrandIds: number[] | null | undefined,
        dto: {
            delivery_tiers_enabled?: boolean;
            tiers?: {
                saver?: Partial<DeliveryTierConfig>;
                standard?: Partial<DeliveryTierConfig>;
                priority?: Partial<DeliveryTierConfig>;
                saverHoldMinutes?: number;
                maxBatchSize?: number;
            };
        },
    ) {
        const brand = await this.findBrandForLoyalty(
            id,
            tenantId,
            allowedBrandIds,
        );
        if (dto.delivery_tiers_enabled !== undefined) {
            brand.deliveryTiersEnabled = dto.delivery_tiers_enabled;
        }
        const merged = this.mergeDeliveryTiers(
            brand.deliveryTiers,
            dto.tiers ?? null,
        );
        const errors = validateDeliveryTiers(
            merged,
            brand.deliveryTiersEnabled,
        );
        if (errors.length) {
            throw new BadRequestException(errors.join('; '));
        }
        brand.deliveryTiers = merged;
        await this.repo.save(brand);
        return this.toDeliveryTiersResponse(brand);
    }

    /** List the branches this brand is at (scoped to the user) with each branch's online open state. */
    async getBranchAvailability(
        brandId: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
        allowedBranchIds?: number[] | null,
    ) {
        if (allowedBrandIds != null && !allowedBrandIds.includes(brandId)) {
            throw new NotFoundException('Brand not found');
        }
        const brand = await this.repo.findOne({
            where:
                tenantId != null ? { id: brandId, tenantId } : { id: brandId },
        });
        if (!brand) throw new NotFoundException('Brand not found');
        let rows = await this.branchBrandRepo.find({
            where: { brandId },
            relations: ['branch'],
        });
        if (allowedBranchIds != null) {
            rows = rows.filter((r) => allowedBranchIds.includes(r.branchId));
        }
        return rows
            .map((r) => ({
                branch_id: r.branchId,
                branch_name: r.branch?.name ?? null,
                is_open: r.isOpen !== false,
            }))
            .sort((a, b) => a.branch_id - b.branch_id);
    }

    /** Set a brand's online availability across all its branches (restricted to allowedBranchIds when brand-locked/branch-locked). */
    async setAvailabilityEverywhere(
        brandId: number,
        isOpen: boolean,
        userId: number | null,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
        allowedBranchIds?: number[] | null,
    ) {
        if (allowedBrandIds != null && !allowedBrandIds.includes(brandId)) {
            throw new NotFoundException('Brand not found');
        }
        const brand = await this.repo.findOne({
            where:
                tenantId != null ? { id: brandId, tenantId } : { id: brandId },
        });
        if (!brand) throw new NotFoundException('Brand not found');
        let rows = await this.branchBrandRepo.find({ where: { brandId } });
        if (allowedBranchIds != null) {
            rows = rows.filter((r) => allowedBranchIds.includes(r.branchId));
        }
        for (const r of rows) {
            r.isOpen = isOpen;
            r.closedAt = isOpen ? null : new Date();
            r.closedByUserId = isOpen ? null : (userId ?? null);
        }
        await this.branchBrandRepo.save(rows);
        return { brand_id: brandId, is_open: isOpen, updated: rows.length };
    }

    async remove(id: number, tenantId: number) {
        const brand = await this.repo.findOne({ where: { id, tenantId } });
        if (!brand) throw new NotFoundException('Brand not found');
        await this.deleteBrandWithInventoryCleanup(brand);
        return { message: 'Brand deleted successfully' };
    }

    async removeForAdmin(id: number, tenantId: number | null) {
        const where = tenantId != null ? { id, tenantId } : { id };
        const brand = await this.repo.findOne({ where });
        if (!brand) throw new NotFoundException('Brand not found');
        await this.deleteBrandWithInventoryCleanup(brand);
        return { message: 'Brand deleted successfully' };
    }

    /**
     * Delete a brand, first releasing its brand-bucket inventory back to the branch pool.
     *
     * inventory_on_hand / inventory_batch_on_hand carry a nullable brand_id where NULL = the
     * branch pool and a non-null value is that brand's allocated bucket. The brands FK on those
     * tables is ON DELETE SET NULL, but a brand bucket row and its branch-pool (NULL) sibling
     * share a unique key `(branch, item|batch, COALESCE(location,0), COALESCE(brand,0))`, so a
     * plain SET NULL collides with the existing pool row and the whole delete fails. We instead
     * fold each brand bucket's qty back into the pool with the same additive upsert the inventory
     * service uses, drop the now-merged brand rows, then delete the brand — letting the remaining
     * FKs (ledger, transfers, shifts, branch_users, …) SET NULL / CASCADE cleanly.
     */
    private async deleteBrandWithInventoryCleanup(brand: Brand): Promise<void> {
        await this.repo.manager.transaction(async (em) => {
            await this.releaseBrandInventoryToBranchPool(em, brand.id);
            await em.remove(brand);
        });
    }

    private async releaseBrandInventoryToBranchPool(
        em: EntityManager,
        brandId: number,
    ): Promise<void> {
        // Serialize the fold against concurrent inventory movement on this brand.
        // The advisory lock coordinates with any other brand-inventory operation, and
        // locking the brand's existing on-hand rows FOR UPDATE makes a concurrent
        // consumption/transfer that decrements them wait until the fold+delete commit,
        // so stock cannot be captured with a stale value and then wiped by the DELETE.
        await advisoryXactLock(em, AdvisoryLock.BRAND_INVENTORY, brandId);
        await em.query(
            `SELECT 1 FROM inventory_on_hand WHERE brand_id = $1 ORDER BY id FOR UPDATE`,
            [brandId],
        );
        await em.query(
            `SELECT 1 FROM inventory_batch_on_hand WHERE brand_id = $1 ORDER BY id FOR UPDATE`,
            [brandId],
        );
        await em.query(
            `INSERT INTO inventory_on_hand
                (tenant_id, branch_id, inventory_item_id, location_id, brand_id, qty, updated_at)
             SELECT tenant_id, branch_id, inventory_item_id, location_id, NULL, qty, now()
             FROM inventory_on_hand WHERE brand_id = $1
             ON CONFLICT (branch_id, inventory_item_id, COALESCE(location_id, 0), COALESCE(brand_id, 0))
             DO UPDATE SET qty = inventory_on_hand.qty + EXCLUDED.qty, updated_at = now()`,
            [brandId],
        );
        await em.query(`DELETE FROM inventory_on_hand WHERE brand_id = $1`, [
            brandId,
        ]);

        await em.query(
            `INSERT INTO inventory_batch_on_hand
                (tenant_id, branch_id, inventory_batch_id, location_id, brand_id, qty, updated_at)
             SELECT tenant_id, branch_id, inventory_batch_id, location_id, NULL, qty, now()
             FROM inventory_batch_on_hand WHERE brand_id = $1
             ON CONFLICT (branch_id, inventory_batch_id, COALESCE(location_id, 0), COALESCE(brand_id, 0))
             DO UPDATE SET qty = inventory_batch_on_hand.qty + EXCLUDED.qty, updated_at = now()`,
            [brandId],
        );
        await em.query(
            `DELETE FROM inventory_batch_on_hand WHERE brand_id = $1`,
            [brandId],
        );
    }

    private toResponse(b: Brand) {
        return {
            id: b.id,
            name: b.name,
            slug: b.slug,
            description: b.description,
            logo_url: b.logoUrl,
            is_active: b.isActive,
            status: b.isActive ? 'active' : 'inactive',
            delivery_flat_fee: Number(b.deliveryFlatFee ?? 0),
            delivery_tiers_enabled: b.deliveryTiersEnabled === true,
            tenant_id: b.tenantId,
            created_at: b.createdAt?.toISOString() ?? null,
            updated_at: b.updatedAt?.toISOString() ?? null,
        };
    }

    /** Public brand JSON including consumer rating aggregates. */
    private toPublicResponse(
        b: Brand,
        agg: { avg: number; count: number } | undefined,
    ) {
        const base = this.toResponse(b);
        if (!agg || agg.count === 0) {
            return {
                ...base,
                rating_average: null as number | null,
                rating_count: 0,
            };
        }
        return {
            ...base,
            rating_average: Math.round(agg.avg * 10) / 10,
            rating_count: agg.count,
        };
    }
}
