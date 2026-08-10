import {
    DISCOUNT_FILTERS,
    discountFilterSql,
    isDiscountFilter,
} from './discount-filter';

/**
 * The Orders list and the product-wise sales report both filter by discount,
 * and they must agree — a coupon order that shows in one view but not the other
 * does not get reported as a bug, it just costs the reports their credibility.
 * This is the one place the rules live, so this is where they are pinned.
 */
describe('discount filter', () => {
    describe('isDiscountFilter', () => {
        it('accepts every value the UI can send', () => {
            for (const value of [
                'any',
                'none',
                'promo',
                'order',
                'coupon',
                'card',
                'staff',
            ])
                expect(isDiscountFilter(value)).toBe(true);
        });

        it('rejects anything else, so a stale URL filters nothing', () => {
            // The alternative — interpolating an unknown column — is either a
            // crash or an empty report, and an empty report looks like a
            // zero-sales day rather than a bad parameter.
            for (const value of [
                '',
                'promo ',
                'PROMO',
                'loyalty',
                '1',
                null,
                undefined,
                7,
            ])
                expect(isDiscountFilter(value)).toBe(false);
        });

        it('lists exactly the accepted values', () => {
            expect(DISCOUNT_FILTERS).toEqual([
                'any',
                'none',
                'promo',
                'order',
                'coupon',
                'card',
                'staff',
            ]);
        });
    });

    describe('discountFilterSql', () => {
        it('reads the total for "any" and "none", not a single stage', () => {
            expect(discountFilterSql('any', 'o')).toBe(
                'COALESCE(o.discount_amount, 0) > 0',
            );
            expect(discountFilterSql('none', 'o')).toBe(
                'COALESCE(o.discount_amount, 0) <= 0',
            );
        });

        it('targets the right column for each stage', () => {
            expect(discountFilterSql('promo', 'o')).toContain(
                'o.promo_discount_amount',
            );
            expect(discountFilterSql('order', 'o')).toContain(
                'o.order_discount_amount',
            );
            expect(discountFilterSql('coupon', 'o')).toContain(
                'o.coupon_discount_amount',
            );
            expect(discountFilterSql('card', 'o')).toContain(
                'o.card_discount_amount',
            );
            expect(discountFilterSql('staff', 'o')).toContain(
                'o.staff_discount_amount',
            );
        });

        it('honours the caller’s alias', () => {
            expect(discountFilterSql('any', 'ord')).toBe(
                'COALESCE(ord.discount_amount, 0) > 0',
            );
        });

        it('COALESCEs, so pre-split rows are not silently dropped', () => {
            // The stage columns are nullable on orders written before they
            // existed. `NULL <= 0` is NULL, which would drop every historic
            // order out of a "full price only" filter that must include them.
            for (const filter of DISCOUNT_FILTERS)
                expect(discountFilterSql(filter, 'o')).toMatch(/^COALESCE\(/);
        });

        it('never emits a bare value into SQL', () => {
            // Belt and braces: the type system already forbids it, but this is
            // the function that builds a WHERE clause from a query string.
            for (const filter of DISCOUNT_FILTERS) {
                const sql = discountFilterSql(filter, 'o');
                expect(sql).toMatch(/^COALESCE\(o\.[a-z_]+, 0\) (>|<=) 0$/);
            }
        });
    });
});
