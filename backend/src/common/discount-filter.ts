/**
 * The "was this order discounted, and how?" filter, shared by the admin Orders
 * list and the product-wise sales report.
 *
 * Both surfaces show the same per-stage split (promo / order / coupon / card /
 * staff), so both must filter it by the same rules — a coupon order appearing
 * in one view and not the other is the kind of mismatch nobody reports as a bug,
 * they just stop trusting the reports.
 *
 * Values are whitelisted rather than interpolated: an unrecognised value is
 * ignored (no filter) instead of matching nothing, which is how a typo in a
 * saved URL turns into "the report is empty today".
 */

/** Discount stages, mapped to their column on `orders`. */
const STAGE_COLUMNS = {
    promo: 'promo_discount_amount',
    order: 'order_discount_amount',
    coupon: 'coupon_discount_amount',
    card: 'card_discount_amount',
    staff: 'staff_discount_amount',
} as const;

export type DiscountStage = keyof typeof STAGE_COLUMNS;

/** `any` = discounted at all, `none` = full price, or one specific stage. */
export type DiscountFilter = 'any' | 'none' | DiscountStage;

export const DISCOUNT_FILTERS: DiscountFilter[] = [
    'any',
    'none',
    ...(Object.keys(STAGE_COLUMNS) as DiscountStage[]),
];

export function isDiscountFilter(value: unknown): value is DiscountFilter {
    return (
        typeof value === 'string' &&
        (DISCOUNT_FILTERS as string[]).includes(value)
    );
}

/**
 * SQL predicate for a filter value, or null when there is nothing to apply.
 *
 * `alias` is the orders table alias in the caller's query. The column names are
 * snake_case DB names, not entity properties, so this works from a raw builder
 * as well as an entity one.
 *
 * COALESCE is deliberate: the split columns are nullable on rows written before
 * they existed, and `NULL > 0` is NULL — which would quietly drop historic
 * orders out of a `none` filter that is supposed to include them.
 */
export function discountFilterSql(
    filter: DiscountFilter,
    alias: string,
): string | null {
    if (filter === 'any') return `COALESCE(${alias}.discount_amount, 0) > 0`;
    if (filter === 'none') return `COALESCE(${alias}.discount_amount, 0) <= 0`;
    const column = STAGE_COLUMNS[filter];
    return column ? `COALESCE(${alias}.${column}, 0) > 0` : null;
}
