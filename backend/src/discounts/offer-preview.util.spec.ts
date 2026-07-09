import {
    previewItemOffers,
    PreviewOffer,
    PreviewItem,
} from './offer-preview.util';

const base = (o: Partial<PreviewOffer>): PreviewOffer => ({
    name: 'X',
    offerKind: 'discount',
    type: 'percentage',
    value: 10,
    minOrderAmount: null,
    maxDiscountAmount: null,
    applicationScope: 'whole_order',
    applicationScopeIds: null,
    eligibilityBranchIds: null,
    eligibilityBrandIds: null,
    audience: null,
    requiresCard: false,
    posOnly: false,
    channels: null,
    validFrom: null,
    validUntil: null,
    validTimeStart: null,
    validTimeEnd: null,
    validDaysOfWeek: null,
    ...o,
});

const item: PreviewItem = {
    menuItemId: 55,
    categoryId: 3,
    brandId: 2,
    price: 800,
};
const now = new Date('2026-07-07T12:00:00Z');
const opts = { branchId: 10, allowTimeBoxed: false, now };

describe('previewItemOffers', () => {
    it('E1 — 10% category discount → 720 on an 800 item', () => {
        const r = previewItemOffers(
            item,
            [
                base({
                    name: '10% pizzas',
                    applicationScope: 'category',
                    applicationScopeIds: [3],
                }),
            ],
            opts,
        );
        expect(r.discounted_price).toBe(720);
        expect(r.discount_amount).toBe(80);
        expect(r.discount_percent).toBe(10);
        expect(r.discount_label).toBe('10% pizzas');
        expect(r.has_cart_level_offer).toBe(false);
    });

    it('E2 — product promo compounds before an order discount', () => {
        const r = previewItemOffers(
            { ...item, price: 100 },
            [
                base({
                    offerKind: 'product_promotion',
                    type: 'percentage',
                    value: 10,
                    applicationScope: 'products',
                    applicationScopeIds: [55],
                }),
                base({
                    type: 'percentage',
                    value: 10,
                    applicationScope: 'category',
                    applicationScopeIds: [3],
                }),
            ],
            opts,
        );
        expect(r.discounted_price).toBe(81); // 100→90→81
    });

    it('whole-order / min-order / card offers are not shown per item', () => {
        const r = previewItemOffers(
            item,
            [
                base({ applicationScope: 'whole_order' }), // cart-level
                base({
                    applicationScope: 'category',
                    applicationScopeIds: [3],
                    minOrderAmount: 500,
                }), // min-order excluded
                base({ requiresCard: true }),
            ],
            opts,
        );
        expect(r.discount_amount).toBe(0);
        expect(r.has_cart_level_offer).toBe(true);
    });

    it('non-matching brand offer does not apply', () => {
        const r = previewItemOffers(
            item,
            [
                base({
                    applicationScope: 'category',
                    applicationScopeIds: [3],
                    eligibilityBrandIds: [999],
                }),
            ],
            opts,
        );
        expect(r.discount_amount).toBe(0);
    });

    it('channel-restricted offer only previews on its channels', () => {
        const offers = [
            base({
                name: 'app only',
                applicationScope: 'category',
                applicationScopeIds: [3],
                channels: ['app'],
            }),
        ];
        const onPos = previewItemOffers(item, offers, {
            ...opts,
            channel: 'pos',
        });
        expect(onPos.discount_amount).toBe(0);
        const onApp = previewItemOffers(item, offers, {
            ...opts,
            channel: 'app',
        });
        expect(onApp.discount_amount).toBe(80);
        // Unknown channel → only unrestricted offers show.
        const unknown = previewItemOffers(item, offers, opts);
        expect(unknown.discount_amount).toBe(0);
    });

    it('legacy posOnly offer previews only on POS', () => {
        const offers = [
            base({
                applicationScope: 'category',
                applicationScopeIds: [3],
                posOnly: true,
            }),
        ];
        expect(
            previewItemOffers(item, offers, { ...opts, channel: 'app' })
                .discount_amount,
        ).toBe(0);
        expect(
            previewItemOffers(item, offers, { ...opts, channel: 'pos' })
                .discount_amount,
        ).toBe(80);
    });

    it('channel-restricted cart-level offer only flags its channels', () => {
        const offers = [
            base({ applicationScope: 'whole_order', channels: ['pos'] }),
        ];
        expect(
            previewItemOffers(item, offers, { ...opts, channel: 'pos' })
                .has_cart_level_offer,
        ).toBe(true);
        expect(
            previewItemOffers(item, offers, { ...opts, channel: 'app' })
                .has_cart_level_offer,
        ).toBe(false);
    });

    it('time-boxed offers are excluded from the per-item preview', () => {
        const r = previewItemOffers(
            item,
            [
                base({
                    applicationScope: 'category',
                    applicationScopeIds: [3],
                    validTimeStart: '12:00',
                    validTimeEnd: '14:00',
                }),
            ],
            opts,
        );
        expect(r.discount_amount).toBe(0);
    });
});
