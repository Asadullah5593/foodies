/**
 * Validity normalisers shared by every offer surface (discounts, product
 * promotions, coupons, bank card offers). Kept in one place so a card's
 * date/time/day window is parsed by exactly the same rules as a discount's.
 */

/** Accept 'HH:mm' / 'HH:mm:ss' (Postgres time); empty/invalid → null. */
export function normalizeOfferTime(
    input: string | null | undefined,
): string | null {
    if (input == null) return null;
    const s = String(input).trim();
    return /^\d{1,2}:\d{2}(:\d{2})?$/.test(s) ? s : null;
}

/** Days of week 0-6 (0=Sun); dedupe + sort; empty/invalid → null (= every day). */
export function normalizeOfferDays(input: unknown): number[] | null {
    if (!Array.isArray(input)) return null;
    const set = new Set<number>();
    for (const x of input) {
        const n = Math.floor(Number(x));
        if (Number.isFinite(n) && n >= 0 && n <= 6) set.add(n);
    }
    return set.size ? [...set].sort((a, b) => a - b) : null;
}

/** Non-negative number or null (money amounts). */
export function normalizeAmountOrNull(input: unknown): number | null {
    if (input == null || input === '') return null;
    const n = Number(input);
    return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * Order types an offer can be limited to. POS calls it `takeaway` and consumer
 * web calls it `pickup`; they are the same thing, so both fold to `pickup` —
 * the same rule menu items use (`normalizeOrderTypeForMenu`).
 */
export const OFFER_ORDER_TYPES = ['delivery', 'pickup', 'dine_in'] as const;
export type OfferOrderType = (typeof OFFER_ORDER_TYPES)[number];

/** A request's `order_type` as a canonical offer order type; unknown → null. */
export function orderTypeToOfferOrderType(
    orderType: string | null | undefined,
): OfferOrderType | null {
    if (orderType == null) return null;
    const t = String(orderType).trim().toLowerCase();
    const key = t === 'takeaway' ? 'pickup' : t;
    return (OFFER_ORDER_TYPES as readonly string[]).includes(key)
        ? (key as OfferOrderType)
        : null;
}

/**
 * Order-type subset; empty / all selected / invalid → null (= every order
 * type), so "no restriction" has exactly one representation in the column.
 */
export function normalizeOfferOrderTypes(input: unknown): string[] | null {
    if (!Array.isArray(input)) return null;
    const set = new Set<string>();
    for (const x of input) {
        const key = orderTypeToOfferOrderType(String(x));
        if (key) set.add(key);
    }
    if (set.size === 0 || set.size === OFFER_ORDER_TYPES.length) return null;
    return OFFER_ORDER_TYPES.filter((t) => set.has(t));
}
