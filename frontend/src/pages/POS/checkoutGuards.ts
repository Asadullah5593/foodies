/**
 * Pure checkout preconditions, extracted so they can be tested without
 * mounting the whole POS page.
 */

export type PlaceabilityInput = {
  /** Total from the live quote (falls back to the raw cart sum). */
  orderTotal: number;
  /** Lines in the cart. */
  itemCount: number;
  /** Quote's combined discount across every stage. */
  discountAmount: number;
  /** Quote's loyalty redemption, which is applied after the stages. */
  loyaltyDiscount: number;
};

/**
 * Whether this cart may be placed.
 *
 * A zero total used to be refused outright. That was right when nothing could
 * legitimately reach zero, and wrong once a 100% staff discount existed: it
 * blocked the very case the comp button is for. The check now separates the two
 * kinds of zero —
 *
 *   deliberate — items in the cart, and a discount large enough to cover them.
 *                Placeable: the customer pays nothing and the order is comped.
 *   broken     — an undiscounted cart pricing to zero, i.e. a missing or
 *                mispriced quote. Still refused; placing it would give food
 *                away by accident.
 *
 * A negative total is always refused.
 */
export function canPlaceOrder(input: PlaceabilityInput): boolean {
  const { orderTotal, itemCount, discountAmount, loyaltyDiscount } = input;
  if (!Number.isFinite(orderTotal) || orderTotal < 0) return false;
  if (orderTotal > 0) return true;
  return itemCount > 0 && Number(discountAmount) + Number(loyaltyDiscount) > 0;
}
