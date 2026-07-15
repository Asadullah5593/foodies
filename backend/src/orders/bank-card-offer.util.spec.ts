import { BankCard } from '../entities/bank-card.entity';
import {
    bankCardOffers,
    bankCardToOffer,
    cardHasOffer,
} from './bank-card-offer.util';

const card = (over: Partial<BankCard> = {}): BankCard =>
    ({
        id: 4,
        tenantId: 6,
        name: 'HBL Premium',
        bank: 'HBL',
        network: 'Visa',
        binPrefixes: null,
        eligibilityBrandIds: null,
        eligibilityBranchIds: null,
        discountType: 'percentage',
        discountValue: 20,
        minOrderAmount: null,
        maxDiscountAmount: null,
        validFrom: null,
        validUntil: null,
        validTimeStart: null,
        validTimeEnd: null,
        validDaysOfWeek: null,
        isActive: true,
        ...over,
    }) as BankCard;

describe('cardHasOffer', () => {
    it('is true for a fully specified offer', () => {
        expect(cardHasOffer(card())).toBe(true);
    });

    it('is false for a card that only exists for tender/BIN', () => {
        expect(
            cardHasOffer(card({ discountType: null, discountValue: null })),
        ).toBe(false);
    });

    it('is false for a zero-value offer', () => {
        expect(cardHasOffer(card({ discountValue: 0 }))).toBe(false);
    });

    it('is false when the type is missing, rather than guessing one', () => {
        expect(cardHasOffer(card({ discountType: null }))).toBe(false);
    });
});

describe('bankCardToOffer', () => {
    it("buckets into the engine's card_offer stage", () => {
        expect(
            (bankCardToOffer(card()) as unknown as { offerKind: string })
                .offerKind,
        ).toBe('card_offer');
    });

    it('demands full-card tender on this exact card', () => {
        // requiresCard is what makes evalOfferOnRunning check the tender + card id;
        // without it the offer would silently apply to cash orders.
        const o = bankCardToOffer(card({ id: 9 }));
        expect(o.requiresCard).toBe(true);
        expect(o.eligibleBankCardIds).toEqual([9]);
    });

    it('is bank-funded and whole-order', () => {
        const o = bankCardToOffer(card()) as unknown as { funding: string };
        expect(o.funding).toBe('bank');
        expect(bankCardToOffer(card()).applicationScope).toBe('whole_order');
        expect(bankCardToOffer(card()).applicationScopeIds).toBeNull();
    });

    it('never requires a code (it must survive the auto-offer filter)', () => {
        expect(bankCardToOffer(card()).requiresCode).toBe(false);
    });

    it('carries the thresholds and validity window through verbatim', () => {
        const o = bankCardToOffer(
            card({
                discountType: 'flat',
                discountValue: 50,
                minOrderAmount: 500,
                maxDiscountAmount: 300,
                validFrom: new Date('2026-07-01'),
                validUntil: new Date('2026-12-31'),
                validTimeStart: '18:00',
                validTimeEnd: '23:00',
                validDaysOfWeek: [5, 6],
            }),
        );
        expect(o.type).toBe('flat');
        expect(o.value).toBe(50);
        expect(o.minOrderAmount).toBe(500);
        expect(o.maxDiscountAmount).toBe(300);
        expect(o.validFrom).toEqual(new Date('2026-07-01'));
        expect(o.validUntil).toEqual(new Date('2026-12-31'));
        expect(o.validTimeStart).toBe('18:00');
        expect(o.validTimeEnd).toBe('23:00');
        expect(o.validDaysOfWeek).toEqual([5, 6]);
    });

    it('passes brand/branch eligibility through so a card can be brand-scoped', () => {
        const o = bankCardToOffer(
            card({ eligibilityBrandIds: [25], eligibilityBranchIds: [10] }),
        );
        expect(o.eligibilityBrandIds).toEqual([25]);
        expect(o.eligibilityBranchIds).toEqual([10]);
    });

    it('keeps the bank card id, which callers must not write to orders.discount_id', () => {
        // orders.discount_id is FK-constrained to discounts(id); this id is a
        // bank_cards id and would point at an unrelated discount.
        expect(bankCardToOffer(card({ id: 4 })).id).toBe(4);
    });
});

describe('bankCardOffers', () => {
    it('keeps only active cards that actually carry an offer', () => {
        const offers = bankCardOffers([
            card({ id: 1 }),
            card({ id: 2, isActive: false }),
            card({ id: 3, discountValue: null, discountType: null }),
            card({ id: 4, discountValue: 0 }),
        ]);
        expect(offers.map((o) => o.id)).toEqual([1]);
    });

    it('returns nothing when no card has an offer', () => {
        expect(
            bankCardOffers([card({ discountValue: null, discountType: null })]),
        ).toEqual([]);
    });
});
