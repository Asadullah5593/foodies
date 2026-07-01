/**
 * Pure pricing + validation helpers for "Buy One Get One"-style DEALS (and the legacy
 * buy_x_get_y discount). Kept dependency-free so the math is exhaustively unit-tested.
 *
 * The core rule: across a set of unit prices, in each cohort of (buyQuantity + getQuantity)
 * units the CHEAPEST getQuantity units get `percent`% off. For a classic "2nd pizza half
 * price" that means buy=1, get=1, percent=50 → the cheaper of the two pizzas is halved.
 */

export function round2(n: number): number {
    return Math.round((Number(n) || 0) * 100) / 100;
}

/**
 * Per-unit discount AMOUNT for a BOGO promo, returned aligned to the input index order
 * (so `prices[i] - discounts[i]` is the final price of unit i). Within each cohort of
 * `buyQ + getQ` units (taken from highest price down), the cheapest `getQ` units are
 * discounted by `pct`%. Leftover units that don't complete a cohort are never discounted.
 *
 * Not rounded — callers round at their chosen granularity (per-unit or summed) so this can
 * back both the per-component deal pricing and the summed discount total identically.
 */
export function bogoUnitDiscounts(
    prices: number[],
    buyQ: number,
    getQ: number,
    pct: number,
): number[] {
    const b = Math.max(1, Math.floor(Number(buyQ) || 1));
    const g = Math.max(1, Math.floor(Number(getQ) || 1));
    const p = Math.min(100, Math.max(0, Number(pct) || 0));
    const out = new Array<number>(prices.length).fill(0);
    if (p <= 0 || prices.length === 0) return out;
    const cohort = b + g;
    // Sort by price descending, remembering each unit's original index.
    const order = prices
        .map((price, i) => ({ price: Number(price) || 0, i }))
        .sort((a, c) => c.price - a.price);
    for (let start = 0; start + cohort <= order.length; start += cohort) {
        // The cheapest g units of this cohort are the LAST g entries of the descending slice.
        for (let k = 0; k < g; k++) {
            const unit = order[start + cohort - 1 - k];
            out[unit.i] = (unit.price * p) / 100;
        }
    }
    return out;
}

/**
 * Final per-component price for a BOGO deal: each component's regular price minus its BOGO
 * discount, rounded to 2dp per component (so the persisted line subtotals are clean rupee
 * amounts and sum to the displayed total). Aligned to the input index order.
 */
export function priceBogoComponents(
    regularPrices: number[],
    buyQ: number,
    getQ: number,
    pct: number,
): number[] {
    const discounts = bogoUnitDiscounts(regularPrices, buyQ, getQ, pct);
    return regularPrices.map((price, i) => round2((Number(price) || 0) - discounts[i]));
}

export type BogoComponentConstraint = {
    slotIndex: number;
    categoryId: number | null;
    /** Business sub-category within a catalog category (e.g. "Classic" vs "Signature"). */
    label: string | null;
    sizeKey: string | null;
    /** Slot whose pick this slot must mirror (same size/category), or null. */
    mirrorSlotIndex: number | null;
    mirrorMatchSize: boolean;
    mirrorMatchCategory: boolean;
    /** Whitelist of variant sizeKeys allowed in this slot (e.g. ['12','14']); null = any. */
    allowedSizeKeys: string[] | null;
};

/**
 * Validate the cross-slot constraints of a BOGO deal's chosen components. Returns a
 * customer-facing error message if the selection is invalid, or null if it's fine.
 * Enforced SERVER-SIDE so a tampered payload can't bypass the same-size / same-category /
 * allowed-size rules the UI presents.
 *
 * "Strict same category" = same catalog category AND same label (so Classic pairs only with
 * Classic, Signature only with Signature; Build-Your-Own is its own category).
 */
/**
 * Whether a chosen item is actually allowed in a deal slot, by the slot's source definition.
 * Prevents a crafted payload from pricing an item the brand never enrolled in the deal.
 *  - fixed          → must be the slot's single source item.
 *  - choice_category→ item's category must equal the slot's source category.
 *  - choice_list    → item id must be in the slot's source id list.
 */
export function isComponentAllowedInSlot(
    comp: { menuItemId: number; categoryId: number | null },
    slot: {
        type: string;
        sourceMenuItemId: number | null;
        sourceCategoryId: number | null;
        sourceMenuItemIds: number[] | null;
    },
): boolean {
    if (slot.type === 'fixed') return slot.sourceMenuItemId === comp.menuItemId;
    if (slot.type === 'choice_category')
        return (
            slot.sourceCategoryId != null &&
            comp.categoryId != null &&
            comp.categoryId === slot.sourceCategoryId
        );
    if (slot.type === 'choice_list')
        return (
            Array.isArray(slot.sourceMenuItemIds) &&
            slot.sourceMenuItemIds.includes(comp.menuItemId)
        );
    return false;
}

export function validateBogoComponents(
    comps: BogoComponentConstraint[],
): string | null {
    const bySlot = new Map<number, BogoComponentConstraint>();
    for (const c of comps) bySlot.set(c.slotIndex, c);
    for (const c of comps) {
        if (c.allowedSizeKeys && c.allowedSizeKeys.length) {
            if (!c.sizeKey || !c.allowedSizeKeys.includes(c.sizeKey)) {
                const sizes = c.allowedSizeKeys.map((s) => `${s}"`).join(' / ');
                return `This deal is only available on ${sizes} pizzas.`;
            }
        }
        if (c.mirrorSlotIndex != null) {
            const m = bySlot.get(c.mirrorSlotIndex);
            if (!m) return 'Invalid deal configuration: a mirrored slot is missing.';
            if (c.mirrorMatchSize && (c.sizeKey ?? null) !== (m.sizeKey ?? null)) {
                return 'Both pizzas in this deal must be the same size.';
            }
            if (
                c.mirrorMatchCategory &&
                (c.categoryId !== m.categoryId ||
                    (c.label ?? '') !== (m.label ?? ''))
            ) {
                return 'The 2nd pizza must be the same category as the first.';
            }
        }
    }
    return null;
}
