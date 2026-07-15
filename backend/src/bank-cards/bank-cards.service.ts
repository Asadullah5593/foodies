import {
    BadRequestException,
    ForbiddenException,
    Injectable,
    NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BankCard } from '../entities/bank-card.entity';
import { Brand } from '../entities/brand.entity';
import {
    ManageScope,
    detachBrands,
    isVisibleToBrands,
    manageScopeFor,
} from '../discounts/offer-brand-scope.util';
import {
    normalizeOfferDays,
    normalizeOfferTime,
} from '../discounts/offer-validity.util';

type BankCardDto = {
    name?: string;
    bank?: string | null;
    network?: string | null;
    bin_prefixes?: string[] | null;
    eligibility_brand_ids?: number[] | null;
    eligibility_branch_ids?: number[] | null;
    discount_type?: 'flat' | 'percentage' | null;
    discount_value?: number | null;
    min_order_amount?: number | null;
    max_discount_amount?: number | null;
    valid_from?: string | null;
    valid_until?: string | null;
    valid_time_start?: string | null;
    valid_time_end?: string | null;
    valid_days_of_week?: number[] | null;
    is_active?: boolean;
};

/**
 * Bank cards and the discount each one carries. A card's offer applies only when
 * the whole bill is paid with that card, and always to the whole order — the
 * pricing engine consumes it via bank-card-offer.util.
 */
@Injectable()
export class BankCardsService {
    constructor(
        @InjectRepository(BankCard)
        private readonly repo: Repository<BankCard>,
        @InjectRepository(Brand)
        private readonly brandRepo: Repository<Brand>,
    ) {}

    private toResponse(c: BankCard, manageScope: ManageScope = 'full') {
        return {
            id: c.id,
            name: c.name,
            bank: c.bank ?? null,
            network: c.network ?? null,
            bin_prefixes: c.binPrefixes ?? null,
            eligibility_brand_ids: c.eligibilityBrandIds ?? null,
            eligibility_branch_ids: c.eligibilityBranchIds ?? null,
            effective_brand_ids: c.eligibilityBrandIds ?? null,
            manage_scope: manageScope,
            discount_type: c.discountType ?? null,
            discount_value:
                c.discountValue != null ? Number(c.discountValue) : null,
            min_order_amount:
                c.minOrderAmount != null ? Number(c.minOrderAmount) : null,
            max_discount_amount:
                c.maxDiscountAmount != null
                    ? Number(c.maxDiscountAmount)
                    : null,
            valid_from: c.validFrom?.toISOString() ?? null,
            valid_until: c.validUntil?.toISOString() ?? null,
            valid_time_start: c.validTimeStart ?? null,
            valid_time_end: c.validTimeEnd ?? null,
            valid_days_of_week: c.validDaysOfWeek ?? [],
            /** Whether this card currently discounts anything. */
            has_offer: c.discountValue != null && Number(c.discountValue) > 0,
            is_active: c.isActive,
        };
    }

    /**
     * Money on a card offer is rejected, never coerced. The shared normalisers map
     * anything invalid to null, and null means "no offer" / "no cap" here — so a
     * typo'd -5 would quietly delete a live offer, and a -1 cap would quietly
     * uncap a percentage. Both must fail loudly instead.
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

    /** Reject an unusable time rather than silently dropping the window. */
    private timeOrThrow(input: unknown, label: string): string | null {
        if (input == null || input === '') return null;
        const t = normalizeOfferTime(input as string);
        if (t == null) {
            throw new BadRequestException(
                `${label} must be a time like 18:00.`,
            );
        }
        return t;
    }

    /** Reject out-of-range days; [] legitimately means every day. */
    private daysOrThrow(input: unknown): number[] | null {
        if (!Array.isArray(input) || input.length === 0) return null;
        for (const x of input) {
            const n = Number(x);
            if (!Number.isInteger(n) || n < 0 || n > 6) {
                throw new BadRequestException(
                    'Days must be 0 (Sunday) to 6 (Saturday).',
                );
            }
        }
        return normalizeOfferDays(input);
    }

