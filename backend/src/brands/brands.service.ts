import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Brand } from '../entities/brand.entity';
import { BranchBrand } from '../entities/branch-brand.entity';

@Injectable()
export class BrandsService {
    constructor(
        @InjectRepository(Brand)
        private repo: Repository<Brand>,
        @InjectRepository(BranchBrand)
        private branchBrandRepo: Repository<BranchBrand>,
    ) {}

    /** Admin: tenant user sees only their tenant's brands; super admin (tenantId null) sees all with tenant_name */
    async findAllForAdmin(tenantId: number | null) {
        if (tenantId != null) {
            const list = await this.repo.find({
                where: { tenantId },
                order: { id: 'ASC' },
            });
            return list.map((b) => this.toResponse(b));
        }
        const list = await this.repo.find({
            relations: ['tenant'],
            order: { id: 'ASC' },
        });
        return list.map((b) => ({
            ...this.toResponse(b),
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
        const mapped = list.map((b) => this.toResponse(b));
        return this.filterBrandsBySearch(mapped, search);
    }

    /** Public: active brands at a specific branch (for consumer app). Optional search filters by brand name. */
    async findAllPublicByBranchId(branchId: number, search?: string) {
        const branchBrands = await this.branchBrandRepo.find({
            where: { branchId },
            select: ['brandId'],
        });
        const brandIds = branchBrands.map((bb) => bb.brandId);
        if (brandIds.length === 0) return [];
        const list = await this.repo.find({
            where: { id: In(brandIds), isActive: true },
            order: { id: 'ASC' },
        });
        const mapped = list.map((b) => this.toResponse(b));
        return this.filterBrandsBySearch(mapped, search);
    }

    /** Public: active brands by explicit id list (for consumer app helpers). */
    async findAllPublicByIds(ids: number[]) {
        if (!ids.length) return [];
        const list = await this.repo.find({
            where: { id: In(ids), isActive: true },
            order: { id: 'ASC' },
        });
        return list.map((b) => this.toResponse(b));
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
        return this.toResponse(brand);
    }

    /** Admin: tenant user can only view own tenant's brand; super admin can view any */
    async findOneForAdmin(id: number, tenantId: number | null) {
        const brand = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
            relations: tenantId == null ? ['tenant'] : undefined,
        });
        if (!brand) throw new NotFoundException('Brand not found');
        const out = this.toResponse(brand);
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
        },
    ) {
        const where = tenantId != null ? { id, tenantId } : { id };
        const brand = await this.repo.findOne({ where });
        if (!brand) throw new NotFoundException('Brand not found');
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
            tenant_id: b.tenantId,
            created_at: b.createdAt?.toISOString() ?? null,
            updated_at: b.updatedAt?.toISOString() ?? null,
        };
    }
}
