import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Brand } from '../entities/brand.entity';
import { BranchBrand } from '../entities/branch-brand.entity';
import { BrandOrderRating } from '../entities/brand-order-rating.entity';
import { MediaStorageService } from '../media/media-storage.service';

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
            return list.map((b) => ({
                ...this.toResponse(b),
                ...this.mergeAdminRatingFields(b.id, aggMap),
            }));
        }
        const list = await this.repo.find({
            relations: ['tenant'],
            order: { id: 'ASC' },
        });
        const aggMap = await this.loadRatingAggregates(list.map((b) => b.id));
        return list.map((b) => ({
            ...this.toResponse(b),
            ...this.mergeAdminRatingFields(b.id, aggMap),
            tenant_name:
                (b as Brand & { tenant?: { name: string } }).tenant?.name ??
                null,
        }));
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
        // Consumer-facing: a disabled-menu or inactive branch exposes no brands
        // (mirrors POS, where the whole menu is hidden when menu is disabled).
        const branch = branchBrands[0]?.branch;
        if (branch && (!branch.isActive || !branch.menuEnabled)) return [];
        const brandIds = branchBrands.map((bb) => bb.brandId);
        if (brandIds.length === 0) return [];
        const list = await this.repo.find({
            where: { id: In(brandIds), isActive: true },
            order: { id: 'ASC' },
        });
        const filtered = this.filterBrandsBySearch(list, search);
        const aggMap = await this.loadRatingAggregates(
            filtered.map((b) => b.id),
        );
        return filtered.map((b) => this.toPublicResponse(b, aggMap.get(b.id)));
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

    async remove(id: number, tenantId: number) {
        const brand = await this.repo.findOne({ where: { id, tenantId } });
        if (!brand) throw new NotFoundException('Brand not found');
        await this.repo.remove(brand);
        return { message: 'Brand deleted successfully' };
    }

    async removeForAdmin(id: number, tenantId: number | null) {
        const where = tenantId != null ? { id, tenantId } : { id };
        const brand = await this.repo.findOne({ where });
        if (!brand) throw new NotFoundException('Brand not found');
        await this.repo.remove(brand);
        return { message: 'Brand deleted successfully' };
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
