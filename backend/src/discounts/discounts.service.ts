import {
    Injectable,
    NotFoundException,
    ConflictException,
    BadRequestException,
    ForbiddenException,
    Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Discount } from '../entities/discount.entity';
import { MenuItem } from '../entities/menu-item.entity';
import { MenuCategory } from '../entities/menu-category.entity';
import { Brand } from '../entities/brand.entity';
import {
    EMPTY_SCOPE_LOOKUP,
    ManageScope,
    ScopeBrandLookup,
    detachBrands,
    effectiveBrandIds,
    isVisibleToBrands,
    manageScopeFor,
} from './offer-brand-scope.util';

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

const OFFER_CHANNELS = ['pos', 'app', 'web', 'kiosk'] as const;

/** Channels subset ('pos'|'app'|'web'|'kiosk'); empty / all selected / invalid → null (= all channels). */
function normalizeChannels(input: unknown): string[] | null {
    if (!Array.isArray(input)) return null;
    const set = new Set<string>();
    for (const x of input) {
        const s = String(x).trim().toLowerCase();
        if ((OFFER_CHANNELS as readonly string[]).includes(s)) set.add(s);
    }
    if (set.size === 0 || set.size === OFFER_CHANNELS.length) return null;
    return OFFER_CHANNELS.filter((c) => set.has(c));
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
        @InjectRepository(MenuItem)
        private menuItemRepo: Repository<MenuItem>,
        @InjectRepository(MenuCategory)
        private menuCategoryRepo: Repository<MenuCategory>,
        @InjectRepository(Brand)
        private brandRepo: Repository<Brand>,
    ) {}

    /**
     * Resolve the brands behind every product/category referenced by these offers,
     * in two queries regardless of how many offers there are. An offer scoped to
     * Fireaway products is a Fireaway offer even when eligibility_brand_ids is null,
     * and this is what lets findAll/assert see that.
     */
    private async loadScopeLookup(
        offers: Discount[],
    ): Promise<ScopeBrandLookup> {
        const itemIds = new Set<number>();
        const categoryIds = new Set<number>();
        for (const d of offers) {
            if (!Array.isArray(d.applicationScopeIds)) continue;
            const sink =
                d.applicationScope === 'products'
                    ? itemIds
                    : d.applicationScope === 'category'
                      ? categoryIds
                      : null;
            if (!sink) continue;
            for (const raw of d.applicationScopeIds) {
                const n = Number(raw);
                if (Number.isFinite(n)) sink.add(n);
            }
        }
        if (!itemIds.size && !categoryIds.size) return EMPTY_SCOPE_LOOKUP;

        const [items, categories] = await Promise.all([
            itemIds.size
                ? this.menuItemRepo.find({
                      where: { id: In([...itemIds]) },
                      select: { id: true, brandId: true },
                  })
                : Promise.resolve([]),
            categoryIds.size
                ? this.menuCategoryRepo.find({
                      where: { id: In([...categoryIds]) },
                      select: { id: true, brandId: true },
                  })
                : Promise.resolve([]),
        ]);
        return {
            itemBrands: new Map(items.map((i) => [i.id, i.brandId])),
            categoryBrands: new Map(categories.map((c) => [c.id, c.brandId])),
        };
    }

    private async loadScopeLookupFor(d: Discount): Promise<ScopeBrandLookup> {
        return this.loadScopeLookup([d]);
    }

    /** Brands owning the given products/categories; null for whole-order scope. */
    private async deriveBrandsFromScope(
        applicationScope: string | null | undefined,
        applicationScopeIds: number[] | null | undefined,
    ): Promise<number[] | null> {
        const probe = {
            applicationScope,
            applicationScopeIds,
        } as Discount;
        const lookup = await this.loadScopeLookup([probe]);
        return effectiveBrandIds(probe, lookup);
    }

    /** Every brand id in the tenant — needed to materialise "all brands except mine". */
    private async tenantBrandIds(tenantId: number): Promise<number[]> {
        const brands = await this.brandRepo.find({
            where: { tenantId },
            select: { id: true },
        });
        return brands.map((b) => b.id);
    }

    /**
     * A brand-locked user may fully manage an offer only when every brand it
     * serves is one of theirs. Offers shared with other brands (or with every
     * brand) are detach-only and must go through `remove`, which opts their brand
     * out instead of deleting the row out from under the other brands.
     */
    private assertDiscountManageable(
        d: Discount,
        allowedBrandIds: number[] | null | undefined,
        lookup: ScopeBrandLookup = EMPTY_SCOPE_LOOKUP,
    ): void {
        const scope = manageScopeFor(d, allowedBrandIds, lookup);
        if (scope === 'full') return;
        throw new ForbiddenException(
            scope === 'detach'
                ? 'This offer also serves other brands. Remove your brand from it instead of editing it.'
                : 'You can only manage discounts that belong to your own brand',
        );
    }

    /** Validate / default eligibility_brand_ids for a brand-locked user. */
    private resolveEligibilityBrandIds(
        requested: number[] | undefined,
        allowedBrandIds: number[] | null | undefined,
    ): number[] | null {
        if (allowedBrandIds == null) {
            // Normalise [] to null: the admin forms always post the field, and an
            // empty pick means "not specified", which must stay open for the
            // product-scope derivation below rather than persist as [].
            return Array.isArray(requested) && requested.length
                ? requested
                : null;
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

    async findAll(
        tenantId: number | null,
        allowedBrandIds?: number[] | null,
        kinds?: string[],
    ) {
        if (tenantId == null) return [];
        const list = await this.repo.find({
            where: { tenantId },
            order: { createdAt: 'DESC' },
        });
        const kindSet = kinds && kinds.length ? new Set(kinds) : null;
        const kindFiltered =
            kindSet == null
                ? list
                : list.filter((d) =>
                      kindSet.has(
                          (d as { offerKind?: string }).offerKind ?? 'discount',
                      ),
                  );
        const lookup = await this.loadScopeLookup(kindFiltered);
        const visible = kindFiltered.filter((d) =>
            isVisibleToBrands(d, allowedBrandIds, lookup),
        );
        return visible.map((d) =>
            this.toResponse(
                d,
                manageScopeFor(d, allowedBrandIds, lookup),
                lookup,
            ),
        );
    }

    async findOne(id: number, tenantId: number | null) {
        const d = await this.repo.findOne({
            where: tenantId != null ? { id, tenantId } : { id },
        });
        if (!d) throw new NotFoundException('Discount not found');
        return this.toResponse(d);
    }

    /**
     * Offers a cashier may switch on for a single cart: active, manual, in date,
     * and scoped to this branch/brand. Deliberately does NOT evaluate the cart —
     * whether it qualifies is the pricing engine's answer, and pre-filtering here
     * would need the lines and duplicate that logic.
     */
    async findManualForTill(
        tenantId: number | null,
        allowedBrandIds: number[] | null | undefined,
        opts: { branchId?: number | null; brandId?: number | null } = {},
    ) {
        if (tenantId == null) return [];
        const rows: Discount[] = await this.repo.find({
            where: { tenantId, isActive: true },
            order: { priority: 'ASC', id: 'ASC' },
        });
        const now = new Date();
        return rows
            .filter(
                (d) => (d as { activation?: string }).activation === 'manual',
            )
            // Both automatic kinds, not just 'discount': a product-scoped BOGO is
            // stored as offer_kind='product_promotion', so filtering to
            // 'discount' hid exactly the offers this feature was built for.
            // Coupons and card offers are excluded — they reach an order by
            // their own route and ignore `activation` entirely.
            .filter((d) =>
                ['discount', 'product_promotion'].includes(
                    (d as { offerKind?: string }).offerKind ?? 'discount',
                ),
            )
            .filter((d) => !(d.validFrom && now < d.validFrom))
            .filter((d) => !(d.validUntil && now > d.validUntil))
            .filter((d) => {
                const ids = (d.eligibilityBrandIds ?? []).map(Number);
                if (ids.length === 0) return true;
                if (opts.brandId != null)
                    return ids.includes(Number(opts.brandId));
                // No cart brand yet: keep it if the user could sell it at all.
                if (allowedBrandIds == null) return true;
                return ids.some((id) => allowedBrandIds.includes(id));
            })
            .filter((d) => {
                const ids = (d.eligibilityBranchIds ?? []).map(Number);
                return (
                    ids.length === 0 ||
                    opts.branchId == null ||
                    ids.includes(Number(opts.branchId))
                );
            })
            .map((d) => ({
                id: d.id,
                name: d.name,
                type: d.type,
                value: Number(d.value ?? 0),
                buy_quantity: d.buyQuantity ?? null,
                get_quantity: d.getQuantity ?? null,
                get_discount_percent:
                    d.getDiscountPercent != null
                        ? Number(d.getDiscountPercent)
                        : null,
            }));
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
            channels?: string[] | null;
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
            offer_kind?: string;
            audience?: string | null;
            eligible_customer_ids?: number[] | null;
            per_customer_limit?: number | null;
            voucher_validity_days?: number | null;
            global_limit?: number | null;
            priority?: number;
            funding?: string;
            /** 'auto' (default) or 'manual' — a till-activated offer. */
            activation?: string;
        },
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        let eligibilityBrandIds = this.resolveEligibilityBrandIds(
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

        // An owner who picks only Fireaway products has made a Fireaway offer whether
        // or not they touched the brand selector. Pin that down at write time so the
        // offer shows up for the brand it discounts instead of becoming owner-only.
        if (eligibilityBrandIds == null) {
            eligibilityBrandIds = await this.deriveBrandsFromScope(
                applicationScope,
                applicationScopeIds,
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
                    channels: normalizeChannels(dto.channels),
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
                    // Card-linked offers are not created here: a card's discount is
                    // configured on the card itself (see BankCardsService).
                    requiresCard: false,
                    eligibleBankCardIds: null,
                    offerKind:
                        (dto.offer_kind as Discount['offerKind']) ??
                        (requiresCode
                            ? 'coupon'
                            : applicationScope === 'products'
                              ? 'product_promotion'
                              : 'discount'),
                    audience: (dto.audience as Discount['audience']) ?? null,
                    eligibleCustomerIds: Array.isArray(
                        dto.eligible_customer_ids,
                    )
                        ? dto.eligible_customer_ids.map((id) => Number(id))
                        : null,
                    perCustomerLimit: normalizeIntOrNull(
                        dto.per_customer_limit,
                    ),
                    voucherValidityDays: normalizeIntOrNull(
                        dto.voucher_validity_days,
                    ),
                    globalLimit: normalizeIntOrNull(dto.global_limit),
                    priority:
                        dto.priority != null
                            ? Math.max(0, Math.floor(Number(dto.priority)))
                            : 0,
                    funding: dto.funding === 'bank' ? 'bank' : 'merchant',
                    // Anything but an explicit 'manual' stays automatic, so a
                    // client that never sends the field behaves as before.
                    activation: dto.activation === 'manual' ? 'manual' : 'auto',
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
            channels?: string[] | null;
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
            offer_kind?: string;
            audience?: string | null;
            eligible_customer_ids?: number[] | null;
            per_customer_limit?: number | null;
            voucher_validity_days?: number | null;
            global_limit?: number | null;
            priority?: number;
            funding?: string;
            /** 'auto' (default) or 'manual' — a till-activated offer. */
            activation?: string;
        },
        allowedBrandIds?: number[] | null,
    ) {
        const d = await this.repo.findOne({ where: { id, tenantId } });
        if (!d) throw new NotFoundException('Discount not found');
        this.assertDiscountManageable(
            d,
            allowedBrandIds,
            await this.loadScopeLookupFor(d),
        );
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
            if (dto.channels !== undefined)
                d.channels = normalizeChannels(dto.channels);
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
            // Keep an unbranded product/category offer pinned to whatever brands its
            // (possibly just-changed) selection now belongs to.
            if (d.eligibilityBrandIds == null) {
                d.eligibilityBrandIds = await this.deriveBrandsFromScope(
                    d.applicationScope,
                    d.applicationScopeIds,
                );
            }
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
            if (dto.offer_kind !== undefined)
                d.offerKind = dto.offer_kind as Discount['offerKind'];
            if (dto.activation !== undefined)
                d.activation = dto.activation === 'manual' ? 'manual' : 'auto';
            if (dto.audience !== undefined)
                d.audience = (dto.audience as Discount['audience']) ?? null;
            if (dto.eligible_customer_ids !== undefined)
                d.eligibleCustomerIds = Array.isArray(dto.eligible_customer_ids)
                    ? dto.eligible_customer_ids.map((id) => Number(id))
                    : null;
            if (dto.per_customer_limit !== undefined)
                d.perCustomerLimit = normalizeIntOrNull(dto.per_customer_limit);
            if (dto.voucher_validity_days !== undefined)
                d.voucherValidityDays = normalizeIntOrNull(
                    dto.voucher_validity_days,
                );
            if (dto.global_limit !== undefined)
                d.globalLimit = normalizeIntOrNull(dto.global_limit);
            if (dto.priority !== undefined)
                d.priority = Math.max(0, Math.floor(Number(dto.priority) || 0));
            if (dto.funding !== undefined)
                d.funding = dto.funding === 'bank' ? 'bank' : 'merchant';
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

    /**
     * Deleting an offer that also serves brands the caller does not own would kill
     * it for those brands too, so a brand-locked caller only ever opts their own
     * brands out; the row survives for everyone else. It is deleted outright only
     * when the caller owns every brand on it (or is unrestricted).
     */
    async remove(
        id: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const d = await this.repo.findOne({ where: { id, tenantId } });
        if (!d) throw new NotFoundException('Discount not found');
        const lookup = await this.loadScopeLookupFor(d);
        const scope = manageScopeFor(d, allowedBrandIds, lookup);

        if (scope === 'read_only') {
            throw new ForbiddenException(
                'You can only manage discounts that belong to your own brand',
            );
        }

        if (scope === 'detach' && allowedBrandIds != null) {
            const remaining = detachBrands(
                d,
                allowedBrandIds,
                await this.tenantBrandIds(tenantId),
                lookup,
            );
            // Nothing left to serve — [] would read back as "all brands" and
            // resurrect the offer everywhere, so drop the row instead.
            if (remaining.length === 0) {
                await this.repo.remove(d);
                return { message: 'Discount deleted successfully' };
            }
            d.eligibilityBrandIds = remaining;
            await this.repo.save(d);
            return {
                message:
                    'Your brand was removed from this offer. It stays active for the other brands it serves.',
                detached: true,
                eligibility_brand_ids: remaining,
            };
        }

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

    private toResponse(
        d: Discount,
        manageScope: ManageScope = 'full',
        lookup: ScopeBrandLookup = EMPTY_SCOPE_LOOKUP,
    ) {
        return {
            id: d.id,
            tenant_id: d.tenantId,
            /**
             * Brands this offer actually serves — derived from its products when
             * eligibility_brand_ids is unset. null = every brand. The admin UI badges
             * from this, not from eligibility_brand_ids.
             */
            effective_brand_ids: effectiveBrandIds(d, lookup),
            /** 'full' | 'detach' | 'read_only' for the requesting user. */
            manage_scope: manageScope,
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
            channels: d.channels ?? null,
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
            offer_kind: (d as { offerKind?: string }).offerKind ?? 'discount',
            activation: (d as { activation?: string }).activation ?? 'auto',
            audience: (d as { audience?: string | null }).audience ?? null,
            eligible_customer_ids:
                (d as { eligibleCustomerIds?: number[] | null })
                    .eligibleCustomerIds ?? null,
            per_customer_limit:
                (d as { perCustomerLimit?: number | null }).perCustomerLimit ??
                null,
            voucher_validity_days:
                (d as { voucherValidityDays?: number | null })
                    .voucherValidityDays ?? null,
            global_limit:
                (d as { globalLimit?: number | null }).globalLimit ?? null,
            priority: (d as { priority?: number }).priority ?? 0,
            funding: (d as { funding?: string }).funding ?? 'merchant',
        };
    }
}
