/**
 * Pure per-item menu price preview. Shows the "was / now / save" a customer is
 * GUARANTEED at checkout — so it only counts auto offers that resolve
 * unambiguously per item: product_promotion + discount, flat/percentage, scope
 * products|category matching the item, no min-order, brand/branch eligible,
 * audience all/legacy. Whole-order / BOGO / min-order / card offers can't be
 * shown as a single per-item number and are surfaced via has_cart_level_offer.
 * No OrdersService import — avoids a circular dependency with menu.service.
 */
import { OfferOrderType } from './offer-validity.util';

/** Sale channel an offer can be restricted to. */
export type OfferChannel = 'pos' | 'app' | 'web' | 'kiosk';

/** Map an order `source` to its offer channel. */
export function sourceToOfferChannel(source: string): OfferChannel | null {
    switch (source) {
        case 'pos':
            return 'pos';
        case 'consumer_app':
            return 'app';
        case 'consumer_web':
            return 'web';
        case 'kiosk':
            return 'kiosk';
        default:
            return null;
    }
}

/**
 * Channel gate shared by the pricing engine and the menu price preview.
 * `channels` null/empty = all channels; legacy `posOnly` = ['pos'].
 * An unknown channel (null) only passes unrestricted offers.
 */
export function offerAllowedOnChannel(
    channels: string[] | null | undefined,
    posOnly: boolean | null | undefined,
    channel: OfferChannel | null,
): boolean {
    if (posOnly && channel !== 'pos') return false;
    if (Array.isArray(channels) && channels.length > 0) {
        if (channel == null || !channels.includes(channel)) return false;
    }
    return true;
}

/**
 * Order-type gate, shared by the pricing engine and the menu price preview.
 * `orderTypes` null/empty = every order type. An unknown order type (null)
 * only passes unrestricted offers, mirroring the channel gate above — a
 * preview must never promise a discount that would not survive checkout.
 */
export function offerAllowedOnOrderType(
    orderTypes: string[] | null | undefined,
    orderType: OfferOrderType | null,
): boolean {
    if (!Array.isArray(orderTypes) || orderTypes.length === 0) return true;
    if (orderType == null) return false;
    return orderTypes.includes(orderType);
}

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
    posOnly: boolean;
    channels: string[] | null;
    /** Optional: offers created before order-type scoping simply have none. */
    orderTypes?: string[] | null;
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
    opts: {
        branchId: number | null;
        allowTimeBoxed: boolean;
        now: Date;
        /** Sale channel the preview is rendered for; null = only unrestricted offers. */
        channel?: OfferChannel | null;
        /**
         * Order type the preview is rendered for; null = only offers with no
         * order-type restriction. Menu browsing usually has no order type yet,
         * so a delivery-only offer stays out of the "was / now" rather than
         * promising a price that checkout would not honour.
         */
        orderType?: OfferOrderType | null;
    },
): PreviewResult {
    const timeBoxed = (o: PreviewOffer) =>
        !!o.validTimeStart ||
        !!o.validTimeEnd ||
        (Array.isArray(o.validDaysOfWeek) && o.validDaysOfWeek.length > 0);

    const applies = (o: PreviewOffer): boolean => {
        if (o.requiresCard) return false;
        if (!offerAllowedOnChannel(o.channels, o.posOnly, opts.channel ?? null))
            return false;
        if (!offerAllowedOnOrderType(o.orderTypes, opts.orderType ?? null))
            return false;
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
        if (!offerAllowedOnChannel(o.channels, o.posOnly, opts.channel ?? null))
            return false;
        if (!offerAllowedOnOrderType(o.orderTypes, opts.orderType ?? null))
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
