/**
 * The four offer kinds (`discounts.offer_kind`) and their customer-facing labels.
 *
 * Kinds are the pricing engine's stacking stages, applied in this order, each
 * compounding on the running line amount:
 *   product_promotion → discount → coupon → card_offer
 * So one line can legitimately carry several at once — never treat a line's
 * discount as having a single kind.
 *
 * Single source of truth: label an offer kind from here, never inline, or the
 * POS and admin drift apart (they already had done).
 */
export type OfferKind = 'product_promotion' | 'discount' | 'coupon' | 'card_offer';

export const OFFER_KINDS: OfferKind[] = [
  'product_promotion',
  'discount',
  'coupon',
  'card_offer',
];

export const OFFER_KIND_LABEL: Record<OfferKind, string> = {
  product_promotion: 'Product promo',
  discount: 'Discount',
  coupon: 'Coupon',
  card_offer: 'Card offer',
};

/** Label for a kind, falling back to the raw value for anything unrecognised. */
export function offerKindLabel(kind: string): string {
  return OFFER_KIND_LABEL[kind as OfferKind] ?? kind;
}
