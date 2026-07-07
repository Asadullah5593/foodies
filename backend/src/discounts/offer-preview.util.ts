/**
 * Pure per-item menu price preview. Shows the "was / now / save" a customer is
 * GUARANTEED at checkout — so it only counts auto offers that resolve
 * unambiguously per item: product_promotion + discount, flat/percentage, scope
 * products|category matching the item, no min-order, brand/branch eligible,
 * audience all/legacy. Whole-order / BOGO / min-order / card offers can't be
 * shown as a single per-item number and are surfaced via has_cart_level_offer.
 * No OrdersService import — avoids a circular dependency with menu.service.
 */

export interface PreviewOffer {
    name: string;
    offerKind: string;
    type: string;
    value: number;
    minOrderAmount: number | null;
    maxDiscountAmount: number | null;
    applicationScope: string;
    applicationScopeIds: number[] | null;
    eligibilityBranchIds: number[] | null;
    eligibilityBrandIds: number[] | null;
    audience: string | null;
    requiresCard: boolean;
    validFrom: Date | null;
    validUntil: Date | null;
    validTimeStart: string | null;
    validTimeEnd: string | null;
    validDaysOfWeek: number[] | null;
}

export interface PreviewItem {
    menuItemId: number;
    categoryId: number | null;
    brandId: number | null;
    price: number;
}

export interface PreviewResult {
    original_price: number;
    discounted_price: number;
    discount_amount: number;
    discount_percent: number;
    discount_label: string | null;
    has_cart_level_offer: boolean;
}

const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function previewItemOffers(
    item: PreviewItem,
    offers: PreviewOffer[],
    opts: { branchId: number | null; allowTimeBoxed: boolean; now: Date },
): PreviewResult {
    const timeBoxed = (o: PreviewOffer) =>
        !!o.validTimeStart ||
        !!o.validTimeEnd ||
        (Array.isArray(o.validDaysOfWeek) && o.validDaysOfWeek.length > 0);

    const applies = (o: PreviewOffer): boolean => {
        if (o.requiresCard) return false;
        if (o.minOrderAmount != null) return false;
        if (o.type !== 'flat' && o.type !== 'percentage') return false;
        if (o.audience != null && o.audience !== 'all') return false;
        if (o.validFrom && opts.now < o.validFrom) return false;
        if (o.validUntil && opts.now > o.validUntil) return false;
        if (!opts.allowTimeBoxed && timeBoxed(o)) return false;
        if (
            Array.isArray(o.eligibilityBranchIds) &&
            o.eligibilityBranchIds.length > 0 &&
            (opts.branchId == null ||
                !o.eligibilityBranchIds.includes(opts.branchId))
        )
            return false;
        if (
            Array.isArray(o.eligibilityBrandIds) &&
            o.eligibilityBrandIds.length > 0 &&
            (item.brandId == null ||
                !o.eligibilityBrandIds.includes(item.brandId))
        )
            return false;
        return true;
    };

    const inScope = (o: PreviewOffer): boolean => {
        if (o.applicationScope === 'products')
            return (
                Array.isArray(o.applicationScopeIds) &&
                o.applicationScopeIds.includes(item.menuItemId)
            );
        if (o.applicationScope === 'category')
            return (
                Array.isArray(o.applicationScopeIds) &&
                item.categoryId != null &&
                o.applicationScopeIds.includes(item.categoryId)
            );
        return false; // whole_order → cart-level only
    };

    const amountFor = (o: PreviewOffer, base: number): number => {
        let amt =
            o.type === 'flat'
                ? Math.min(Number(o.value), base)
                : (base * Number(o.value)) / 100;
        if (o.maxDiscountAmount != null)
            amt = Math.min(amt, Number(o.maxDiscountAmount));
        return r2(amt);
    };

    let running = item.price;
    let label: string | null = null;

    // S1 — best product promotion for this item.
    let promoAmt = 0;
    for (const o of offers)
        if (applies(o) && o.offerKind === 'product_promotion' && inScope(o)) {
            const a = amountFor(o, running);
            if (a > promoAmt) {
                promoAmt = a;
                label = o.name;
            }
        }
    running = r2(running - promoAmt);

    // S2 — best scoped order discount, compounded on the running amount.
    let discAmt = 0;
    for (const o of offers)
        if (applies(o) && o.offerKind === 'discount' && inScope(o)) {
            const a = amountFor(o, running);
            if (a > discAmt) {
                discAmt = a;
                if (promoAmt === 0) label = o.name;
            }
        }
    running = r2(running - discAmt);

    // Cart-level flag: any auto offer that touches this item but can't be shown
    // per-item (whole_order / BOGO), gated to the item's brand where scoped.
    const hasCart = offers.some((o) => {
        if (o.offerKind !== 'discount' && o.offerKind !== 'product_promotion')
            return false;
        const cartShaped =
            o.applicationScope === 'whole_order' ||
            o.minOrderAmount != null ||
            o.type === 'buy_x_get_y';
        if (!cartShaped) return false;
        if (
            Array.isArray(o.eligibilityBrandIds) &&
            o.eligibilityBrandIds.length > 0 &&
            (item.brandId == null ||
                !o.eligibilityBrandIds.includes(item.brandId))
        )
            return false;
        return true;
    });

    const totalDisc = r2(promoAmt + discAmt);
    return {
        original_price: r2(item.price),
        discounted_price: running,
        discount_amount: totalDisc,
        discount_percent:
            item.price > 0 ? Math.round((totalDisc / item.price) * 100) : 0,
        discount_label: totalDisc > 0 ? label : null,
        has_cart_level_offer: hasCart,
    };
}
