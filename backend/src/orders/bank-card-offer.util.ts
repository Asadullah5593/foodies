import { BankCard } from '../entities/bank-card.entity';
import { Discount } from '../entities/discount.entity';

/**
 * Bank card discounts are their own module: the card owns its offer, rather than
 * being unlocked by a `discounts` row with requires_card=true. The pricing engine
 * still speaks one language (Discount), so a card is adapted into the shape the
 * `card_offer` stage already evaluates — no second pricing path.
 *
 * The synthetic offer is never persisted. Its `id` is the BANK CARD's id, which is
 * why callers must keep it out of anything writing `orders.discount_id` (that
 * column is FK-constrained to discounts(id) and the ids are unrelated).
 */
export function bankCardToOffer(card: BankCard): Discount {
    return {
        id: card.id,
        tenantId: card.tenantId,
        name: card.name,
        code: null,
        type: card.discountType ?? 'percentage',
        value: Number(card.discountValue ?? 0),
        minOrderAmount: card.minOrderAmount,
        maxDiscountAmount: card.maxDiscountAmount,
        // Card offers are always whole-order.
        applicationScope: 'whole_order',
        applicationScopeIds: null,
        eligibilityBranchIds: card.eligibilityBranchIds ?? null,
        eligibilityBrandIds: card.eligibilityBrandIds ?? null,
        // What makes the engine demand full-card tender on this exact card.
        requiresCard: true,
        eligibleBankCardIds: [card.id],
        isActive: card.isActive,
        posOnly: false,
        channels: null,
        allowedRoles: null,
        requiresCode: false,
        validFrom: card.validFrom,
        validUntil: card.validUntil,
        validTimeStart: card.validTimeStart,
        validTimeEnd: card.validTimeEnd,
        validDaysOfWeek: card.validDaysOfWeek,
        buyQuantity: null,
        getQuantity: null,
        getDiscountPercent: null,
        bogoMatchSameGroup: false,
        offerKind: 'card_offer',
        audience: null,
        eligibleCustomerIds: null,
        perCustomerLimit: null,
        voucherValidityDays: null,
        globalLimit: null,
        priority: 0,
        // Bank-funded: excluded from the merchant discount cap by default.
        funding: 'bank',
    } as unknown as Discount;
}

/** A card only prices something once someone has given it a discount to apply. */
export function cardHasOffer(card: BankCard): boolean {
    return (
        card.discountValue != null &&
        Number(card.discountValue) > 0 &&
        (card.discountType === 'flat' || card.discountType === 'percentage')
    );
}

/** Active cards carrying a usable offer, adapted for the engine. */
export function bankCardOffers(cards: BankCard[]): Discount[] {
    return cards
        .filter((c) => c.isActive && cardHasOffer(c))
        .map(bankCardToOffer);
}
