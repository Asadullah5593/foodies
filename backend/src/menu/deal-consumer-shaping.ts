/**
 * Consumer-channel shaping for deal slot choice items.
 *
 * The deal serializer (`MenuService.getDealByMenuItemId`) is shared by POS (`'pos'`) and the
 * consumer app (`'app'`). POS receives the FULL choice-item shape and applies the deal display
 * rules client-side (see frontend `DealConfigModal` / `ItemConfigModal`). The mobile app was
 * getting that same unrestricted shape and so offered options POS forbids (e.g. a 10-piece
 * variant inside a 5-piece slot, cross-sell "add a drink" groups, à-la-carte add-ons).
 *
 * This module pre-applies POS's in-deal restrictions on the backend for the consumer channel so
 * the app can render the payload 1:1 without re-deriving deal rules. It is a pure transform on
 * the serialized shape and NEVER runs for the `'pos'` channel, so POS is provably unaffected.
 *
 * The three rules mirror POS exactly:
 *   1. Variants are filtered to the slot's locked size (`slotSizeKey`) or whitelist
 *      (`allowedSizeKeys`). If an item has no variant at that size (e.g. a non-size side sharing
 *      the slot) its variants are left untouched — the same fallback POS uses
 *      (`ItemConfigModal` `restrictedVariants`/`visibleVariants`).
 *   2. Modifier groups flagged `hide_in_deals` are dropped — these are cross-sell groups
 *      ("Add a drink", "Add a dip") that the deal's own slots already cover
 *      (`DealConfigModal` `itemToCustomize.modifier_groups.filter(g => !g.hide_in_deals)`).
 *   3. Add-ons are removed entirely — a fixed-price deal never charges à-la-carte add-ons
 *      (`DealConfigModal` `itemToCustomize.addons = []`).
 */

/** Minimal shape of a resolved deal choice item that this restriction touches. */
export interface ShapeableChoiceItem {
    variants?: Array<{ size_key?: string | null }> | null;
    addons?: unknown[] | null;
    modifier_groups?: Array<{ hide_in_deals?: boolean }> | null;
}

/** Filter a choice item's variants to the sizes a deal slot allows (rule 1, with POS fallback). */
export function restrictVariantsToSlotSize<
    V extends { size_key?: string | null },
>(
    variants: V[],
    slotSizeKey: string | null,
    allowedSizeKeys: string[] | null,
): V[] {
    if (slotSizeKey) {
        const kept = variants.filter(
            (v) => (v.size_key ?? null) === slotSizeKey,
        );
        // No variant at the locked size (a non-size side in the slot): keep all, like POS.
        return kept.length > 0 ? kept : variants;
    }
    if (allowedSizeKeys && allowedSizeKeys.length > 0) {
        const kept = variants.filter(
            (v) => v.size_key != null && allowedSizeKeys.includes(v.size_key),
        );
        return kept.length > 0 ? kept : variants;
    }
    return variants;
}

/**
 * Restrict a deal slot's choice items to exactly what POS offers inside a deal.
 * Returns NEW objects; never mutates the input.
 */
export function restrictDealChoiceItemsForConsumer<
    T extends ShapeableChoiceItem,
>(
    items: readonly T[],
    slotSizeKey: string | null,
    allowedSizeKeys: string[] | null,
): T[] {
    return items.map(
        (item) =>
            ({
                ...item,
                variants: restrictVariantsToSlotSize(
                    item.variants ?? [],
                    slotSizeKey,
                    allowedSizeKeys,
                ),
                addons: [],
                modifier_groups: (item.modifier_groups ?? []).filter(
                    (g) => !g.hide_in_deals,
                ),
            }) as unknown as T,
    );
}