    /**
     * A card may exist purely for tender/BIN purposes, so an offer is optional —
     * but a half-specified one would silently misprice, so it is rejected.
     */
    private assertOfferValid(c: BankCard): void {
        if (
            c.validFrom != null &&
            c.validUntil != null &&
            c.validFrom > c.validUntil
        ) {
            throw new BadRequestException(
                'Valid-from must be on or before valid-until.',
            );
        }
        // The schedule check is a plain start <= now <= end with no midnight wrap,
        // so an overnight window would save happily and never once apply.
        if (
            c.validTimeStart != null &&
            c.validTimeEnd != null &&
            c.validTimeStart >= c.validTimeEnd
        ) {
            throw new BadRequestException(
                'Start time must be before end time. An overnight window (e.g. 22:00–02:00) is not supported.',
            );
        }
        if (c.discountValue == null) return;
        const value = Number(c.discountValue);
        if (c.discountType !== 'flat' && c.discountType !== 'percentage') {
            throw new BadRequestException(
                'Choose a discount type (flat or percentage) for the card offer.',
            );
        }
        if (c.discountType === 'percentage' && value > 100) {
            throw new BadRequestException(
                'A percentage discount cannot exceed 100.',
            );
        }
    }

    /** Apply the offer fields a DTO actually carries onto the card. */
    private applyOfferFields(card: BankCard, dto: BankCardDto): void {
        if (dto.discount_type !== undefined)
            card.discountType = dto.discount_type ?? null;
        if (dto.discount_value !== undefined)
            card.discountValue = this.amountOrThrow(
                dto.discount_value,
                'Discount value',
            );
        if (dto.min_order_amount !== undefined)
            card.minOrderAmount = this.amountOrThrow(
                dto.min_order_amount,
                'Minimum order',
            );
        if (dto.max_discount_amount !== undefined)
            card.maxDiscountAmount = this.amountOrThrow(
                dto.max_discount_amount,
                'Maximum discount',
            );
        if (dto.valid_from !== undefined)
            card.validFrom = dto.valid_from ? new Date(dto.valid_from) : null;
        if (dto.valid_until !== undefined)
            card.validUntil = dto.valid_until
                ? new Date(dto.valid_until)
                : null;
        if (dto.valid_time_start !== undefined)
            card.validTimeStart = this.timeOrThrow(
                dto.valid_time_start,
                'Start time',
            );
        if (dto.valid_time_end !== undefined)
            card.validTimeEnd = this.timeOrThrow(
                dto.valid_time_end,
                'End time',
            );
        if (dto.valid_days_of_week !== undefined)
            card.validDaysOfWeek = this.daysOrThrow(dto.valid_days_of_week);
        if (dto.eligibility_branch_ids !== undefined)
            card.eligibilityBranchIds = Array.isArray(
                dto.eligibility_branch_ids,
            )
                ? dto.eligibility_branch_ids.map(Number)
                : null;
    }

    /** Cards carry no product scope, so eligibility_brand_ids is the whole story. */
    private scopeOf(c: BankCard): { eligibilityBrandIds: number[] | null } {
        return { eligibilityBrandIds: c.eligibilityBrandIds ?? null };
    }

    private async tenantBrandIds(tenantId: number): Promise<number[]> {
        const brands = await this.brandRepo.find({
            where: { tenantId },
            select: { id: true },
        });
        return brands.map((b) => b.id);
    }

    /** Validate / default eligibility_brand_ids for a brand-locked user. */
    private resolveEligibilityBrandIds(
        requested: number[] | null | undefined,
        allowedBrandIds: number[] | null | undefined,
    ): number[] | null {
        if (allowedBrandIds == null) {
            return Array.isArray(requested) && requested.length
                ? requested
                : null;
        }
        if (!Array.isArray(requested) || requested.length === 0) {
            return [...allowedBrandIds];
        }
        if (requested.some((id) => !allowedBrandIds.includes(Number(id)))) {
            throw new ForbiddenException(
                'You can only create bank cards for your own brand',
            );
        }
        return requested;
    }

