import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Discount } from '../entities/discount.entity';

/** Accept 'HH:mm' / 'HH:mm:ss' (Postgres time); empty/invalid → null. */
function normalizeDiscountTime(
    input: string | null | undefined,
): string | null {
    if (input == null) return null;
    const s = String(input).trim();
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(s) ? s : null;
}

/** Days of week 0-6 (0=Sun); dedupe + sort; empty/invalid → null. */
function normalizeDiscountDays(input: unknown): number[] | null {
    if (!Array.isArray(input)) return null;
    const set = new Set<number>();
    for (const x of input) {
        const n = Math.floor(Number(x));
        if (Number.isFinite(n) && n >= 0 && n <= 6) set.add(n);
    }
    return set.size ? [...set].sort((a, b) => a - b) : null;
}

/** Non-negative integer or null. */
function normalizeIntOrNull(input: unknown): number | null {
    if (input == null || input === '') return null;
    const n = Math.floor(Number(input));
    return Number.isFinite(n) && n >= 0 ? n : null;
}

@Injectable()
export class DiscountsService {
    private readonly logger = new Logger(DiscountsService.name);

    constructor(
        @InjectRepository(Discount)
        private repo: Repository<Discount>,
    ) {}

    /**
     * A brand-locked user may only manage discounts that are explicitly
     * scoped (via eligibility_brand_ids) to a subset of their own brands.
     * Tenant-wide discounts (null eligibility) belong to the owner.
     */
    private assertDiscountManageable(
        d: Discount,
        allowedBrandIds: number[] | null | undefined,
    ): void {
        if (allowedBrandIds == null) return;
        const ids = d.eligibilityBrandIds;
        if (
            !Array.isArray(ids) ||
            ids.length === 0 ||
            ids.some((id) => !allowedBrandIds.includes(Number(id)))
        ) {
            throw new ForbiddenException(
                'You can only manage discounts that belong to your own brand',
            );
        }
    }

    /** Validate / default eligibility_brand_ids for a brand-locked user. */
    private resolveEligibilityBrandIds(
        requested: number[] | undefined,
        allowedBrandIds: number[] | null | undefined,
    ): number[] | null {
        if (allowedBrandIds == null) {
            return Array.isArray(requested) ? requested : null;
        }
        if (!Array.isArray(requested) || requested.length === 0) {
            return [...allowedBrandIds];
        }
        if (requested.some((id) => !allowedBrandIds.includes(Number(id)))) {
            throw new ForbiddenException(
                'You can only create discounts for your own brand',
            );
        }
        return requested;
    }

    async findAll(tenantId: number | null, allowedBrandIds?: number[] | null) {
        if (tenantId == null) return [];
        const list = await this.repo.find({
            where: { tenantId },
            order: { createdAt: 'DESC' },
        });
        const visible =
            allowedBrandIds == null
                ? list
                : list.filter(
                      (d) =>
                          Array.isArray(d.eligibilityBrandIds) &&
                          d.eligibilityBrandIds.some((id) =>
                              allowedBrandIds.includes(Number(id)),
                          ),
                  );
        return visible.map((d) => this.toResponse(d));
    }

