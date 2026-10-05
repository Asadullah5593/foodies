import { OrdersService } from './orders.service';
import { resolveOfferSettings } from './offer-settings';

/**
 * "Valid from / Valid until" at checkout, through the real staged orchestration.
 *
 * The admin picks a date; it is saved as midnight UTC, which is 05:00 in
 * Pakistan. Pricing used to compare that as a moment, so an offer valid until
 * 30 Nov stopped at 05:00 on the 30th. These pin the whole-day rule on the
 * branch's clock, and that a real moment is still compared as a moment.
 */
type AnyOffer = Record<string, unknown>;

const mkOffer = (o: AnyOffer): AnyOffer => ({
    id: 1,
    requiresCode: false,
    offerKind: 'discount',
    type: 'flat',
    value: 10,
    applicationScope: 'whole_order',
    applicationScopeIds: null,
    eligibilityBranchIds: null,
    eligibilityBrandIds: null,
    requiresCard: false,
    eligibleBankCardIds: null,
    minOrderAmount: null,
    maxDiscountAmount: null,
    validFrom: null,
    validUntil: null,
    validTimeStart: null,
    validTimeEnd: null,
    validDaysOfWeek: null,
    posOnly: false,
    code: null,
    funding: 'merchant',
    ...o,
});

const mkCard = (c: AnyOffer): AnyOffer => ({
    id: 7,
    tenantId: 1,
    name: 'HBL Premium',
    isActive: true,
    discountType: 'percentage',
    discountValue: 10,
    minOrderAmount: null,
    maxDiscountAmount: null,
    validFrom: null,
    validUntil: null,
    validTimeStart: null,
    validTimeEnd: null,
    validDaysOfWeek: null,
    eligibilityBrandIds: null,
    eligibilityBranchIds: null,
    ...c,
});

type Staged = {
    discountAmount: number;
    couponDiscountAmount: number;
    cardDiscountAmount: number;
    totalDiscount: number;
};

type Harness = {
    discountRepo: unknown;
    bankCardRepo: unknown;
    branchRepo: unknown;
    resolveStagedOffers: (ctx: unknown) => Promise<Staged>;
};

const BRANCH = 16;

function pricing(opts: {
    timezone?: string | null;
    autoOffers?: AnyOffer[];
    coupon?: AnyOffer | null;
    bankCards?: AnyOffer[];
}) {
    const svc = Object.create(OrdersService.prototype) as Harness;
    svc.discountRepo = {
        find: () => Promise.resolve(opts.autoOffers ?? []),
        findOne: () => Promise.resolve(opts.coupon ?? null),
    };
    svc.bankCardRepo = { find: () => Promise.resolve(opts.bankCards ?? []) };
    const branchLookup = jest.fn(() =>
        Promise.resolve(
            opts.timezone === null
                ? null
                : { timezone: opts.timezone ?? 'Asia/Karachi' },
        ),
    );
    svc.branchRepo = { findOne: branchLookup };
    const price = (over: Record<string, unknown> = {}) =>
        svc.resolveStagedOffers({
            tenantId: 1,
            subtotal: 100,
            source: 'pos',
            branchId: BRANCH,
            orderBrandId: 2,
            lineDetails: [
                {
                    menuItemId: 55,
                    categoryId: 1,
                    itemSubtotal: 100,
                    brandId: 2,
                    quantity: 1,
                    unitCost: 40,
                    isDeal: false,
                },
            ],
            couponCode: null,
            fullCardPayment: false,
            bankCardId: null,
            settings: resolveOfferSettings({ maxTotalDiscountPercent: 50 }),
            ...over,
        });
    return { price, branchLookup };
}

/** Sets the clock to a wall-clock time in Pakistan. */
const atPkt = (local: string) =>
    jest.useFakeTimers({ now: new Date(`${local}+05:00`) });

/** What the admin forms save for a picked date. */
const picked = (day: string) => new Date(day);

