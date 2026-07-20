import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { Brand } from '../entities/brand.entity';
import { BranchBrand } from '../entities/branch-brand.entity';

@Injectable()
export class BranchesService {
    constructor(
        @InjectRepository(Branch)
        private repo: Repository<Branch>,
        @InjectRepository(Brand)
        private brandRepo: Repository<Brand>,
        @InjectRepository(BranchBrand)
        private branchBrandRepo: Repository<BranchBrand>,
    ) {}

    /** Admin: tenant user sees only their tenant's branches; super admin sees all with tenant_name + brand_names */
    async findAllForAdmin(
        tenantId: number | null,
        brandId?: number,
        allowedBranchIds?: number[] | null,
    ) {
        if (Array.isArray(allowedBranchIds) && allowedBranchIds.length === 0) {
            return [];
        }
        const qb = this.repo
            .createQueryBuilder('b')
            .leftJoinAndSelect('b.branchBrands', 'bb')
            .leftJoinAndSelect('bb.brand', 'brand')
            .leftJoinAndSelect('brand.tenant', 'tenant')
            .orderBy('b.id', 'ASC');
        if (tenantId != null) {
            qb.andWhere('brand.tenantId = :tenantId', { tenantId });
        }
        if (brandId != null) {
            qb.andWhere('bb.brandId = :brandId', { brandId });
        }
        if (Array.isArray(allowedBranchIds)) {
            qb.andWhere('b.id IN (:...allowedBranchIds)', { allowedBranchIds });
        }
        const list = await qb.getMany();
        return list.map((b) => this.toResponse(b));
    }

    async findAll(brandId?: number) {
        if (brandId != null) {
            const qb = this.repo
                .createQueryBuilder('b')
                .innerJoin('b.branchBrands', 'bb', 'bb.brandId = :brandId', {
                    brandId,
                })
                // Consumer-facing: only active branches.
                .where('b.isActive = :active', { active: true })
                .orderBy('b.id', 'ASC');
            const list = await qb.getMany();
            return list.map((b) => this.toResponse(b));
        }
        const list = await this.repo.find({
            // Consumer-facing: only active branches.
            where: { isActive: true },
            order: { id: 'ASC' },
            relations: ['branchBrands', 'branchBrands.brand'],
        });
        return list.map((b) => this.toResponse(b));
    }