    private assertManageable(
        c: BankCard,
        allowedBrandIds: number[] | null | undefined,
    ): void {
        const scope = manageScopeFor(this.scopeOf(c), allowedBrandIds);
        if (scope === 'full') return;
        throw new ForbiddenException(
            scope === 'detach'
                ? 'This card also serves other brands. Remove your brand from it instead of editing it.'
                : 'You can only manage bank cards that belong to your own brand',
        );
    }

    /**
     * Public view of a card offer for the customer app: enough to advertise the
     * deal and to recognise the customer's card, and nothing more. Never exposes
     * brand/branch targeting or the internal manage scope.
     */
    private toPublicResponse(c: BankCard) {
        return {
            id: c.id,
            name: c.name,
            bank: c.bank ?? null,
            network: c.network ?? null,
            bin_prefixes: c.binPrefixes ?? [],
            discount_type: c.discountType,
            discount_value:
                c.discountValue != null ? Number(c.discountValue) : null,
            min_order_amount:
                c.minOrderAmount != null ? Number(c.minOrderAmount) : null,
            max_discount_amount:
                c.maxDiscountAmount != null
                    ? Number(c.maxDiscountAmount)
                    : null,
            valid_from: c.validFrom?.toISOString() ?? null,
            valid_until: c.validUntil?.toISOString() ?? null,
            valid_time_start: c.validTimeStart ?? null,
            valid_time_end: c.validTimeEnd ?? null,
            valid_days_of_week: c.validDaysOfWeek ?? [],
            /** The offer only applies when the whole bill is paid on this card. */
            requires_full_card_payment: true,
        };
    }

    /**
     * Cards a customer can actually earn something with right now. Cards carrying
     * no offer are omitted — the app has no reason to show them, and their BINs
     * are not the customer's business.
     */
    async publicOffers(tenantId: number, brandId?: number | null) {
        const cards = await this.repo.find({
            where: { tenantId, isActive: true },
            order: { name: 'ASC' },
        });
        return (
            cards
                // Re-asserted in code, not left to the query alone: this list is public,
                // so a switched-off card must never slip out of it.
                .filter((c) => c.isActive)
                .filter(
                    (c) =>
                        c.discountValue != null && Number(c.discountValue) > 0,
                )
                .filter((c) =>
                    brandId == null
                        ? true
                        : isVisibleToBrands(this.scopeOf(c), [brandId]),
                )
                .map((c) => this.toPublicResponse(c))
        );
    }

    /**
     * Which offer card a number belongs to, matched on its BIN.
     *
     * Only leading digits are ever accepted: a BIN identifies the issuer and is
     * not sensitive, whereas a full card number is. Anything longer is truncated
     * here so a careless caller cannot push a PAN through this service or into
     * its logs. The longest matching prefix wins, so a specific product BIN beats
     * its bank's generic range.
     */
    async detectByBin(
        tenantId: number,
        rawBin: string,
        brandId?: number | null,
    ) {
        const bin = String(rawBin ?? '')
            .replace(/\D/g, '')
            .slice(0, 8);
        if (bin.length < 6) {
            throw new BadRequestException(
                'Provide the first 6 to 8 digits of the card number.',
            );
        }
        const offers = await this.publicOffers(tenantId, brandId);
        let best: (typeof offers)[number] | null = null;
        let bestLen = 0;
        for (const card of offers) {
            for (const raw of card.bin_prefixes ?? []) {
                const prefix = String(raw).replace(/\D/g, '');
                if (
                    prefix.length > 0 &&
                    bin.startsWith(prefix) &&
                    prefix.length > bestLen
                ) {
                    best = card;
                    bestLen = prefix.length;
                }
            }
        }
        return { bin, matched: best != null, card: best };
    }

