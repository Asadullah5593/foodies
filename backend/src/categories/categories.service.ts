import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MenuCategory } from '../entities/menu-category.entity';
import { Brand } from '../entities/brand.entity';

export interface CategoryFilters {
    brand_id?: number;
    is_active?: boolean;
    search?: string;
    sort?: 'name' | 'sort_order' | 'created_at';
    order?: 'asc' | 'desc';
}

/** Trim a free-text field; empty/whitespace (or null) becomes null. */
function normalizeText(input: string | null | undefined): string | null {
    if (input == null) return null;
    const s = String(input).trim();
    return s ? s : null;
}

@Injectable()
export class CategoriesService {
    constructor(
        @InjectRepository(MenuCategory)
        private repo: Repository<MenuCategory>,
        @InjectRepository(Brand)
        private brandRepo: Repository<Brand>,
    ) {}

    private async getBrandIdsForTenant(
        tenantId: number | null,
    ): Promise<number[] | null> {
        if (tenantId == null) return null;
        const brands = await this.brandRepo.find({
            where: { tenantId },
            select: ['id'],
        });
        return brands.map((b) => b.id);
    }

    private async assertBrandAccess(brandId: number, tenantId: number | null) {
        if (tenantId == null) return;
        const brand = await this.brandRepo.findOne({
            where: { id: brandId },
            select: ['tenantId'],
        });
        if (!brand || brand.tenantId !== tenantId)
            throw new ForbiddenException('Brand not found or access denied');
    }

    async findAll(
        tenantId: number | null,
        filters?: CategoryFilters,
        allowedBrandIds?: number[] | null,
    ) {
        const tenantBrandIds = await this.getBrandIdsForTenant(tenantId);
        // Brand-locked users only see their own brand's categories.
        const brandIds =
            allowedBrandIds == null
                ? tenantBrandIds
                : tenantBrandIds == null
                  ? allowedBrandIds
                  : tenantBrandIds.filter((id) => allowedBrandIds.includes(id));
        if (
            allowedBrandIds != null &&
            filters?.brand_id != null &&
            !allowedBrandIds.includes(filters.brand_id)
        ) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
        const qb = this.repo
            .createQueryBuilder('c')
            .leftJoinAndSelect('c.brand', 'b', 'b.id = c.brandId')
            .select([
                'c.id',
                'c.brandId',
                'c.name',
                'c.description',
                'c.imageUrl',
                'c.sortOrder',
                'c.isActive',
                'c.createdAt',
                'c.updatedAt',
                'b.id',
                'b.name',
                'b.slug',
            ]);

        if (brandIds !== null) {
            if (brandIds.length === 0) return [];
            qb.andWhere('c.brandId IN (:...brandIds)', { brandIds });
        }

        if (filters?.brand_id != null) {
            if (tenantId != null)
                await this.assertBrandAccess(filters.brand_id, tenantId);
            qb.andWhere('c.brandId = :brandId', { brandId: filters.brand_id });
        }

        if (filters?.is_active !== undefined) {
            qb.andWhere('c.isActive = :isActive', {
                isActive: filters.is_active,
            });
        }

        if (filters?.search?.trim()) {
            qb.andWhere('(c.name ILIKE :search)', {
                search: `%${filters.search.trim()}%`,
            });
        }

        const sort = filters?.sort ?? 'sort_order';
        const order = (filters?.order ?? 'asc').toUpperCase() as 'ASC' | 'DESC';
        if (sort === 'name') {
            qb.orderBy('c.name', order).addOrderBy('c.id', 'ASC');
        } else if (sort === 'created_at') {
            qb.orderBy('c.createdAt', order).addOrderBy('c.id', 'ASC');
        } else {
            qb.orderBy('c.sortOrder', order)
                .addOrderBy('c.name', 'ASC')
                .addOrderBy('c.id', 'ASC');
        }

        const list = await qb.getMany();
        return list.map((c) => this.toResponse(c));
    }

