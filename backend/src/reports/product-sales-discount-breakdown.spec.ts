import { reconcileDiscountBreakdown } from './reports.service';

/**
 * The product-sales report allocates each order's discount across its lines
 * pro-rata by subtotal share, and now does that once per discount stage so the
 * report can say WHICH kind of discount gave the money away.
 *
 * Five independent SUM()s, each rounded to paisa, will not always land on the
 * same number as the single SUM() of the total — so the split is reconciled
 * before it is served. These tests pin that reconciliation, because the failure
 * mode is quiet: a breakdown that sits a paisa off the total beside it, which
 * anyone reconciling the day's discounts will read as a bug in the report.
 */
describe('reconcileDiscountBreakdown', () => {
    const sum = (b: Record<string, number>): number =>
        Math.round(Object.values(b).reduce((n, v) => n + v, 0) * 100) / 100;

    it('leaves an already-exact split alone', () => {
        const parts = {
            promo: 400.26,
            order: 0,
            coupon: 0,
            card: 800,
            staff: 0,
        };
        expect(reconcileDiscountBreakdown(parts, 1200.26)).toEqual(parts);
    });

    it('absorbs rounding drift so the parts sum to the total', () => {
        // Each share rounded down a paisa; the total was rounded from the
        // unsplit SUM() and sits two paisa higher.
        const out = reconcileDiscountBreakdown(
            { promo: 33.33, order: 33.33, coupon: 33.33, card: 0, staff: 0 },
            100,
        );
        expect(sum(out)).toBe(100);
    });

    it('puts the drift on the largest stage, where it matters least', () => {
        const out = reconcileDiscountBreakdown(
            { promo: 0.01, order: 999.98, coupon: 0, card: 0, staff: 0 },
            1000,
        );
        expect(out.order).toBe(999.99);
        expect(out.promo).toBe(0.01); // the small stage is untouched
    });

    it('corrects downwards too', () => {
        const out = reconcileDiscountBreakdown(
            { promo: 500.01, order: 500.01, coupon: 0, card: 0, staff: 0 },
            1000,
        );
        expect(sum(out)).toBe(1000);
        // Tied stages: the first one carries the correction.
        expect(out.promo).toBe(499.99);
        expect(out.order).toBe(500.01);
    });

    it('never invents a discount where none was given', () => {
        const none = { promo: 0, order: 0, coupon: 0, card: 0, staff: 0 };
        expect(reconcileDiscountBreakdown(none, 0)).toEqual(none);
    });

    it('does not lose paisa across a whole page of rows', () => {
        // The report sums the reconciled rows for its totals strip, so drift
        // must not accumulate row over row.
        const rows = Array.from({ length: 50 }, (_, i) => {
            const total = Math.round((10 + i * 1.37) * 100) / 100;
            const raw = {
                promo: Math.round(total * 0.333 * 100) / 100,
                order: Math.round(total * 0.333 * 100) / 100,
                coupon: Math.round(total * 0.334 * 100) / 100,
                card: 0,
                staff: 0,
            };
            return { total, split: reconcileDiscountBreakdown(raw, total) };
        });
        for (const row of rows) expect(sum(row.split)).toBe(row.total);

        const grandTotal =
            Math.round(rows.reduce((n, r) => n + r.total, 0) * 100) / 100;
        const grandSplit =
            Math.round(rows.reduce((n, r) => n + sum(r.split), 0) * 100) / 100;
        expect(grandSplit).toBe(grandTotal);
    });
});