    async findAll(
        tenantId: number | null,
        activeOnly = false,
        allowedBrandIds?: number[] | null,
    ) {
        if (tenantId == null) return [];
        const where: Record<string, unknown> = { tenantId };
        if (activeOnly) where.isActive = true;
        const list = await this.repo.find({
            where,
            order: { name: 'ASC' },
        });
        return list
            .filter((c) => isVisibleToBrands(this.scopeOf(c), allowedBrandIds))
            .map((c) =>
                this.toResponse(
                    c,
                    manageScopeFor(this.scopeOf(c), allowedBrandIds),
                ),
            );
    }

    async create(
        tenantId: number,
        dto: BankCardDto,
        allowedBrandIds?: number[] | null,
    ) {
        const name = (dto.name ?? '').trim();
        if (!name) throw new BadRequestException('Card name is required.');
        const card = this.repo.create({
            tenantId,
            name,
            bank: dto.bank?.trim() || null,
            network: dto.network?.trim() || null,
            binPrefixes: Array.isArray(dto.bin_prefixes)
                ? dto.bin_prefixes.map((b) => String(b).trim()).filter(Boolean)
                : null,
            eligibilityBrandIds: this.resolveEligibilityBrandIds(
                dto.eligibility_brand_ids,
                allowedBrandIds,
            ),
            isActive: dto.is_active ?? true,
        });
        this.applyOfferFields(card, dto);
        this.assertOfferValid(card);
        return this.toResponse(await this.repo.save(card));
    }

    async update(
        id: number,
        tenantId: number,
        dto: BankCardDto,
        allowedBrandIds?: number[] | null,
    ) {
        const card = await this.repo.findOne({ where: { id, tenantId } });
        if (!card) throw new NotFoundException('Bank card not found');
        this.assertManageable(card, allowedBrandIds);
        if (dto.name !== undefined) card.name = dto.name.trim();
        if (dto.bank !== undefined) card.bank = dto.bank?.trim() || null;
        if (dto.network !== undefined)
            card.network = dto.network?.trim() || null;
        if (dto.bin_prefixes !== undefined)
            card.binPrefixes = Array.isArray(dto.bin_prefixes)
                ? dto.bin_prefixes.map((b) => String(b).trim()).filter(Boolean)
                : null;
        if (dto.eligibility_brand_ids !== undefined)
            card.eligibilityBrandIds = this.resolveEligibilityBrandIds(
                dto.eligibility_brand_ids,
                allowedBrandIds,
            );
        if (dto.is_active !== undefined) card.isActive = dto.is_active;
        this.applyOfferFields(card, dto);
        this.assertOfferValid(card);
        await this.repo.save(card);
        return this.toResponse(card);
    }

    /**
     * Deleting a card shared with other brands would break their card-linked
     * offers, so a brand-locked caller only opts their own brands out.
     */
    async remove(
        id: number,
        tenantId: number,
        allowedBrandIds?: number[] | null,
    ) {
        const card = await this.repo.findOne({ where: { id, tenantId } });
        if (!card) throw new NotFoundException('Bank card not found');
        const scope = manageScopeFor(this.scopeOf(card), allowedBrandIds);

        if (scope === 'read_only') {
            throw new ForbiddenException(
                'You can only manage bank cards that belong to your own brand',
            );
        }

        if (scope === 'detach' && allowedBrandIds != null) {
            const remaining = detachBrands(
                this.scopeOf(card),
                allowedBrandIds,
                await this.tenantBrandIds(tenantId),
            );
            // Nothing left to serve — drop the row rather than persist [], which
            // would read back as "all brands" and resurrect the card everywhere.
            if (remaining.length > 0) {
                card.eligibilityBrandIds = remaining;
                await this.repo.save(card);
                return {
                    message:
                        'Your brand was removed from this card. It stays available to the other brands it serves.',
                    detached: true,
                    eligibility_brand_ids: remaining,
                };
            }
        }

        await this.repo.remove(card);
        return { message: 'Bank card removed' };
    }
}
