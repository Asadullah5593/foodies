import { resolveGstRates, computeTenderTax } from './tax-pricing';

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