    /** Haversine distance in km between two points (lat/lng in degrees). */
    private haversineKm(
        lat1: number,
        lng1: number,
        lat2: number,
        lng2: number,
    ): number {
        const R = 6371;
        const dLat = ((lat2 - lat1) * Math.PI) / 180;
        const dLng = ((lng2 - lng1) * Math.PI) / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos((lat1 * Math.PI) / 180) *
                Math.cos((lat2 * Math.PI) / 180) *
                Math.sin(dLng / 2) *
                Math.sin(dLng / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    /**
     * Branches whose own delivery radius covers the given point. A branch is shown only when
     * it is active, has its menu enabled, has latitude/longitude set, and the customer is within
     * that branch's configured deliveryRadiusKm. The `maxRadiusKm` argument is an optional hard
     * cap (e.g. from the client) so a branch with a very large radius can still be excluded when
     * the customer is unreasonably far; pass a large value to disable the cap. Sorted by distance.
     */
    async findAllWithinRadius(
        latitude: number,
        longitude: number,
        maxRadiusKm: number = 100000,
    ) {
        const withDistance = await this.findNearbyWithBrands(
            latitude,
            longitude,
            maxRadiusKm,
        );
        return withDistance.map(({ branch }) => this.toResponse(branch));
    }

    /**
     * Same in-range rule as {@link findAllWithinRadius}, but returns the raw branch entities
     * (with `branchBrands.brand` loaded) plus each branch's distance, sorted by distance. Used
     * by consumer brand/category-by-location endpoints that need the branch↔brand links.
     */
    async findNearbyWithBrands(
        latitude: number,
        longitude: number,
        maxRadiusKm: number = 100000,
    ): Promise<Array<{ branch: Branch; distanceKm: number }>> {
        const list = await this.repo.find({
            // Consumer-facing: only active branches.
            where: { isActive: true },
            relations: ['branchBrands', 'branchBrands.brand'],
            order: { id: 'ASC' },
        });
        const withDistance = list
            .filter((b) => b.latitude != null && b.longitude != null)
            .map((b) => ({
                branch: b,
                distanceKm: this.haversineKm(
                    latitude,
                    longitude,
                    Number(b.latitude),
                    Number(b.longitude),
                ),
            }))
            // Customer must be inside the branch's own delivery radius (and the client cap).
            .filter(
                ({ branch, distanceKm }) =>
                    distanceKm <= Number(branch.deliveryRadiusKm) &&
                    distanceKm <= maxRadiusKm,
            )
            .sort((a, b) => a.distanceKm - b.distanceKm);
        return withDistance;
    }

    /** Admin: tenant user can only view own tenant's branch; super admin any */
    async findOneForAdmin(id: number, tenantId: number | null) {
        const branch = await this.repo.findOne({
            where: { id },
            relations: [
                'branchBrands',
                'branchBrands.brand',
                'branchBrands.brand.tenant',
            ],
        });
        if (!branch) throw new NotFoundException('Branch not found');
        const brands = (branch.branchBrands ?? [])
            .map((bb) => bb.brand)
            .filter(Boolean);
        if (tenantId != null && brands.length > 0) {
            const allowed = brands.some(
                (br) =>
                    (br as Brand & { tenantId: number }).tenantId === tenantId,
            );
            if (!allowed)
                throw new ForbiddenException(
                    'Branch does not belong to your tenant',
                );
        }
        // FBR settings ride ONLY on this admin read — toResponse is shared with
        // consumer-facing lookups and must never expose the FBR token.
        return {
            ...this.toResponse(branch),
            fbr_enabled: branch.fbrEnabled,
            fbr_pos_id: branch.fbrPosId,
            fbr_token: branch.fbrToken,
            fbr_environment: branch.fbrEnvironment,
            fbr_pct_code: branch.fbrPctCode,
        };
    }

    async findOne(id: number) {
        const branch = await this.repo.findOne({
            where: { id },
            relations: ['branchBrands', 'branchBrands.brand'],
        });
        if (!branch) throw new NotFoundException('Branch not found');
        return this.toResponse(branch);
    }

    /** Returns first brand's tenantId for branch (for menu/order tenant scope). At least one brand required. */
    async getPrimaryTenantId(branchId: number): Promise<number | null> {
        const bb = await this.branchBrandRepo.findOne({
            where: { branchId },
            relations: ['brand'],
        });
        if (!bb?.brand) return null;
        return bb.brand.tenantId;
    }

    /** Returns brand IDs for branch. If brandId provided, returns that id only if branch has it. */
    async getBranchBrandIds(
        branchId: number,
        filterBrandId?: number,
    ): Promise<number[]> {
        const rows = await this.branchBrandRepo.find({
            where: {
                branchId,
                ...(filterBrandId != null ? { brandId: filterBrandId } : {}),
            },
        });
        return rows.map((r) => r.brandId);
    }

    /** Admin: tenant user can only create under their tenant's brands; super admin any brand */
    async createForAdmin(
        dto: {
            brand_ids: number[];
            name: string;
            code?: string;
            address?: string;
            phone?: string;
            email?: string;
            timezone?: string;
            operating_hours?: Record<string, unknown>;
            supports_dine_in?: boolean;
            supports_takeaway?: boolean;
            supports_pickup?: boolean;
            supports_delivery?: boolean;
            delivery_flat_fee?: number;
            delivery_radius_km?: number;
            is_active?: boolean;
            status?: string;
            latitude?: number | null;
            longitude?: number | null;
        },
        tenantId: number | null,
    ) {
        const brandIds = Array.isArray(dto.brand_ids)
            ? dto.brand_ids.map((id) => +id).filter((id) => Number.isFinite(id))
            : [];
        if (brandIds.length === 0)
            throw new ForbiddenException('At least one brand is required');
        if (tenantId != null) {
            const brands = await this.brandRepo.find({
                where: { id: In(brandIds), tenantId },
            });
            if (brands.length !== brandIds.length) {
                throw new ForbiddenException(
                    'One or more brands not found or do not belong to your tenant',
                );
            }
        }
        return this.create(dto);
    }

    /**
     * Auto-generate a short, human-friendly branch code like `BR-23` (BR + first
     * brand id). This becomes the prefix of every order number for the branch
     * (e.g. `BR-23-001`). `branches.code` is unique, so when the base is already
     * taken (another branch shares the brand) we append a numeric suffix:
     * `BR-23-2`, `BR-23-3`, …
     */
    private async generateBranchCode(firstBrandId: number): Promise<string> {
        const base = `BR-${firstBrandId}`;
        if (!(await this.repo.findOne({ where: { code: base } }))) return base;
        for (let n = 2; ; n++) {
            const candidate = `${base}-${n}`;
            if (!(await this.repo.findOne({ where: { code: candidate } })))
                return candidate;
        }
    }

    private assertAtLeastOneOrderType(supports: {
        dine_in?: boolean;
        takeaway?: boolean;
        pickup?: boolean;
        delivery?: boolean;
    }) {
        const any =
            supports.dine_in === true ||
            supports.takeaway === true ||
            supports.pickup === true ||
            supports.delivery === true;
        if (!any) {
            throw new BadRequestException(
                'At least one of Dine-in, Takeaway, Pickup or Delivery must be enabled for the branch.',
            );
        }
    }

    async create(dto: {
        brand_ids: number[];
        name: string;
        code?: string;
        address?: string;
        phone?: string;
        email?: string;
        timezone?: string;
        operating_hours?: Record<string, unknown>;
        supports_dine_in?: boolean;
        supports_takeaway?: boolean;
        supports_pickup?: boolean;
        supports_delivery?: boolean;
        delivery_flat_fee?: number;
        delivery_radius_km?: number;
        gst_rate_cash?: number | null;
        gst_rate_card?: number | null;
        is_active?: boolean;
        status?: string;
        latitude?: number | null;
        longitude?: number | null;
    }) {
        const brandIds = Array.isArray(dto.brand_ids)
            ? dto.brand_ids.map((id) => +id).filter((id) => Number.isFinite(id))
            : [];
        if (brandIds.length === 0)
            throw new ForbiddenException('At least one brand is required');
        this.assertAtLeastOneOrderType({
            dine_in: dto.supports_dine_in ?? true,
            takeaway: dto.supports_takeaway ?? true,
            pickup: dto.supports_pickup ?? true,
            delivery: dto.supports_delivery ?? false,
        });
        const code =
            dto.code && dto.code.trim() !== ''
                ? dto.code.trim()
                : await this.generateBranchCode(brandIds[0]);
        const branch = await this.repo.save(
            this.repo.create({
                name: dto.name,
                code,
                address: dto.address ?? null,
                phone: dto.phone ?? null,
                email: dto.email ?? null,
                timezone: dto.timezone ?? 'Asia/Karachi',
                operatingHours: dto.operating_hours ?? null,
                supportsDineIn: dto.supports_dine_in ?? true,
                supportsTakeaway: dto.supports_takeaway ?? true,
                supportsPickup: dto.supports_pickup ?? true,
                supportsDelivery: dto.supports_delivery ?? false,
                deliveryFlatFee: dto.delivery_flat_fee ?? 0,
                deliveryRadiusKm: dto.delivery_radius_km ?? 10,
                gstRateCash: dto.gst_rate_cash ?? null,
                gstRateCard: dto.gst_rate_card ?? null,
                isActive: dto.is_active ?? true,
                // Single source of truth: status derived from is_active.
                status: (dto.is_active ?? true) ? 'active' : 'inactive',
                latitude: dto.latitude ?? null,
                longitude: dto.longitude ?? null,
            }),
        );
        await this.branchBrandRepo.save(
            brandIds.map((brandId) =>
                this.branchBrandRepo.create({ branchId: branch.id, brandId }),
            ),
        );
        const saved = await this.repo.findOne({
            where: { id: branch.id },
            relations: [
                'branchBrands',
                'branchBrands.brand',
                'branchBrands.brand.tenant',
            ],
        });
        return this.toResponse(saved ?? branch);
    }

    /** Admin: tenant user can only update own tenant's branch; super admin any */
    async updateForAdmin(
        id: number,
        tenantId: number | null,
        dto: {
            brand_ids?: number[];
            name?: string;
            code?: string;
            address?: string;
            phone?: string;
            email?: string;
            timezone?: string;
            operating_hours?: Record<string, unknown>;
            supports_dine_in?: boolean;
            supports_takeaway?: boolean;
            supports_pickup?: boolean;
            supports_delivery?: boolean;
            delivery_flat_fee?: number;
            delivery_radius_km?: number;
            is_active?: boolean;
            status?: string;
            fbr_enabled?: boolean;
            fbr_pos_id?: string | null;
            fbr_token?: string | null;
            fbr_environment?: string;
            fbr_pct_code?: string | null;
        },
    ) {
        const branch = await this.repo.findOne({
            where: { id },
            relations: ['branchBrands', 'branchBrands.brand'],
        });
        if (!branch) throw new NotFoundException('Branch not found');
        const brands = (branch.branchBrands ?? [])
            .map((bb) => bb.brand)
            .filter(Boolean);
        if (tenantId != null && brands.length > 0) {
            const allowed = brands.some((br) => br.tenantId === tenantId);
            if (!allowed)
                throw new ForbiddenException(
                    'Branch does not belong to your tenant',
                );
        }
        if (dto.brand_ids !== undefined) {
            const brandIds = Array.isArray(dto.brand_ids)
                ? dto.brand_ids
                      .map((id) => +id)
                      .filter((id) => Number.isFinite(id))
                : [];
            if (brandIds.length === 0)
                throw new ForbiddenException('At least one brand is required');
            if (tenantId != null) {
                const brandsCheck = await this.brandRepo.find({
                    where: { id: In(brandIds), tenantId },
                });
                if (brandsCheck.length !== brandIds.length) {
                    throw new ForbiddenException(
                        'One or more brands not found or do not belong to your tenant',
                    );
                }
            }
            await this.branchBrandRepo.delete({ branchId: id });
            await this.branchBrandRepo.save(
                brandIds.map((brandId) =>
                    this.branchBrandRepo.create({ branchId: id, brandId }),
                ),
            );
            // Drop per-branch menu mappings for brands no longer linked here,
            // otherwise they linger as orphans (counted as "linked" and, worse,
            // still sellable). See getBranchMenu's brand guard.
            await this.repo.manager
                .createQueryBuilder()
                .delete()
                .from('branch_menu_items')
                .where('branch_id = :branchId', { branchId: id })
                .andWhere(
                    'menu_item_id IN (SELECT id FROM menu_items WHERE brand_id NOT IN (:...brandIds))',
                    { brandIds },
                )
                .execute();
        }
        return this.update(id, dto);
    }

    async update(
        id: number,
        dto: {
            name?: string;
            code?: string;
            address?: string;
            phone?: string;
            email?: string;
            timezone?: string;
            operating_hours?: Record<string, unknown>;
            supports_dine_in?: boolean;
            supports_takeaway?: boolean;
            supports_pickup?: boolean;
            supports_delivery?: boolean;
            delivery_flat_fee?: number;
            delivery_radius_km?: number;
            gst_rate_cash?: number | null;
            gst_rate_card?: number | null;
            is_active?: boolean;
            status?: string;
            latitude?: number | null;
            longitude?: number | null;
            fbr_enabled?: boolean;
            fbr_pos_id?: string | null;
            fbr_token?: string | null;
            fbr_environment?: string;
            fbr_pct_code?: string | null;
        },
    ) {
        const branch = await this.repo.findOne({ where: { id } });
        if (!branch) throw new NotFoundException('Branch not found');
        if (dto.name !== undefined) branch.name = dto.name;
        if (dto.code !== undefined) branch.code = dto.code;
        if (dto.address !== undefined) branch.address = dto.address;
        if (dto.phone !== undefined) branch.phone = dto.phone;
        if (dto.email !== undefined) branch.email = dto.email;
        if (dto.timezone !== undefined) branch.timezone = dto.timezone;
        if (dto.operating_hours !== undefined)
            branch.operatingHours = dto.operating_hours;
        if (dto.supports_dine_in !== undefined)
            branch.supportsDineIn = dto.supports_dine_in;
        if (dto.supports_takeaway !== undefined)
            branch.supportsTakeaway = dto.supports_takeaway;
        if (dto.supports_pickup !== undefined)
            branch.supportsPickup = dto.supports_pickup;
        if (dto.supports_delivery !== undefined)
            branch.supportsDelivery = dto.supports_delivery;
        this.assertAtLeastOneOrderType({
            dine_in: branch.supportsDineIn,
            takeaway: branch.supportsTakeaway,
            pickup: branch.supportsPickup,
            delivery: branch.supportsDelivery,
        });
        if (dto.delivery_flat_fee !== undefined)
            branch.deliveryFlatFee = dto.delivery_flat_fee;
        if (dto.delivery_radius_km !== undefined)
            branch.deliveryRadiusKm = dto.delivery_radius_km;
        if (dto.gst_rate_cash !== undefined)
            branch.gstRateCash = dto.gst_rate_cash;
        if (dto.gst_rate_card !== undefined)
            branch.gstRateCard = dto.gst_rate_card;
        if (dto.is_active !== undefined) branch.isActive = dto.is_active;
        // Single source of truth: status derived from isActive.
        branch.status = branch.isActive ? 'active' : 'inactive';
        if (dto.latitude !== undefined) branch.latitude = dto.latitude;
        if (dto.longitude !== undefined) branch.longitude = dto.longitude;
        // FBR settings. Disabling keeps the saved credentials (Skechers
        // behavior) so re-enabling needs no re-entry; enabling requires them.
        if (dto.fbr_pos_id !== undefined)
            branch.fbrPosId = dto.fbr_pos_id?.trim() || null;
        if (dto.fbr_token !== undefined)
            branch.fbrToken = dto.fbr_token?.trim() || null;
        if (dto.fbr_pct_code !== undefined)
            branch.fbrPctCode = dto.fbr_pct_code?.trim() || null;
        if (dto.fbr_environment !== undefined) {
            if (!['sandbox', 'live'].includes(dto.fbr_environment)) {
                throw new BadRequestException(
                    'FBR environment must be "sandbox" or "live"',
                );
            }
            branch.fbrEnvironment = dto.fbr_environment;
        }
        if (dto.fbr_enabled !== undefined) branch.fbrEnabled = dto.fbr_enabled;
        if (branch.fbrEnabled && (!branch.fbrPosId || !branch.fbrToken)) {
            throw new BadRequestException(
                'FBR POS ID and token are required to enable FBR for this branch',
            );
        }
        await this.repo.save(branch);
        const updated = await this.repo.findOne({
            where: { id },
            relations: [
                'branchBrands',
                'branchBrands.brand',
                'branchBrands.brand.tenant',
            ],
        });
        return this.toResponse(updated ?? branch);
    }

    /** Admin: tenant user can only delete own tenant's branch; super admin any */
    async removeForAdmin(id: number, tenantId: number | null) {
        const branch = await this.repo.findOne({
            where: { id },
            relations: ['branchBrands', 'branchBrands.brand'],
        });
        if (!branch) throw new NotFoundException('Branch not found');
        const brands = (branch.branchBrands ?? [])
            .map((bb) => bb.brand)
            .filter(Boolean);
        if (tenantId != null && brands.length > 0) {
            const allowed = brands.some((br) => br.tenantId === tenantId);
            if (!allowed)
                throw new ForbiddenException(
                    'Branch does not belong to your tenant',
                );
        }
        await this.repo.remove(branch);
        return { message: 'Branch deleted successfully' };
    }

    async remove(id: number) {
        const branch = await this.repo.findOne({ where: { id } });
        if (!branch) throw new NotFoundException('Branch not found');
        await this.repo.remove(branch);
        return { message: 'Branch deleted successfully' };
    }

    private toResponse(
        b: Branch & {
            branchBrands?: Array<{
                brandId: number;
                brand?: Brand & { tenant?: { name: string } };
            }>;
        },
    ): {
        id: number;
        brand_ids: number[];
        name: string;
        code: string;
        address: string | null;
        phone: string | null;
        email: string | null;
        timezone: string;
        operating_hours: Record<string, unknown> | null;
        supports_dine_in: boolean;
        supports_takeaway: boolean;
        supports_pickup: boolean;
        supports_delivery: boolean;
        delivery_flat_fee: number;
        delivery_radius_km: number;
        gst_rate_cash: number | null;
        gst_rate_card: number | null;
        is_active: boolean;
        status: string;
        created_at: string | null;
        updated_at: string | null;
        brand_names?: string[];
        tenant_id?: number;
        tenant_name?: string | null;
    } {
        const branchBrands = b.branchBrands ?? [];
        const brandIds = branchBrands.map((bb) => bb.brandId);
        const brandNames = branchBrands
            .map((bb) => bb.brand?.name)
            .filter(Boolean);
        const firstBrand = branchBrands[0]?.brand as
            | (Brand & { tenant?: { name: string } })
            | undefined;
        const out: Record<string, unknown> = {
            id: b.id,
            brand_ids: brandIds,
            name: b.name,
            code: b.code,
            address: b.address,
            phone: b.phone,
            email: b.email,
            timezone: b.timezone,
            operating_hours: b.operatingHours,
            supports_dine_in: b.supportsDineIn,
            supports_takeaway: b.supportsTakeaway,
            supports_pickup: b.supportsPickup,
            supports_delivery: b.supportsDelivery,
            delivery_flat_fee: Number(b.deliveryFlatFee),
            delivery_radius_km: Number(b.deliveryRadiusKm),
            gst_rate_cash: b.gstRateCash != null ? Number(b.gstRateCash) : null,
            gst_rate_card: b.gstRateCard != null ? Number(b.gstRateCard) : null,
            is_active: b.isActive,
            status: b.status,
            latitude: b.latitude != null ? Number(b.latitude) : null,
            longitude: b.longitude != null ? Number(b.longitude) : null,
            created_at: b.createdAt?.toISOString() ?? null,
            updated_at: b.updatedAt?.toISOString() ?? null,
        };
        if (brandNames.length) out.brand_names = brandNames;
        if (firstBrand) {
            out.tenant_id = firstBrand.tenantId;
            out.tenant_name = firstBrand.tenant?.name ?? null;
        }
        return out as {
            id: number;
            brand_ids: number[];
            name: string;
            code: string;
            address: string | null;
            phone: string | null;
            email: string | null;
            timezone: string;
            operating_hours: Record<string, unknown> | null;
            supports_dine_in: boolean;
            supports_takeaway: boolean;
            supports_pickup: boolean;
            supports_delivery: boolean;
            delivery_flat_fee: number;
            delivery_radius_km: number;
            gst_rate_cash: number | null;
            gst_rate_card: number | null;
            is_active: boolean;
            status: string;
            created_at: string | null;
            updated_at: string | null;
            brand_names?: string[];
            tenant_id?: number;
            tenant_name?: string | null;
        };
    }

    // ---------------------------------------------------------------------
    // Per-(branch,brand) online open/close
    // ---------------------------------------------------------------------

    private assertBranchAccess(
        branchId: number,
        allowedBranchIds?: number[] | null,
    ) {
        if (allowedBranchIds != null && !allowedBranchIds.includes(branchId)) {
            throw new ForbiddenException(
                'You do not have access to this branch',
            );
        }
    }

    /** List brands at a branch with their online open/close state (admin UI). */
    async getBrandAvailability(
        branchId: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
        allowedBranchIds?: number[] | null,
    ) {
        this.assertBranchAccess(branchId, allowedBranchIds);
        const rows = await this.branchBrandRepo.find({
            where: { branchId },
            relations: ['brand'],
        });
        return rows
            .filter(
                (r) =>
                    (allowedBrandIds == null ||
                        allowedBrandIds.includes(r.brandId)) &&
                    (tenantId == null || r.brand?.tenantId === tenantId),
            )
            .map((r) => ({
                brand_id: r.brandId,
                name: r.brand?.name ?? null,
                is_open: r.isOpen !== false,
                closed_at: r.closedAt ? r.closedAt.toISOString() : null,
            }))
            .sort((a, b) => a.brand_id - b.brand_id);
    }

    /** Toggle ONE brand's online availability at ONE branch. */
    async setBrandAvailability(
        branchId: number,
        brandId: number,
        isOpen: boolean,
        userId: number | null,
        allowedBrandIds?: number[] | null,
        allowedBranchIds?: number[] | null,
    ) {
        this.assertBranchAccess(branchId, allowedBranchIds);
        if (allowedBrandIds != null && !allowedBrandIds.includes(brandId)) {
            throw new ForbiddenException('You can only manage your own brand');
        }
        const row = await this.branchBrandRepo.findOne({
            where: { branchId, brandId },
        });
        if (!row)
            throw new NotFoundException('Brand is not assigned to this branch');
        this.applyOpenState(row, isOpen, userId);
        await this.branchBrandRepo.save(row);
        return { branch_id: branchId, brand_id: brandId, is_open: isOpen };
    }

    /** Bulk: set ALL brands at a branch open/closed (GM/branch-manager). */
    async setAllBrandsAvailabilityAtBranch(
        branchId: number,
        isOpen: boolean,
        userId: number | null,
        allowedBranchIds?: number[] | null,
    ) {
        this.assertBranchAccess(branchId, allowedBranchIds);
        const rows = await this.branchBrandRepo.find({ where: { branchId } });
        for (const r of rows) this.applyOpenState(r, isOpen, userId);
        await this.branchBrandRepo.save(rows);
        return { branch_id: branchId, is_open: isOpen, updated: rows.length };
    }

    private applyOpenState(
        row: BranchBrand,
        isOpen: boolean,
        userId: number | null,
    ) {
        row.isOpen = isOpen;
        row.closedAt = isOpen ? null : new Date();
        row.closedByUserId = isOpen ? null : (userId ?? null);
    }

    /** Is a brand currently accepting online orders at a branch? (default true). */
    async isBrandOpenAt(branchId: number, brandId: number): Promise<boolean> {
        const row = await this.branchBrandRepo.findOne({
            where: { branchId, brandId },
        });
        return row ? row.isOpen !== false : true;
    }
}
