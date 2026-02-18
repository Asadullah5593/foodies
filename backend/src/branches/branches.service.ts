import {
    Injectable,
    NotFoundException,
    ForbiddenException,
    BadRequestException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { randomBytes } from 'crypto';
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
    async findAllForAdmin(tenantId: number | null, brandId?: number) {
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
                .orderBy('b.id', 'ASC');
            const list = await qb.getMany();
            return list.map((b) => this.toResponse(b));
        }
        const list = await this.repo.find({
            order: { id: 'ASC' },
            relations: ['branchBrands', 'branchBrands.brand'],
        });
        return list.map((b) => this.toResponse(b));
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
        return this.toResponse(branch);
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
            is_active?: boolean;
            menu_enabled?: boolean;
            status?: string;
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

    private generateBranchCode(firstBrandId: number): string {
        const hex = randomBytes(4).toString('hex').toUpperCase();
        return `BR-${firstBrandId}-${hex}`;
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
        is_active?: boolean;
        menu_enabled?: boolean;
        status?: string;
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
                : this.generateBranchCode(brandIds[0]);
        const branch = await this.repo.save(
            this.repo.create({
                name: dto.name,
                code,
                address: dto.address ?? null,
                phone: dto.phone ?? null,
                email: dto.email ?? null,
                timezone: dto.timezone ?? 'UTC',
                operatingHours: dto.operating_hours ?? null,
                supportsDineIn: dto.supports_dine_in ?? true,
                supportsTakeaway: dto.supports_takeaway ?? true,
                supportsPickup: dto.supports_pickup ?? true,
                supportsDelivery: dto.supports_delivery ?? false,
                deliveryFlatFee: dto.delivery_flat_fee ?? 0,
                isActive: dto.is_active ?? true,
                menuEnabled: dto.menu_enabled ?? true,
                status: dto.status ?? 'active',
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
            is_active?: boolean;
            menu_enabled?: boolean;
            status?: string;
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
            is_active?: boolean;
            menu_enabled?: boolean;
            status?: string;
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
        if (dto.is_active !== undefined) branch.isActive = dto.is_active;
        if (dto.menu_enabled !== undefined)
            branch.menuEnabled = dto.menu_enabled;
        if (dto.status !== undefined) branch.status = dto.status;
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
        is_active: boolean;
        menu_enabled: boolean;
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
            is_active: b.isActive,
            menu_enabled: b.menuEnabled,
            status: b.status,
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
            is_active: boolean;
            menu_enabled: boolean;
            status: string;
            created_at: string | null;
            updated_at: string | null;
            brand_names?: string[];
            tenant_id?: number;
            tenant_name?: string | null;
        };
    }
}
