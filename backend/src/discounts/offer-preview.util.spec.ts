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

/**
 * "Valid from / until" is picked as a plain date and saved as midnight UTC —
 * 05:00 in Pakistan. The preview reads it as a whole day on the browsed branch's
 * clock, exactly as checkout does, so the menu never shows a price the order
 * would not get, nor drops one it would.
 */
describe('previewItemOffers — validity dates', () => {
    const KARACHI = 'Asia/Karachi';
    const picked = (day: string) => new Date(day);
    const pkt = (local: string) => new Date(`${local}+05:00`);
    const dated = (o: Partial<PreviewOffer>) =>
        base({
            applicationScope: 'category',
            applicationScopeIds: [3],
            timezone: KARACHI,
            ...o,
        });
    const priceAt = (offer: PreviewOffer, at: Date) =>
        previewItemOffers(item, [offer], { ...opts, now: at }).discounted_price;

    it('keeps the discounted price through the last day', () => {
        const offer = dated({ validUntil: picked('2026-11-30') });
        expect(priceAt(offer, pkt('2026-11-30T04:59:00'))).toBe(720);
        // Past the stored 05:00, where the preview used to fall back to 800.
        expect(priceAt(offer, pkt('2026-11-30T05:01:00'))).toBe(720);
        expect(priceAt(offer, pkt('2026-11-30T23:59:30'))).toBe(720);
    });

    it('returns to the full price once the day is over', () => {
        const offer = dated({ validUntil: picked('2026-11-30') });
        expect(priceAt(offer, pkt('2026-12-01T00:00:30'))).toBe(800);
    });

    it('shows the discounted price from midnight on the first day', () => {
        const offer = dated({ validFrom: picked('2026-10-01') });
        expect(priceAt(offer, pkt('2026-09-30T23:59:30'))).toBe(800);
        expect(priceAt(offer, pkt('2026-10-01T00:00:30'))).toBe(720);
    });

    it("follows the offer's timezone, so a UTC branch keeps the UTC day", () => {
        const offer = dated({
            validUntil: picked('2026-11-30'),
            timezone: 'UTC',
        });
        // 02:00 on 1 Dec in Pakistan is 21:00 UTC on 30 Nov.
        expect(priceAt(offer, pkt('2026-12-01T02:00:00'))).toBe(720);
        expect(priceAt(offer, pkt('2026-12-01T05:00:30'))).toBe(800);
    });

    it('still ends an offer with a real expiry moment at that moment', () => {
        const expiry = new Date('2026-10-12T09:23:11.123Z');
        const offer = dated({ validUntil: expiry });
        expect(priceAt(offer, new Date(expiry.getTime() - 1000))).toBe(720);
        expect(priceAt(offer, new Date(expiry.getTime() + 1000))).toBe(800);
    });
});
