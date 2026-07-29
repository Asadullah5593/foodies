/**
 * The pricing engine's stage kinds and their customer-facing labels.
 *
 * Kinds are the engine's stacking stages, applied in this order, each
 * compounding on the running line amount:
 *   product_promotion → discount → staff_discount → coupon → card_offer
 * So one line can legitimately carry several at once — never treat a line's
 * discount as having a single kind.
 *
 * Single source of truth: label a kind from here, never inline, or the POS and
 * admin drift apart (they already had done).
 */
export type OfferKind =
  | 'product_promotion'
  | 'discount'
  | 'staff_discount'
  | 'coupon'
  | 'card_offer';

/**
 * The kinds that are `discounts.offer_kind` values — what an offer can be
 * authored as. `staff_discount` is deliberately absent: it is a stage the
 * engine books, but it comes from the separate staff_discounts module, so it
 * must never appear in an offer-kind picker.
 */
export const OFFER_KINDS: OfferKind[] = [
  'product_promotion',
  'discount',
  'coupon',
  'card_offer',
];

export const OFFER_KIND_LABEL: Record<OfferKind, string> = {
  product_promotion: 'Product promo',
  discount: 'Discount',
  staff_discount: 'Staff discount',
  coupon: 'Coupon',
  card_offer: 'Card offer',
};

/** Label for a kind, falling back to the raw value for anything unrecognised. */
export function offerKindLabel(kind: string): string {
  return OFFER_KIND_LABEL[kind as OfferKind] ?? kind;
}
