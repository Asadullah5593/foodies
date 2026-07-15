/**
 * Effective-brand resolution for offers (discounts / product promotions /
 * coupons / card offers) and campaigns.
 *
 * `eligibility_brand_ids` historically meant two opposite things:
 *   - pricing side  (offer-preview.util.ts, orders.service.ts): null/[] = EVERY brand
 *   - admin list    (discounts.service.ts findAll):             null/[] = owner-only, invisible
 *
 * That asymmetry hid owner-created offers from the very brand they discount.
 * The helpers here give both sides one answer: an offer's *effective* brands are
 * the brands whose menu the offer can actually touch.
 */

/** menu_item id -> brand_id, menu_category id -> brand_id. */
export type ScopeBrandLookup = {
    itemBrands: ReadonlyMap<number, number>;
    categoryBrands: ReadonlyMap<number, number>;
};

export const EMPTY_SCOPE_LOOKUP: ScopeBrandLookup = {
    itemBrands: new Map(),
    categoryBrands: new Map(),
};

export type BrandScopedOffer = {
    applicationScope?: string | null;
    applicationScopeIds?: number[] | null;
    eligibilityBrandIds?: number[] | null;
};

/**
 * How a brand-locked admin may act on an offer.
 *  - 'full'      : the offer touches only their brands — edit and delete freely.
 *  - 'detach'    : it also serves brands they don't own — they may only remove
 *                  their own brand from it, never edit or delete it outright.
 *  - 'read_only' : visible for context, not theirs to change.
 */
export type ManageScope = 'full' | 'detach' | 'read_only';

const toIds = (input: unknown): number[] | null => {
    if (!Array.isArray(input)) return null;
    const out: number[] = [];
    for (const raw of input) {
        const n = Number(raw);
        if (Number.isFinite(n)) out.push(n);
    }
    return out.length ? out : null;
};

/**
 * Brands reachable through application_scope_ids. A product-scoped offer listing
 * only Fireaway items IS a Fireaway offer, whatever eligibility_brand_ids says —
 * menu_items.brand_id and menu_categories.brand_id are both NOT NULL, so this is
 * exact rather than a guess. Returns null when the scope implies no brand
 * (whole_order), or when the ids resolve to nothing (stale/unknown ids).
 */
export function deriveScopeBrandIds(
    offer: BrandScopedOffer,
    lookup: ScopeBrandLookup,
): number[] | null {
    const ids = toIds(offer.applicationScopeIds);
    if (!ids) return null;
    const source =
        offer.applicationScope === 'products'
            ? lookup.itemBrands
            : offer.applicationScope === 'category'
              ? lookup.categoryBrands
              : null;
    if (!source) return null;
    const brands = new Set<number>();
    for (const id of ids) {
        const brandId = source.get(id);
        if (brandId != null) brands.add(Number(brandId));
    }
    return brands.size ? [...brands].sort((a, b) => a - b) : null;
}

/**
 * The brands an offer actually serves. Explicit eligibility_brand_ids wins;
 * otherwise fall back to the brands its products/categories belong to.
 * null = genuinely every brand (e.g. an unrestricted whole-order discount).
 */
export function effectiveBrandIds(
    offer: BrandScopedOffer,
    lookup: ScopeBrandLookup = EMPTY_SCOPE_LOOKUP,
): number[] | null {
    return (
        toIds(offer.eligibilityBrandIds) ?? deriveScopeBrandIds(offer, lookup)
    );
}

/** Does this offer concern any of the caller's brands? null effective = all brands = yes. */
export function isVisibleToBrands(
    offer: BrandScopedOffer,
    allowedBrandIds: number[] | null | undefined,
    lookup: ScopeBrandLookup = EMPTY_SCOPE_LOOKUP,
): boolean {
    if (allowedBrandIds == null) return true;
    const effective = effectiveBrandIds(offer, lookup);
    if (effective == null) return true; // all-brand offer: it prices their POS, so they see it
    return effective.some((id) => allowedBrandIds.includes(Number(id)));
}

/**
 * Full control only when every brand the offer serves is one of theirs; an offer
 * shared with brands they don't own is detach-only, so one brand admin can never
 * silently rewrite or delete another brand's offer.
 */
export function manageScopeFor(
    offer: BrandScopedOffer,
    allowedBrandIds: number[] | null | undefined,
    lookup: ScopeBrandLookup = EMPTY_SCOPE_LOOKUP,
): ManageScope {
    if (allowedBrandIds == null) return 'full';
    const effective = effectiveBrandIds(offer, lookup);
    if (effective == null) return 'detach'; // all-brand: may opt their brand out only
    const mine = effective.filter((id) => allowedBrandIds.includes(Number(id)));
    if (mine.length === 0) return 'read_only';
    return mine.length === effective.length ? 'full' : 'detach';
}

/**
 * eligibility_brand_ids after a brand-locked admin opts their brands out.
 * An all-brand offer (null) has to be materialised against the tenant's brand
 * list first — there is no other way to say "everyone except me".
 *
 * Returns `[]` when nothing is left, which the caller must treat as "delete the
 * row" rather than persist: [] would read back as all-brands and resurrect the
 * offer everywhere.
 */
export function detachBrands(
    offer: BrandScopedOffer,
    allowedBrandIds: number[],
    tenantBrandIds: number[],
    lookup: ScopeBrandLookup = EMPTY_SCOPE_LOOKUP,
): number[] {
    const effective = effectiveBrandIds(offer, lookup) ?? tenantBrandIds;
    return effective
        .map((id) => Number(id))
        .filter((id) => !allowedBrandIds.includes(id))
        .sort((a, b) => a - b);
}
