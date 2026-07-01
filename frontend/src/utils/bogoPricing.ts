/**
 * Client mirror of the backend BOGO deal pricing (backend/src/orders/bogo-pricing.ts).
 * Used to show the live deal total in the configure modal and the cart. The SERVER reprices
 * authoritatively at quote/order time — this must stay in lockstep so the shown total equals
 * the charged total.
 *
 * Rule: across the unit prices, in each cohort of (buyQ + getQ) the cheapest getQ units get
 * pct% off. "2nd pizza half price" = buy 1, get 1, pct 50 → the cheaper pizza is halved.
 */

export function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** Per-unit discount amounts, aligned to the input index order. */
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
  const order = prices
    .map((price, i) => ({ price: Number(price) || 0, i }))
    .sort((a, c) => c.price - a.price);
  for (let start = 0; start + cohort <= order.length; start += cohort) {
    for (let k = 0; k < g; k++) {
      const unit = order[start + cohort - 1 - k];
      out[unit.i] = (unit.price * p) / 100;
    }
  }
  return out;
}

/** Final per-component prices (full + half-cheaper), each rounded to 2dp. */
export function priceBogoComponents(
  regularPrices: number[],
  buyQ: number,
  getQ: number,
  pct: number,
): number[] {
  const discounts = bogoUnitDiscounts(regularPrices, buyQ, getQ, pct);
  return regularPrices.map((price, i) => round2((Number(price) || 0) - discounts[i]));
}

/** Total of a BOGO deal's pizza components (full + half-cheaper), rounded. */
export function bogoDealTotal(
  regularPrices: number[],
  buyQ: number,
  getQ: number,
  pct: number,
): number {
  return round2(
    priceBogoComponents(regularPrices, buyQ, getQ, pct).reduce((a, b) => a + b, 0),
  );
}
