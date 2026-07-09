import { describe, it, expect } from 'vitest';
import { renderInvoiceHtml, sampleInvoice } from './renderInvoice';
import { DEFAULT_INVOICE_TEMPLATE_CONFIG, InvoiceTemplateConfig } from './types';

const cfg = (over: Partial<InvoiceTemplateConfig>) => ({
  ...DEFAULT_INVOICE_TEMPLATE_CONFIG,
  ...over,
});
const render = (over: Partial<InvoiceTemplateConfig>) =>
  renderInvoiceHtml(sampleInvoice(), 'thermal_80mm', cfg(over)).html;

describe('renderInvoiceHtml — field toggles drive output', () => {
  it('shows/hides category', () => {
    expect(render({ showCategory: true })).toContain('Pizza');
    // category chip absent when off (the word "Pizza" only appears as a category here)
    const off = render({ showCategory: false });
    expect(off).not.toContain('class="cat"');
  });

  it('shows/hides "Powered by Rex Technologies"', () => {
    expect(render({ showPoweredBy: true })).toContain('Powered by Rex Technologies');
    expect(render({ showPoweredBy: false })).not.toContain('Powered by Rex Technologies');
  });

  it('itemizes the split only when total is off (no double-count)', () => {
    // total on + per-stage on → show combined only, NOT the per-stage lines
    const both = render({ showDiscountTotal: true, showPromoDiscount: true, showCouponDiscount: true });
    expect(both).toContain('Discount (SAVE10)');
    expect(both).not.toContain('Promotional discount');
    expect(both).not.toContain('Coupon discount');
    // total off + per-stage on → itemize
    const itemized = render({ showDiscountTotal: false, showPromoDiscount: true, showCouponDiscount: true });
    expect(itemized).toContain('Promotional discount');
    expect(itemized).toContain('Coupon discount');
    expect(itemized).not.toContain('Discount (SAVE10)');
  });

  it('falls back to the combined line for older orders with no split', () => {
    // Simulate a pre-migration order: combined discount present, split all zero.
    const data = sampleInvoice();
    const o = data.orders[0];
    o.promo_discount_amount = 0;
    o.coupon_discount_amount = 0;
    o.order_discount_amount = 0;
    o.card_discount_amount = 0;
    o.discount_amount = 96;
    const html = renderInvoiceHtml(
      data,
      'thermal_80mm',
      cfg({ showDiscountTotal: false, showPromoDiscount: true, showCouponDiscount: true }),
    ).html;
    // discount must not vanish — combined line is shown as a fallback
    expect(html).toContain('Discount (SAVE10)');
    expect(html).toContain('96.00');
  });

  it('escapes a malicious currency code', () => {
    const evil = renderInvoiceHtml(
      { ...sampleInvoice(), currency: '<img src=x onerror=alert(1)>' },
      'thermal_80mm',
      DEFAULT_INVOICE_TEMPLATE_CONFIG,
    ).html;
    expect(evil).not.toContain('<img src=x');
    expect(evil).toContain('&lt;img');
  });

  it('hides tax when showTax is off and shows a rate when enabled', () => {
    expect(render({ showTax: false })).not.toContain('>Tax');
    expect(render({ showTax: true, showTaxRate: true })).toContain('(15%)');
  });

  it('hides the logo when showLogo is off', () => {
    expect(render({ showLogo: true, logoUrl: 'https://x/logo.png' })).toContain('logo.png');
    expect(render({ showLogo: false, logoUrl: 'https://x/logo.png' })).not.toContain('logo.png');
  });

  it('respects header and footer text', () => {
    const html = render({ headerText: 'NTN 1234567', footerText: 'No refunds' });
    expect(html).toContain('NTN 1234567');
    expect(html).toContain('No refunds');
  });

  it('renders the tenant currency symbol', () => {
    const usd = renderInvoiceHtml(
      { ...sampleInvoice(), currency: 'USD' },
      'thermal_80mm',
      DEFAULT_INVOICE_TEMPLATE_CONFIG,
    ).html;
    expect(usd).toContain('$');
  });

  it('emits layout-specific paper CSS', () => {
    expect(renderInvoiceHtml(sampleInvoice(), 'thermal_58mm', null).css).toContain('58mm');
    expect(renderInvoiceHtml(sampleInvoice(), 'a4_invoice', null).css).toContain('A4');
  });

  it('shows a gross total for multi-brand groups', () => {
    const data = sampleInvoice();
    data.orders = [data.orders[0], { ...data.orders[0], order_id: 2, brand_name: 'Wok & Go' }];
    data.gross_total = 1984;
    const html = renderInvoiceHtml(data, 'thermal_80mm', DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
    expect(html).toContain('Gross total');
  });
});

describe('conditional meal-drink nesting', () => {
  it('nests a triggered chooser pick under its trigger with upgrade price', () => {
    const data = sampleInvoice();
    data.orders[0].items = [
      {
        name_snapshot: 'Chicken Teriyaki',
        quantity: 1,
        unit_price: 999,
        subtotal: 1379,
        modifiers: [
          { group: 'Make it Meal', name: 'Add a 345ml Drink', unit_price: 130 },
          {
            group: 'Choose your Meal Drink',
            name: 'Raspberry Milkshake',
            unit_price: 250,
            triggered_by: 'Add a 345ml Drink',
          },
        ],
      },
    ];
    const { html } = renderInvoiceHtml(data, 'thermal_80mm', null);
    expect(html).toContain('↳ Raspberry Milkshake');
    expect(html).toContain('sub2');
    // trigger renders before the nested child
    expect(html.indexOf('Add a 345ml Drink')).toBeLessThan(html.indexOf('↳ Raspberry Milkshake'));
  });

  it('shows Included for a free triggered pick and stays flat when trigger absent', () => {
    const data = sampleInvoice();
    data.orders[0].items = [
      {
        name_snapshot: 'Hot Box',
        quantity: 1,
        unit_price: 999,
        subtotal: 1129,
        modifiers: [
          { group: 'Make it Meal', name: 'Add a 345ml Drink', unit_price: 130 },
          { group: 'Choose your Meal Drink', name: 'Sprite 345ml', unit_price: 0, triggered_by: 'Add a 345ml Drink' },
          { group: 'Other', name: 'Orphan', unit_price: 0, triggered_by: 'Missing Trigger' },
        ],
      },
    ];
    const { html } = renderInvoiceHtml(data, 'thermal_80mm', null);
    expect(html).toContain('Included');
    expect(html).toContain('↳ Sprite 345ml');
    // orphan (trigger not on the line) falls back to a flat row, not dropped
    expect(html).toContain('Orphan');
    expect(html).not.toContain('↳ Orphan');
  });
});
