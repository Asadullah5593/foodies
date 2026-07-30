import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { StaffDiscount } from '../entities/staff-discount.entity';
import { Brand } from '../entities/brand.entity';
import {
    ManageScope,
    isVisibleToBrands,
    manageScopeFor,
} from '../discounts/offer-brand-scope.util';
import {
    staffDiscountRawAmount,
    staffDiscountWithinCeiling,
    StaffDiscountCeiling,
} from '../orders/staff-discount-offer.util';

export type StaffDiscountDto = {
    name?: string;
    discount_type?: 'percentage' | 'flat';
    value?: number | string | null;
    max_discount_amount?: number | string | null;
    eligibility_brand_ids?: number[] | null;
    eligibility_branch_ids?: number[] | null;
    sort_order?: number | null;
    is_active?: boolean;
};

/**
 * Preset give-aways a cashier can grant at the till. Its own module rather than
 * an offer kind: an offer is earned by the cart, a staff discount is discretion
 * exercised by a person, and the controls that matter are who may grant it and
 * how much — not eligibility. Pricing still runs through the one engine via
 * staff-discount-offer.util, so the tenant cap and cost floor bind it.
 */
@Injectable()
export class StaffDiscountsService {
    constructor(
        @InjectRepository(StaffDiscount)
        private readonly repo: Repository<StaffDiscount>,
        @InjectRepository(Brand)
        private readonly brandRepo: Repository<Brand>,
    ) {}

    private toResponse(p: StaffDiscount, manageScope: ManageScope = 'full') {
        return {
            id: p.id,
            name: p.name,
            discount_type: p.discountType,
            value: Number(p.value),
            max_discount_amount:
                p.maxDiscountAmount != null
                    ? Number(p.maxDiscountAmount)
                    : null,
            eligibility_brand_ids: p.eligibilityBrandIds ?? null,
            eligibility_branch_ids: p.eligibilityBranchIds ?? null,
            effective_brand_ids: p.eligibilityBrandIds ?? null,
            manage_scope: manageScope,
            sort_order: p.sortOrder,
            is_active: p.isActive,
        };
    }

    /** Presets carry no product scope, so eligibility_brand_ids is the whole story. */
    private scopeOf(p: StaffDiscount): {
        eligibilityBrandIds: number[] | null;
    } {
        return { eligibilityBrandIds: p.eligibilityBrandIds ?? null };
    }

    private assertTenant(tenantId: number | null): asserts tenantId is number {
        if (tenantId == null) {
            throw new ForbiddenException(
                'Staff discounts are managed per tenant',
            );
        }
    }

    /**
     * Money is rejected, never coerced: a preset silently saved as 0 would show
     * a button at the till that discounts nothing.
     */
    private amountOrThrow(input: unknown, label: string): number | null {
        if (input == null || input === '') return null;
        const n = Number(input);
        if (!Number.isFinite(n) || n < 0) {
            throw new BadRequestException(
                `${label} must be a non-negative number.`,
            );
        }
        return n;
    }

    private assertValid(p: StaffDiscount): void {
        if (!p.name?.trim()) {
            throw new BadRequestException('Give the button a name.');
        }
        if (p.discountType !== 'percentage' && p.discountType !== 'flat') {
            throw new BadRequestException(
                'Choose a discount type (percentage or flat).',
            );
        }
        const value = Number(p.value);
        if (!Number.isFinite(value) || value <= 0) {
            throw new BadRequestException(
                'Value must be greater than zero — a button that discounts nothing is not useful.',
            );
        }
        // 100% is allowed — a full comp granted at the till. Who may actually
        // grant it is the role ceiling's job, not this validation's. Above 100
        // is a data-entry slip: a discount larger than the bill is not an
        // intent anyone has.
        if (p.discountType === 'percentage' && value > 100) {
            throw new BadRequestException(
                'A percentage discount cannot exceed 100%.',
            );
        }
        if (p.discountType === 'flat' && p.maxDiscountAmount != null) {
            throw new BadRequestException(
                'A maximum only applies to a percentage discount.',
            );
        }
    }

