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
