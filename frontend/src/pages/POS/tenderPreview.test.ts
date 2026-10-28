import { describe, expect, it } from 'vitest';
import { tenderPreviewOf } from './tenderPreview';

// Rs 1,000 of food, 50% off, 16% cash / 8% card, delivery 150.
const quote = {
  subtotal: 1000,
  discount_amount: 500,
  loyalty_discount: 0,
  service_charge: 0,
  delivery_fee: 150,
  tax_rate_cash: 0.16,
  tax_rate_card: 0.08,
};

describe('tenderPreviewOf', () => {
  it('taxes the discounted price when the server sends no base (rule off, or an older server)', () => {
    expect(tenderPreviewOf(quote)).toEqual({
      rateCash: 0.16,
      rateCard: 0.08,
      cashTax: 80,
      cardTax: 40,
      cashTotal: 730,
      cardTotal: 690,
    });
  });

  it('taxes the menu price when the quote says GST is charged on it', () => {
    expect(tenderPreviewOf({ ...quote, tax_base: 1000 })).toEqual({
      rateCash: 0.16,
      rateCard: 0.08,
      cashTax: 160,
      cardTax: 80,
      // The customer still pays the discounted food price; only the tax grows.
      cashTotal: 810,
      cardTotal: 730,
    });
  });

  it('shows nothing when both tenders have the same rate, or there is no quote', () => {
    expect(tenderPreviewOf({ ...quote, tax_rate_card: 0.16 })).toBeNull();
    expect(tenderPreviewOf(undefined)).toBeNull();
  });
});
