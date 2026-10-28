import { resolveGstRates, computeTenderTax, taxBaseFor } from './tax-pricing';

describe('tax-pricing', () => {
    describe('resolveGstRates', () => {
        it('uses tenant (Business Settings) per-tender rates', () => {
            expect(
                resolveGstRates(null, { gstRateCash: 0.15, gstRateCard: 0.05 }),
            ).toEqual({
                cash: 0.15,
                card: 0.05,
            });
        });
        it('card inherits the cash rate when card is unset (single-rate business)', () => {
            expect(
                resolveGstRates(null, { gstRateCash: 0.15, gstRateCard: null }),
            ).toEqual({
                cash: 0.15,
                card: 0.15,
            });
        });
        it('defaults to 0 when nothing is configured', () => {
            expect(resolveGstRates(null, null)).toEqual({ cash: 0, card: 0 });
            expect(resolveGstRates(null, {})).toEqual({ cash: 0, card: 0 });
        });
        it('a per-branch override beats the tenant rate (multi-jurisdiction)', () => {
            expect(
                resolveGstRates(
                    { gstRateCash: 0.1, gstRateCard: null },
                    { gstRateCash: 0.15, gstRateCard: 0.05 },
                ),
            ).toEqual({ cash: 0.1, card: 0.05 });
        });
    });

    describe('computeTenderTax', () => {
        it('no tender info → whole base at the CASH rate (never under-charges)', () => {
            const r = computeTenderTax(1000, null, 0.15, 0.05);
            expect(r.taxAmount).toBe(150);
            expect(r.basis).toBe('cash');
        });
        it('all cash → cash rate', () => {
            expect(
                computeTenderTax(1000, { cash: 1000, card: 0 }, 0.15, 0.05)
                    .taxAmount,
            ).toBe(150);
        });
        it('all card → card rate', () => {
            const r = computeTenderTax(
                1000,
                { cash: 0, card: 1000 },
                0.15,
                0.05,
            );
            expect(r.taxAmount).toBe(50);
            expect(r.basis).toBe('card');
        });
        it('50/50 split → half at each rate', () => {
            const r = computeTenderTax(
                1000,
                { cash: 500, card: 500 },
                0.15,
                0.05,
            );
            // cashBase 500*0.15=75 + cardBase 500*0.05=25 = 100
            expect(r.taxAmount).toBe(100);
            expect(r.basis).toBe('split');
        });
        it('uneven split partitions the pre-tax base by tender ratio', () => {
            // 800 cash / 200 card on a 1000 base → cardBase 200, cashBase 800
            const r = computeTenderTax(
                1000,
                { cash: 800, card: 200 },
                0.15,
                0.05,
            );
            expect(r.taxAmount).toBe(round(800 * 0.15) + round(200 * 0.05)); // 120 + 10 = 130
            expect(r.taxAmount).toBe(130);
        });
        it('zero rates → zero tax', () => {
            expect(
                computeTenderTax(1000, { cash: 500, card: 500 }, 0, 0)
                    .taxAmount,
            ).toBe(0);
        });
        it('rounds each tender portion to 2dp', () => {
            const r = computeTenderTax(
                333.33,
                { cash: 0, card: 333.33 },
                0.15,
                0.05,
            );
            expect(r.taxAmount).toBe(round(333.33 * 0.05));
        });
    });
});

function round(n: number): number {
    return Math.round(n * 100) / 100;
}

describe('taxBaseFor', () => {
    it('taxes the discounted price by default (rule off)', () => {
        expect(
            taxBaseFor({
                menuPrice: 1000,
                afterDiscount: 500,
                taxOnMenuPrice: false,
            }),
        ).toBe(500);
        expect(
            taxBaseFor({
                menuPrice: 1000,
                afterDiscount: 500,
                taxOnMenuPrice: undefined,
            }),
        ).toBe(500);
    });

    it('taxes the menu price when the business turns the rule on', () => {
        expect(
            taxBaseFor({
                menuPrice: 1000,
                afterDiscount: 500,
                taxOnMenuPrice: true,
            }),
        ).toBe(1000);
        // 50% off a Rs 1,000 item at 16%: 80 on the discounted price, 160 on the menu price.
        const off = computeTenderTax(500, null, 0.16, 0.08);
        const on = computeTenderTax(
            taxBaseFor({
                menuPrice: 1000,
                afterDiscount: 500,
                taxOnMenuPrice: true,
            }),
            null,
            0.16,
            0.08,
        );
        expect(off.taxAmount).toBe(80);
        expect(on.taxAmount).toBe(160);
    });

    it('changes nothing for an order without a discount', () => {
        expect(
            taxBaseFor({
                menuPrice: 750,
                afterDiscount: 750,
                taxOnMenuPrice: true,
            }),
        ).toBe(
            taxBaseFor({
                menuPrice: 750,
                afterDiscount: 750,
                taxOnMenuPrice: false,
            }),
        );
    });

    it('still taxes a fully discounted order on its menu price when the rule is on', () => {
        expect(
            taxBaseFor({
                menuPrice: 999,
                afterDiscount: 0,
                taxOnMenuPrice: true,
            }),
        ).toBe(999);
        expect(
            taxBaseFor({
                menuPrice: 999,
                afterDiscount: 0,
                taxOnMenuPrice: false,
            }),
        ).toBe(0);
    });

    it('never goes below zero', () => {
        expect(
            taxBaseFor({
                menuPrice: 100,
                afterDiscount: -5,
                taxOnMenuPrice: false,
            }),
        ).toBe(0);
    });
});