describe('offer validity dates at checkout', () => {
    afterEach(() => jest.useRealTimers());

    describe('"Valid until 30 Nov" on a branch in Pakistan', () => {
        const offers = [mkOffer({ id: 20, validUntil: picked('2026-11-30') })];

        it.each([
            ['just before the stored 05:00', '2026-11-30T04:59:00'],
            [
                'just after it, where the offer used to stop',
                '2026-11-30T05:01:00',
            ],
            ['in the evening', '2026-11-30T21:00:00'],
            ['in the last minute of the day', '2026-11-30T23:59:30'],
        ])('still applies %s', async (_label, local) => {
            atPkt(local);
            const r = await pricing({ autoOffers: offers }).price();
            expect(r.discountAmount).toBe(10);
        });

        it('stops when the day is over', async () => {
            atPkt('2026-12-01T00:00:30');
            const r = await pricing({ autoOffers: offers }).price();
            expect(r.discountAmount).toBe(0);
            expect(r.totalDiscount).toBe(0);
        });
    });

    describe('"Valid from 1 Oct" on a branch in Pakistan', () => {
        const offers = [mkOffer({ id: 20, validFrom: picked('2026-10-01') })];

        it('does not apply the night before', async () => {
            atPkt('2026-09-30T23:59:30');
            const r = await pricing({ autoOffers: offers }).price();
            expect(r.discountAmount).toBe(0);
        });

        it('applies from midnight, not from 05:00', async () => {
            atPkt('2026-10-01T00:00:30');
            const r = await pricing({ autoOffers: offers }).price();
            expect(r.discountAmount).toBe(10);
        });
    });

    it("reads the day on the order's own branch clock", async () => {
        // 02:00 on 1 Dec in Pakistan is still 30 Nov for a branch left on UTC.
        const offers = [mkOffer({ id: 20, validUntil: picked('2026-11-30') })];
        atPkt('2026-12-01T02:00:00');
        const onUtc = await pricing({
            timezone: 'UTC',
            autoOffers: offers,
        }).price();
        expect(onUtc.discountAmount).toBe(10);
        const inPakistan = await pricing({ autoOffers: offers }).price();
        expect(inPakistan.discountAmount).toBe(0);
    });

    it('covers a coupon entered by code', async () => {
        const coupon = mkOffer({
            id: 30,
            offerKind: 'coupon',
            requiresCode: true,
            code: 'NOV10',
            validFrom: picked('2026-11-01'),
            validUntil: picked('2026-11-30'),
        });
        atPkt('2026-11-30T22:00:00');
        const last = await pricing({ coupon }).price({ couponCode: 'NOV10' });
        expect(last.couponDiscountAmount).toBe(10);

        atPkt('2026-12-01T00:30:00');
        const after = await pricing({ coupon }).price({ couponCode: 'NOV10' });
        expect(after.couponDiscountAmount).toBe(0);
    });

    it('covers a bank card offer', async () => {
        const bankCards = [mkCard({ id: 7, validUntil: picked('2026-11-30') })];
        const paidByCard = { fullCardPayment: true, bankCardId: 7 };
        atPkt('2026-11-30T22:00:00');
        const last = await pricing({ bankCards }).price(paidByCard);
        expect(last.cardDiscountAmount).toBe(10);

        atPkt('2026-12-01T00:30:00');
        const after = await pricing({ bankCards }).price(paidByCard);
        expect(after.cardDiscountAmount).toBe(0);
    });

    describe('a coupon that expires at a real moment', () => {
        // Minted when a customer claims a promotion: claim time + N×24h.
        const expiry = new Date('2026-10-12T09:23:11.123Z');
        const coupon = mkOffer({
            id: 31,
            offerKind: 'coupon',
            requiresCode: true,
            code: 'CLAIMED',
            validUntil: expiry,
        });

        it('still ends at that moment, not at the end of the day', async () => {
            jest.useFakeTimers({ now: new Date(expiry.getTime() - 1000) });
            const before = await pricing({ coupon }).price({
                couponCode: 'CLAIMED',
            });
            expect(before.couponDiscountAmount).toBe(10);

            jest.useFakeTimers({ now: new Date(expiry.getTime() + 1000) });
            const after = await pricing({ coupon }).price({
                couponCode: 'CLAIMED',
            });
            expect(after.couponDiscountAmount).toBe(0);
        });

        it('needs no branch clock', async () => {
            jest.useFakeTimers({ now: new Date(expiry.getTime() - 1000) });
            const { price, branchLookup } = pricing({ coupon });
            await price({ couponCode: 'CLAIMED' });
            expect(branchLookup).not.toHaveBeenCalled();
        });
    });

    describe('the branch lookup', () => {
        it('is skipped when no offer has a picked date', async () => {
            atPkt('2026-11-30T21:00:00');
            const { price, branchLookup } = pricing({
                autoOffers: [
                    mkOffer({ id: 20 }),
                    mkOffer({ id: 21, value: 5 }),
                ],
                bankCards: [mkCard({ id: 7 })],
            });
            const r = await price();
            expect(r.discountAmount).toBe(10);
            expect(branchLookup).not.toHaveBeenCalled();
        });

        it('happens once however many offers have dates', async () => {
            atPkt('2026-11-30T21:00:00');
            const { price, branchLookup } = pricing({
                autoOffers: [
                    mkOffer({ id: 20, validUntil: picked('2026-11-30') }),
                    mkOffer({ id: 21, validFrom: picked('2026-11-01') }),
                    mkOffer({ id: 22, validUntil: picked('2026-12-31') }),
                ],
                bankCards: [
                    mkCard({ id: 7, validUntil: picked('2026-11-30') }),
                ],
            });
            await price();
            expect(branchLookup).toHaveBeenCalledTimes(1);
        });

        it('reads the day in UTC when the branch row is missing', async () => {
            const offers = [
                mkOffer({ id: 20, validUntil: picked('2026-11-30') }),
            ];
            // 23:30 UTC on 30 Nov.
            jest.useFakeTimers({ now: new Date('2026-11-30T23:30:00Z') });
            const r = await pricing({
                timezone: null,
                autoOffers: offers,
            }).price();
            expect(r.discountAmount).toBe(10);
        });
    });
});