    private async tenantBrandIds(tenantId: number): Promise<number[]> {
        const brands = await this.brandRepo.find({
            where: { tenantId },
            select: { id: true },
        });
        return brands.map((b) => b.id);
    }

    /** Validate / default eligibility_brand_ids for a brand-locked admin. */
    private resolveEligibilityBrandIds(
        requested: number[] | null | undefined,
        allowedBrandIds: number[] | null | undefined,
    ): number[] | null {
        if (allowedBrandIds == null) {
            return Array.isArray(requested) && requested.length
                ? requested.map(Number)
                : null;
        }
        if (!Array.isArray(requested) || requested.length === 0) {
            return [...allowedBrandIds];
        }
        if (requested.some((id) => !allowedBrandIds.includes(Number(id)))) {
            throw new ForbiddenException(
                'You can only create staff discounts for your own brand',
            );
        }
        return requested.map(Number);
    }

    private assertManageable(
        p: StaffDiscount,
        allowedBrandIds: number[] | null | undefined,
    ): void {
        const scope = manageScopeFor(this.scopeOf(p), allowedBrandIds);
        if (scope === 'full') return;
        throw new ForbiddenException(
            scope === 'detach'
                ? 'This staff discount also serves other brands. Remove your brand from it instead of editing it.'
                : 'You can only manage staff discounts that belong to your own brand',
        );
    }

    private applyFields(preset: StaffDiscount, dto: StaffDiscountDto): void {
        if (dto.name !== undefined) preset.name = String(dto.name).trim();
        if (dto.discount_type !== undefined)
            preset.discountType = dto.discount_type;
        if (dto.value !== undefined)
            preset.value = this.amountOrThrow(dto.value, 'Value') ?? 0;
        if (dto.max_discount_amount !== undefined)
            preset.maxDiscountAmount = this.amountOrThrow(
                dto.max_discount_amount,
                'Maximum discount',
            );
        if (dto.eligibility_branch_ids !== undefined)
            preset.eligibilityBranchIds = Array.isArray(
                dto.eligibility_branch_ids,
            )
                ? dto.eligibility_branch_ids.map(Number)
                : null;
        if (dto.sort_order !== undefined)
            preset.sortOrder = Number(dto.sort_order ?? 0) || 0;
        if (dto.is_active !== undefined) preset.isActive = !!dto.is_active;
    }

    async findAll(
        tenantId: number | null,
        activeOnly = false,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertTenant(tenantId);
        const presets = await this.repo.find({
            where: activeOnly ? { tenantId, isActive: true } : { tenantId },
            order: { sortOrder: 'ASC', id: 'ASC' },
        });
        return presets
            .filter((p) => isVisibleToBrands(this.scopeOf(p), allowedBrandIds))
            .map((p) =>
                this.toResponse(
                    p,
                    manageScopeFor(this.scopeOf(p), allowedBrandIds),
                ),
            );
    }

