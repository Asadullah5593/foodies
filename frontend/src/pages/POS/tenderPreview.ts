/**
 * Cash-vs-card preview: GST differs per tender (e.g. 16% cash / 5% card), so the
 * till shows the customer both outcomes before a tender is picked. Derived from
 * the current quote's rates; the quote itself re-runs (discounts included) once
 * the cashier toggles the tender, so this is a preview — the charged figures
 * always come from the re-quoted totals.
 */
export interface TenderPreviewQuote {
  subtotal?: number | null;
  discount_amount?: number | null;
  loyalty_discount?: number | null;
  service_charge?: number | null;
  delivery_fee?: number | null;
  tax_rate_cash?: number | null;
  tax_rate_card?: number | null;
  /** What the GST is charged on: the menu price when Business Settings taxes before discounts. */
  tax_base?: number | null;
}

export interface TenderPreview {
  rateCash: number;
  rateCard: number;
  cashTax: number;
  cardTax: number;
  cashTotal: number;
  cardTotal: number;
}

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

export function tenderPreviewOf(quote: TenderPreviewQuote | undefined | null): TenderPreview | null {
  if (!quote) return null;
  const rateCash = Number(quote.tax_rate_cash ?? 0);
  const rateCard = Number(quote.tax_rate_card ?? 0);
  if (rateCash === rateCard) return null; // same rate — nothing to compare
  const afterDiscount = Math.max(
    0,
    round2((Number(quote.subtotal) || 0) - (Number(quote.discount_amount) || 0) - (Number(quote.loyalty_discount) || 0)),
  );
  // GST is charged on tax_base: the menu price when Business Settings taxes
  // before discounts, else the discounted price (older servers omit it).
  const taxBase = quote.tax_base != null ? Number(quote.tax_base) : afterDiscount;
  const extras = (Number(quote.service_charge) || 0) + (Number(quote.delivery_fee) || 0);
  const cashTax = round2(taxBase * rateCash);
  const cardTax = round2(taxBase * rateCard);
  return {
    rateCash,
    rateCard,
    cashTax,
    cardTax,
    cashTotal: round2(afterDiscount + extras + cashTax),
    cardTotal: round2(afterDiscount + extras + cardTax),
  };
}