    async findOne(id: number, tenantId: number | null) {
        const d = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
        });
        if (!d) throw new NotFoundException('Discount not found');
        return this.toResponse(d);
    }

    async create(
        dto: {
            name: string;
            code?: string;
            type: string;
            value: number;
            min_order_amount?: number;
            max_discount_amount?: number;
            pos_only?: boolean;
            allowed_roles?: string[];
            requires_code?: boolean;
            application_scope?: string;
            application_scope_ids?: number[];
            eligibility_branch_ids?: number[];
            eligibility_brand_ids?: number[];
            is_active?: boolean;
            valid_from?: string;
            valid_until?: string;
            valid_time_start?: string | null;
            valid_time_end?: string | null;
            valid_days_of_week?: number[] | null;
            buy_quantity?: number | null;
            get_quantity?: number | null;
            get_discount_percent?: number | null;
            bogo_match_same_group?: boolean;
            requires_card?: boolean;
            eligible_bank_card_ids?: number[] | null;
        },
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const eligibilityBrandIds = this.resolveEligibilityBrandIds(
            dto.eligibility_brand_ids,
            allowedBrandIds,
        );
        const name = String(dto.name ?? '').trim();
        if (!name) throw new BadRequestException('Name is required.');
        const type =
            dto.type === 'flat' || dto.type === 'percentage'
                ? dto.type
                : String(dto.type ?? '').trim();
        if (!type)
            throw new BadRequestException(
                'Type is required (flat or percentage).',
            );
        const value = Number(dto.value);
        if (Number.isNaN(value) || value < 0)
            throw new BadRequestException(
                'Value must be a valid non-negative number.',
            );

        const applicationScope = dto.application_scope ?? 'whole_order';
        const applicationScopeIds = Array.isArray(dto.application_scope_ids)
            ? dto.application_scope_ids
            : null;
        if (
            (applicationScope === 'category' ||
                applicationScope === 'products') &&
            (!applicationScopeIds || applicationScopeIds.length === 0)
        ) {
            throw new BadRequestException(
                `When applying to "${applicationScope === 'category' ? 'Selected categories' : 'Selected products'}", at least one must be selected.`,
            );
        }

        const requiresCode = dto.requires_code ?? true;
        let code: string | null = dto.code?.trim()
            ? dto.code.trim().toUpperCase()
            : null;
        if (requiresCode && !code) {
            code = await this.generateCouponCode(name, type, value);
        }

        try {
            const discount = await this.repo.save(
                this.repo.create({
                    tenantId,
                    name,
                    code,
                    type,
                    value,
                    minOrderAmount:
                        dto.min_order_amount != null
                            ? Number(dto.min_order_amount)
                            : null,
                    maxDiscountAmount:
                        dto.max_discount_amount != null
                            ? Number(dto.max_discount_amount)
                            : null,
                    posOnly: dto.pos_only ?? false,
                    allowedRoles: dto.allowed_roles ?? null,
                    requiresCode,
                    applicationScope,
                    applicationScopeIds,
                    eligibilityBranchIds: Array.isArray(
                        dto.eligibility_branch_ids,
                    )
                        ? dto.eligibility_branch_ids
                        : null,
                    eligibilityBrandIds,
                    isActive: dto.is_active ?? true,
                    validFrom: dto.valid_from ? new Date(dto.valid_from) : null,
                    validUntil: dto.valid_until
                        ? new Date(dto.valid_until)
                        : null,
                    validTimeStart: normalizeDiscountTime(dto.valid_time_start),
                    validTimeEnd: normalizeDiscountTime(dto.valid_time_end),
                    validDaysOfWeek: normalizeDiscountDays(
                        dto.valid_days_of_week,
                    ),
                    buyQuantity: normalizeIntOrNull(dto.buy_quantity),
                    getQuantity: normalizeIntOrNull(dto.get_quantity),
                    getDiscountPercent:
                        dto.get_discount_percent != null
                            ? Number(dto.get_discount_percent)
                            : null,
                    bogoMatchSameGroup: dto.bogo_match_same_group ?? false,
                    requiresCard: dto.requires_card ?? false,
                    eligibleBankCardIds:
                        dto.requires_card &&
                        Array.isArray(dto.eligible_bank_card_ids)
                            ? dto.eligible_bank_card_ids.map((id) => Number(id))
                            : null,
                }),
            );
            return this.toResponse(discount);
        } catch (err: unknown) {
            const e = err as {
                code?: string;
                message?: string;
                detail?: string;
            };
            if (e?.code === '23505') {
                throw new ConflictException(
                    'A discount with this code already exists. Use a different code or edit the existing discount.',
                );
            }
            const msg = e?.message ?? e?.detail ?? String(err);
            if (
                typeof msg === 'string' &&
                ((msg.includes('column') && msg.includes('does not exist')) ||
                    msg.includes('undefined column'))
            ) {
                throw new BadRequestException(
                    'Database schema may be outdated. Run migrations: npm run migration:run in the backend folder.',
                );
            }
            this.logger.warn('Discount create failed', e?.message ?? err);
            throw err;
        }
    }

    async update(
        id: number,
        tenantId: number,
        dto: {
            name?: string;
            code?: string;
            type?: string;
            value?: number;
            min_order_amount?: number;
            max_discount_amount?: number;
            pos_only?: boolean;
            allowed_roles?: string[];
            requires_code?: boolean;
            application_scope?: string;
            application_scope_ids?: number[];
            eligibility_branch_ids?: number[];
            eligibility_brand_ids?: number[];
            is_active?: boolean;
            valid_from?: string;
            valid_until?: string;
            valid_time_start?: string | null;
            valid_time_end?: string | null;
            valid_days_of_week?: number[] | null;
            buy_quantity?: number | null;
            get_quantity?: number | null;
            get_discount_percent?: number | null;
            bogo_match_same_group?: boolean;
            requires_card?: boolean;
            eligible_bank_card_ids?: number[] | null;
        },
        allowedBrandIds?: number[] | null,
    ) {
        const d = await this.repo.findOne({ where: { id, tenantId } });
        if (!d) throw new NotFoundException('Discount not found');
        this.assertDiscountManageable(d, allowedBrandIds);
        if (dto.name !== undefined) {
            const name = String(dto.name).trim();
            if (!name) throw new BadRequestException('Name cannot be empty.');
            d.name = name;
        }
        if (dto.type !== undefined) {
            const type =
                dto.type === 'flat' || dto.type === 'percentage'
                    ? dto.type
                    : String(dto.type).trim();
            if (!type)
                throw new BadRequestException(
                    'Type must be flat or percentage.',
                );
            d.type = type;
        }
        if (dto.value !== undefined) {
            const value = Number(dto.value);
            if (Number.isNaN(value) || value < 0)
                throw new BadRequestException(
                    'Value must be a valid non-negative number.',
                );
            d.value = value;
        }
        try {
            if (dto.code !== undefined)
                d.code = dto.code?.trim()
                    ? dto.code.trim().toUpperCase()
                    : null;
            if (dto.requires_code !== undefined)
                d.requiresCode = dto.requires_code;
            if (dto.min_order_amount !== undefined)
                d.minOrderAmount =
                    dto.min_order_amount != null
                        ? Number(dto.min_order_amount)
                        : null;
            if (dto.max_discount_amount !== undefined)
                d.maxDiscountAmount =
                    dto.max_discount_amount != null
                        ? Number(dto.max_discount_amount)
                        : null;
            if (dto.pos_only !== undefined) d.posOnly = dto.pos_only;
            if (dto.allowed_roles !== undefined)
                d.allowedRoles = dto.allowed_roles;
            if (dto.application_scope !== undefined)
                d.applicationScope = dto.application_scope;
            if (dto.application_scope_ids !== undefined) {
                const scope =
                    dto.application_scope ??
                    d.applicationScope ??
                    'whole_order';
                const ids = Array.isArray(dto.application_scope_ids)
                    ? dto.application_scope_ids
                    : null;
                if (
                    (scope === 'category' || scope === 'products') &&
                    (!ids || ids.length === 0)
                ) {
                    throw new BadRequestException(
                        `When applying to "${scope === 'category' ? 'Selected categories' : 'Selected products'}", at least one must be selected.`,
                    );
                }
                d.applicationScopeIds = ids;
            }
            if (dto.eligibility_branch_ids !== undefined)
                d.eligibilityBranchIds = Array.isArray(
                    dto.eligibility_branch_ids,
                )
                    ? dto.eligibility_branch_ids
                    : null;
            if (dto.eligibility_brand_ids !== undefined)
                d.eligibilityBrandIds = this.resolveEligibilityBrandIds(
                    Array.isArray(dto.eligibility_brand_ids)
                        ? dto.eligibility_brand_ids
                        : undefined,
                    allowedBrandIds,
                );
            if (dto.is_active !== undefined) d.isActive = dto.is_active;
            if (dto.valid_from !== undefined)
                d.validFrom = dto.valid_from ? new Date(dto.valid_from) : null;
            if (dto.valid_until !== undefined)
                d.validUntil = dto.valid_until
                    ? new Date(dto.valid_until)
                    : null;
            if (dto.valid_time_start !== undefined)
                d.validTimeStart = normalizeDiscountTime(dto.valid_time_start);
            if (dto.valid_time_end !== undefined)
                d.validTimeEnd = normalizeDiscountTime(dto.valid_time_end);
            if (dto.valid_days_of_week !== undefined)
                d.validDaysOfWeek = normalizeDiscountDays(
                    dto.valid_days_of_week,
                );
            if (dto.buy_quantity !== undefined)
                d.buyQuantity = normalizeIntOrNull(dto.buy_quantity);
            if (dto.get_quantity !== undefined)
                d.getQuantity = normalizeIntOrNull(dto.get_quantity);
            if (dto.get_discount_percent !== undefined)
                d.getDiscountPercent =
                    dto.get_discount_percent != null
                        ? Number(dto.get_discount_percent)
                        : null;
            if (dto.bogo_match_same_group !== undefined)
                d.bogoMatchSameGroup = dto.bogo_match_same_group;
            if (dto.requires_card !== undefined)
                d.requiresCard = dto.requires_card;
            if (dto.eligible_bank_card_ids !== undefined)
                d.eligibleBankCardIds = Array.isArray(
                    dto.eligible_bank_card_ids,
                )
                    ? dto.eligible_bank_card_ids.map((id) => Number(id))
                    : null;
            await this.repo.save(d);
            return this.toResponse(d);
        } catch (err: unknown) {
            const e = err as {
                code?: string;
                message?: string;
                detail?: string;
            };
            if (e?.code === '23505') {
                throw new ConflictException(
                    'A discount with this code already exists. Use a different code.',
                );
            }
            const msg = e?.message ?? e?.detail ?? String(err);
            if (
                typeof msg === 'string' &&
                ((msg.includes('column') && msg.includes('does not exist')) ||
                    msg.includes('undefined column'))
            ) {
                throw new BadRequestException(
                    'Database schema may be outdated. Run migrations: npm run migration:run in the backend folder.',
                );
            }
            this.logger.warn('Discount update failed', e?.message ?? err);
            throw err;
        }
    }

    async remove(
        id: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const d = await this.repo.findOne({ where: { id, tenantId } });
        if (!d) throw new NotFoundException('Discount not found');
        this.assertDiscountManageable(d, allowedBrandIds);
        await this.repo.remove(d);
        return { message: 'Discount deleted successfully' };
    }

    /**
     * Generate a meaningful, human-friendly coupon code from name and value.
     * Examples: "Summer Sale" 10% -> "SUMMER10"; "Welcome" $5 -> "WELCOME5".
     * Ensures uniqueness by appending a number if the code already exists.
     */
    private async generateCouponCode(
        name: string,
        type: string,
        value: number,
    ): Promise<string> {
        const slug = name
            .toUpperCase()
            .replace(/[^A-Z0-9]/g, '')
            .slice(0, 8);
        const valuePart =
            type === 'percentage'
                ? Math.round(Number(value)).toString()
                : Math.round(Number(value)).toString();
        let base = slug ? `${slug}${valuePart}` : `SAVE${valuePart}`;
        if (base.length > 12) base = base.slice(0, 12);
        let code = base;
        let suffix = 1;
        while (await this.repo.findOne({ where: { code } })) {
            code = `${base}${suffix}`;
            suffix += 1;
            if (code.length > 15) code = `${base.slice(0, 10)}${suffix}`;
        }
        return code;
    }

    private toResponse(d: Discount) {
        return {
            id: d.id,
            tenant_id: d.tenantId,
            name: d.name,
            code: d.code,
            requires_code: d.requiresCode ?? true,
            type: d.type,
            value: Number(d.value),
            min_order_amount:
                d.minOrderAmount != null ? Number(d.minOrderAmount) : null,
            max_discount_amount:
                d.maxDiscountAmount != null
                    ? Number(d.maxDiscountAmount)
                    : null,
            pos_only: d.posOnly,
            allowed_roles: d.allowedRoles ?? [],
            application_scope: d.applicationScope ?? 'whole_order',
            application_scope_ids: d.applicationScopeIds ?? [],
            eligibility_branch_ids: d.eligibilityBranchIds ?? [],
            eligibility_brand_ids: d.eligibilityBrandIds ?? [],
            is_active: d.isActive,
            valid_from: d.validFrom?.toISOString() ?? null,
            valid_until: d.validUntil?.toISOString() ?? null,
            valid_time_start: d.validTimeStart ?? null,
            valid_time_end: d.validTimeEnd ?? null,
            valid_days_of_week: d.validDaysOfWeek ?? [],
            buy_quantity: d.buyQuantity ?? null,
            get_quantity: d.getQuantity ?? null,
            get_discount_percent:
                d.getDiscountPercent != null
                    ? Number(d.getDiscountPercent)
                    : null,
            bogo_match_same_group: d.bogoMatchSameGroup ?? false,
            requires_card: d.requiresCard ?? false,
            eligible_bank_card_ids: d.eligibleBankCardIds ?? null,
        };
    }
}