    async findOne(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        const cat = await this.repo.findOne({
            where: { id },
            relations: ['brand'],
        });
        if (!cat) throw new NotFoundException('Category not found');
        const brandIds = await this.getBrandIdsForTenant(tenantId);
        if (brandIds !== null && !brandIds.includes(cat.brandId))
            throw new ForbiddenException('Category not found or access denied');
        if (allowedBrandIds != null && !allowedBrandIds.includes(cat.brandId))
            throw new ForbiddenException('Category not found or access denied');
        return this.toResponse(cat);
    }

    async create(
        dto: {
            brand_id: number;
            name: string;
            is_active?: boolean;
            sort_order?: number;
            description?: string | null;
            image_url?: string | null;
        },
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        if (
            allowedBrandIds != null &&
            !allowedBrandIds.includes(dto.brand_id)
        ) {
            throw new ForbiddenException(
                'You can only create categories for your own brand',
            );
        }
        if (tenantId != null)
            await this.assertBrandAccess(dto.brand_id, tenantId);
        const name = String(dto.name ?? '').trim();
        if (!name) throw new BadRequestException('Name is required');
        const cat = await this.repo.save(
            this.repo.create({
                brandId: dto.brand_id,
                name,
                description: normalizeText(dto.description),
                imageUrl: normalizeText(dto.image_url),
                sortOrder: dto.sort_order ?? 0,
                isActive: dto.is_active ?? true,
            }),
        );
        return this.toResponse(cat);
    }

    async update(
        id: number,
        dto: {
            name?: string;
            is_active?: boolean;
            sort_order?: number;
            description?: string | null;
            image_url?: string | null;
        },
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        const cat = await this.repo.findOne({ where: { id } });
        if (!cat) throw new NotFoundException('Category not found');
        const brandIds = await this.getBrandIdsForTenant(tenantId);
        if (brandIds !== null && !brandIds.includes(cat.brandId))
            throw new ForbiddenException('Category not found or access denied');
        if (allowedBrandIds != null && !allowedBrandIds.includes(cat.brandId))
            throw new ForbiddenException('Category not found or access denied');
        if (dto.name !== undefined) {
            const name = String(dto.name).trim();
            if (!name) throw new BadRequestException('Name cannot be empty');
            cat.name = name;
        }
        if (dto.is_active !== undefined) cat.isActive = dto.is_active;
        if (dto.sort_order !== undefined) cat.sortOrder = dto.sort_order;
        if (dto.description !== undefined)
            cat.description = normalizeText(dto.description);
        if (dto.image_url !== undefined)
            cat.imageUrl = normalizeText(dto.image_url);
        await this.repo.save(cat);
        return this.toResponse(cat);
    }

    async remove(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        const cat = await this.repo.findOne({ where: { id } });
        if (!cat) throw new NotFoundException('Category not found');
        const brandIds = await this.getBrandIdsForTenant(tenantId);
        if (brandIds !== null && !brandIds.includes(cat.brandId))
            throw new ForbiddenException('Category not found or access denied');
        if (allowedBrandIds != null && !allowedBrandIds.includes(cat.brandId))
            throw new ForbiddenException('Category not found or access denied');
        await this.repo.remove(cat);
        return { message: 'Category deleted successfully' };
    }

    private toResponse(c: MenuCategory & { brand?: Brand }) {
        return {
            id: c.id,
            brand_id: c.brandId,
            name: c.name,
            description: c.description ?? null,
            image_url: c.imageUrl ?? null,
            sort_order: c.sortOrder,
            is_active: c.isActive,
            created_at: c.createdAt?.toISOString() ?? null,
            updated_at: c.updatedAt?.toISOString() ?? null,
            ...(c.brand && {
                brand: {
                    id: c.brand.id,
                    name: c.brand.name,
                    slug: c.brand.slug,
                },
            }),
        };
    }
}
