/**
 * Tenant offer-engine settings (stored in tenants.offer_settings simple-json).
 * Null / missing keys fall back to these defaults, so an unconfigured tenant
 * behaves exactly as before: cap off, deals excluded from every offer, one
 * voucher per order, Option-B cap base.
 */
export interface OfferSettings {
  /** Stacking order of the groups; informational — engine applies stages in this order. */
  stackingOrder: string[];
  /** Tie-break within a group: keep the largest discount, or honour `priority`. */
  withinGroup: 'best_value' | 'priority';
  /** Max total discount per order as a % of the cap base; null = no % cap. */
  maxTotalDiscountPercent: number | null;
  /** Absolute max total discount per order; null = no absolute cap. Lower of the two wins. */
  maxTotalDiscountAmount: number | null;
  /** Base the cap % is measured against. Option B (default) = discountable non-deal subtotal. */
  maxTotalDiscountBase: 'non_deal_subtotal' | 'full_subtotal';
  /** Whether bank-card offers count toward the cap (default false — bank-funded). */
  capIncludesCardOffers: boolean;
  /** Whether loyalty redemption counts toward the cap (default true). */
  capIncludesLoyalty: boolean;
  /** Enforce a per-line "never below cost" floor when cost is known. */
  costFloorEnabled: boolean;
  /** Deal value counts toward coupon min-order thresholds (but never receives a discount). */
  dealsCountTowardThresholds: boolean;
  /** Whether loyalty may reduce deal-line value (default false — deals untouched). */
  loyaltyAppliesToDeals: boolean;
  /** Allow discounts/coupons to apply to deal lines (default false; POS per-order toggle overrides). */
  allowOffersOnDeals: boolean;
  /** Allow a customer to apply more than one voucher per order. */
  allowVoucherStacking: boolean;
  /** Whether a POS price-overridden line still receives auto-discounts/coupons. */
  offersApplyToOverriddenLines: boolean;
  /** Whether a POS price override may go below cost (bypass the cost floor). */
  priceOverrideBypassesCostFloor: boolean;
}

export const DEFAULT_OFFER_SETTINGS: OfferSettings = {
  stackingOrder: [
    'product_promotion',
    'discount',
    // Staff discretion sits after automatic offers but before the customer's
    // own coupon and card offer, so goodwill at the till never devalues what
    // the customer brought with them.
    'staff_discount',
    'coupon',
    'card_offer',
    'loyalty',
  ],
  withinGroup: 'best_value',
  maxTotalDiscountPercent: null,
  maxTotalDiscountAmount: null,
  maxTotalDiscountBase: 'non_deal_subtotal',
  capIncludesCardOffers: false,
  capIncludesLoyalty: true,
  costFloorEnabled: true,
  dealsCountTowardThresholds: true,
  loyaltyAppliesToDeals: false,
  allowOffersOnDeals: false,
  allowVoucherStacking: false,
  offersApplyToOverriddenLines: false,
  priceOverrideBypassesCostFloor: true,
};

/** Merge stored (possibly partial/null) settings over the safe defaults. */
export function resolveOfferSettings(
  raw: Partial<OfferSettings> | null | undefined,
): OfferSettings {
  if (!raw) return { ...DEFAULT_OFFER_SETTINGS };
  return { ...DEFAULT_OFFER_SETTINGS, ...raw };
}