    /**
     * The till's picker: active presets this cashier may actually grant, already
     * filtered by their role ceiling and by the branch/brand being sold. The
     * server decides what's offerable — the same rules are re-checked at quote
     * and at order time, so a hidden button is not a security boundary, just a
     * cashier who isn't shown something they'd be refused.
     */
    async findForTill(
        tenantId: number | null,
        ceiling: StaffDiscountCeiling,
        opts: {
            branchId?: number | null;
            brandId?: number | null;
            /** Cart subtotal, so percentage presets can be ceiling-checked in rupees. */
            subtotal?: number | null;
        } = {},
    ) {
        this.assertTenant(tenantId);
        const presets = await this.repo.find({
            where: { tenantId, isActive: true },
            order: { sortOrder: 'ASC', id: 'ASC' },
        });
        const base = Number(opts.subtotal ?? 0);
        return presets
            .filter((p) => {
                const brandIds = (p.eligibilityBrandIds ?? []).map(Number);
                if (
                    brandIds.length > 0 &&
                    opts.brandId != null &&
                    !brandIds.includes(Number(opts.brandId))
                )
                    return false;
                const branchIds = (p.eligibilityBranchIds ?? []).map(Number);
                if (
                    branchIds.length > 0 &&
                    opts.branchId != null &&
                    !branchIds.includes(Number(opts.branchId))
                )
                    return false;
                // With no subtotal the rupee ceiling can't be evaluated, so only
                // the percentage ceiling filters — the amount check still runs
                // for real at quote/order time.
                const raw = staffDiscountRawAmount(p, base);
                if (base <= 0) {
                    return (
                        p.discountType !== 'percentage' ||
                        ceiling.maxPercent == null ||
                        Number(p.value) <= ceiling.maxPercent
                    );
                }
                return staffDiscountWithinCeiling(p, ceiling, raw);
            })
            .map((p) => ({
                id: p.id,
                name: p.name,
                discount_type: p.discountType,
                value: Number(p.value),
                max_discount_amount:
                    p.maxDiscountAmount != null
                        ? Number(p.maxDiscountAmount)
                        : null,
            }));
    }

    async create(
        tenantId: number | null,
        dto: StaffDiscountDto,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertTenant(tenantId);
        const preset = this.repo.create({
            tenantId,
            name: '',
            discountType: dto.discount_type ?? 'percentage',
            value: 0,
            maxDiscountAmount: null,
            eligibilityBrandIds: null,
            eligibilityBranchIds: null,
            sortOrder: 0,
            isActive: dto.is_active ?? true,
        });
        this.applyFields(preset, dto);
        const brandIds = this.resolveEligibilityBrandIds(
            dto.eligibility_brand_ids,
            allowedBrandIds,
        );
        if (brandIds != null) {
            const tenantBrands = await this.tenantBrandIds(tenantId);
            if (brandIds.some((id) => !tenantBrands.includes(Number(id)))) {
                throw new BadRequestException(
                    'One or more brands do not belong to this tenant',
                );
            }
        }
        preset.eligibilityBrandIds = brandIds;
        this.assertValid(preset);
        const saved = await this.repo.save(preset);
        return this.toResponse(saved);
    }

    async update(
        id: number,
        tenantId: number | null,
        dto: StaffDiscountDto,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertTenant(tenantId);
        const preset = await this.repo.findOne({ where: { id, tenantId } });
        if (!preset) throw new NotFoundException('Staff discount not found');
        this.assertManageable(preset, allowedBrandIds);
        this.applyFields(preset, dto);
        if (dto.eligibility_brand_ids !== undefined) {
            const brandIds = this.resolveEligibilityBrandIds(
                dto.eligibility_brand_ids,
                allowedBrandIds,
            );
            if (brandIds != null) {
                const tenantBrands = await this.tenantBrandIds(tenantId);
                if (
                    brandIds.some((bid) => !tenantBrands.includes(Number(bid)))
                ) {
                    throw new BadRequestException(
                        'One or more brands do not belong to this tenant',
                    );
                }
            }
            preset.eligibilityBrandIds = brandIds;
        }
        this.assertValid(preset);
        const saved = await this.repo.save(preset);
        return this.toResponse(saved);
    }

    /**
     * Deletion retires the button. Orders that were given this discount keep
     * their snapshotted type/value/amount (orders.staff_discount_id is ON DELETE
     * SET NULL), so past give-aways stay reportable in total — they just lose
     * their per-preset grouping.
     */
    async remove(
        id: number,
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
    ) {
        this.assertTenant(tenantId);
        const preset = await this.repo.findOne({ where: { id, tenantId } });
        if (!preset) throw new NotFoundException('Staff discount not found');
        this.assertManageable(preset, allowedBrandIds);
        await this.repo.remove(preset);
        return { deleted: true };
    }
}
