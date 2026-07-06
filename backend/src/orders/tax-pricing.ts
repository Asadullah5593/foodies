/**
 * Pure GST/tax pricing helpers — kept dependency-free so the (Pakistan card-vs-cash) tax math
 * is exhaustively unit-tested. Rates are fractions (0.15 = 15%).
 *
 * Pakistan FBR/PRA/SRB give a REDUCED sales-tax rate on card/digital payments vs cash. We model
 * it as a tender-portioned tax: the cash-paid share of the (pre-tax, post-discount) base is taxed
 * at the cash rate, the card-paid share at the card rate, then summed. Single-tender orders are the
 * common case and exact; split (part-cash/part-card) bills partition the base by the tender ratio.
 */

export function round2(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
}

export type TenderSplit = {
    /** Cash-tendered amount (weight). */
    cash?: number | null;
    /** Card/digital-tendered amount (weight). */
    card?: number | null;
} | null;

export type TaxResult = {
    taxAmount: number;
    /** Which tender(s) drove the tax, for audit/receipt. */
    basis: 'cash' | 'card' | 'split';
    rateCash: number;
    rateCard: number;
};

/**
 * Resolve the effective cash/card GST rates. Precedence: a per-branch override (optional, for
 * multi-jurisdiction tenants) → the tenant's Business-Settings per-tender rates. The card rate
 * inherits the cash rate when unset (a single-rate business just sets cash); everything defaults
 * to 0 when nothing is configured.
 */
export function resolveGstRates(
    branch:
        | { gstRateCash?: number | null; gstRateCard?: number | null }
        | null
        | undefined,
    tenant:
        | { gstRateCash?: number | null; gstRateCard?: number | null }
        | null
        | undefined,
): { cash: number; card: number } {
    const num = (v: unknown): number | null => {
        const n = Number(v);
        return v != null && Number.isFinite(n) ? n : null;
    };
    const tenantCash = num(tenant?.gstRateCash) ?? 0;
    const tenantCard = num(tenant?.gstRateCard) ?? tenantCash;
    const cash = num(branch?.gstRateCash) ?? tenantCash;
    const card = num(branch?.gstRateCard) ?? tenantCard;
    return { cash, card };
}

/**
 * Tender-portioned tax on `afterDiscount` (the pre-tax, post-discount, ex-delivery base).
 *  - No tender info → whole base at the CASH rate (the higher one → never under-charges before
 *    the customer picks a tender).
 *  - Single tender → whole base at that tender's rate (exact).
 *  - Split → partition the base by the tender ratio (card / (cash+card)), tax each part at its
 *    rate, round each part, sum. Basis is 'split'.
 */
export function computeTenderTax(
    afterDiscount: number,
    split: TenderSplit,
    rateCash: number,
    rateCard: number,
): TaxResult {
    const base = Math.max(0, Number(afterDiscount) || 0);
    const rc = Math.max(0, Number(rateCash) || 0);
    const rk = Math.max(0, Number(rateCard) || 0);
    const cash = Math.max(0, Number(split?.cash) || 0);
    const card = Math.max(0, Number(split?.card) || 0);
    const sum = cash + card;

    if (sum <= 0) {
        // Unknown tender: default to cash (higher) so the shown total never under-charges.
        return {
            taxAmount: round2(base * rc),
            basis: 'cash',
            rateCash: rc,
            rateCard: rk,
        };
    }
    if (card <= 0) {
        return {
            taxAmount: round2(base * rc),
            basis: 'cash',
            rateCash: rc,
            rateCard: rk,
        };
    }
    if (cash <= 0) {
        return {
            taxAmount: round2(base * rk),
            basis: 'card',
            rateCash: rc,
            rateCard: rk,
        };
    }
    // Mixed tender: partition the pre-tax base by the entered tender ratio.
    const cardBase = round2(base * (card / sum));
    const cashBase = round2(base - cardBase);
    const taxAmount = round2(round2(cashBase * rc) + round2(cardBase * rk));
    return { taxAmount, basis: 'split', rateCash: rc, rateCard: rk };
}
