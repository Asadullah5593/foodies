import { describe, it, expect } from 'vitest';
import { renderInvoiceHtml, sampleInvoice, richSampleInvoice } from './renderInvoice';
import { DEFAULT_INVOICE_TEMPLATE_CONFIG, InvoiceTemplateConfig, InvoiceLayout } from './types';

const cfg = (over: Partial<InvoiceTemplateConfig>) => ({
  ...DEFAULT_INVOICE_TEMPLATE_CONFIG,
  ...over,
});
// Default to a row-based layout so item/modifier assertions have sub-rows.
const render = (over: Partial<InvoiceTemplateConfig>, layout: InvoiceLayout = 'thermal_classic') =>
  renderInvoiceHtml(sampleInvoice(), layout, cfg(over)).html;

const ALL_LAYOUTS: InvoiceLayout[] = [
  'bill_bordered',
  'receipt_logo',
  'thermal_modern',
  'thermal_classic',
  'thermal_58mm',
  'a4_invoice',
];

describe('renderInvoiceHtml — field toggles drive output', () => {
  it('shows/hides category', () => {
    expect(render({ showCategory: true })).toContain('Pizza');
    const off = render({ showCategory: false });
    expect(off).not.toContain('class="cat"');
  });

  it('shows/hides "Powered by Rex Technologies"', () => {
    expect(render({ showPoweredBy: true })).toContain('Powered by Rex Technologies');
    expect(render({ showPoweredBy: false })).not.toContain('Powered by Rex Technologies');
  });

  it('itemizes the split only when total is off (no double-count)', () => {
    const both = render({ showDiscountTotal: true, showPromoDiscount: true, showCouponDiscount: true });
    expect(both).toContain('Discount (SAVE10)');
    expect(both).not.toContain('Promotional discount');
    expect(both).not.toContain('Coupon discount');
    const itemized = render({ showDiscountTotal: false, showPromoDiscount: true, showCouponDiscount: true });
    expect(itemized).toContain('Promotional discount');
    expect(itemized).toContain('Coupon discount');
    expect(itemized).not.toContain('Discount (SAVE10)');
  });

  it('falls back to the combined line for older orders with no split', () => {
    const data = sampleInvoice();
    const o = data.orders[0];
    o.promo_discount_amount = 0;
    o.coupon_discount_amount = 0;
    o.order_discount_amount = 0;
    o.card_discount_amount = 0;
    o.discount_amount = 96;
    const html = renderInvoiceHtml(
      data,
      'thermal_classic',
      cfg({ showDiscountTotal: false, showPromoDiscount: true, showCouponDiscount: true }),
    ).html;
    expect(html).toContain('Discount (SAVE10)');
    expect(html).toContain('96.00');
  });

  it('escapes a malicious currency code', () => {
    const evil = renderInvoiceHtml(
      { ...sampleInvoice(), currency: '<img src=x onerror=alert(1)>' },
      'thermal_classic',
      DEFAULT_INVOICE_TEMPLATE_CONFIG,
    ).html;
    expect(evil).not.toContain('<img src=x');
    expect(evil).toContain('&lt;img');
  });

  it('hides tax when showTax is off and shows a rate when enabled', () => {
    expect(render({ showTax: false })).not.toContain('>Tax');
    expect(render({ showTax: true, showTaxRate: true })).toContain('(15%)');
  });

  it('respects header and footer text', () => {
    const html = render({ headerText: 'NTN 1234567', footerText: 'No refunds' });
    expect(html).toContain('NTN 1234567');
    expect(html).toContain('No refunds');
  });

  it('renders the tenant currency symbol', () => {
    const usd = renderInvoiceHtml(
      { ...sampleInvoice(), currency: 'USD' },
      'thermal_classic',
      DEFAULT_INVOICE_TEMPLATE_CONFIG,
    ).html;
    expect(usd).toContain('$');
  });
});

describe('tabular meta — every template renders header details as a table', () => {
  it('emits a <table class="metatbl"> with label/value rows on all layouts', () => {
    for (const layout of ALL_LAYOUTS) {
      const html = renderInvoiceHtml(sampleInvoice(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
      expect(html, layout).toContain('class="metatbl"');
      expect(html, layout).toContain('class="mk"');
      expect(html, layout).toContain('class="mv"');
    }
  });

  it('shows/hides the payment method row', () => {
    expect(render({ showPaymentMethod: true })).toContain('Payment');
    // the sample pays by card
    expect(render({ showPaymentMethod: true })).toContain('Card');
    expect(render({ showPaymentMethod: false })).not.toContain('>Payment<');
  });

  it('does NOT auto-print branch address/phone; header text drives that area', () => {
    // pre-filled branch details must NOT appear by default
    const bare = render({});
    expect(bare).not.toContain('123 Food Street, Lahore');
    expect(bare).not.toContain('Ph: +92 300 1234567');
    // whatever the admin types in Header Text shows under the name
    const withHeader = render({ headerText: 'Shop 5, Mall Road\nPh: 042-111-222' });
    expect(withHeader).toContain('Shop 5, Mall Road');
    expect(withHeader).toContain('042-111-222');
  });

  it('order note renders below the items, never in the top meta table', () => {
    for (const layout of ALL_LAYOUTS) {
      const html = renderInvoiceHtml(richSampleInvoice(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
      expect(html, layout).toContain('Birthday'); // the order note is present…
      // …and it appears AFTER the meta table, not inside it
      expect(html.indexOf('Birthday'), layout).toBeGreaterThan(html.indexOf('class="metatbl"'));
      expect(html, layout).not.toContain('<td class="mk">Note</td>');
    }
  });
});

describe('invoice number — shown beneath the order number on every template', () => {
  it('renders the invoice number on all layouts', () => {
    for (const layout of ALL_LAYOUTS) {
      const html = renderInvoiceHtml(richSampleInvoice(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
      expect(html, layout).toContain('014'); // order number
      expect(html, layout).toContain('BR-1-10-20260709-0481'); // invoice number
      // invoice number comes AFTER the order number (beneath it)
      expect(html.indexOf('BR-1-10-20260709-0481'), layout).toBeGreaterThan(html.indexOf('014'));
    }
  });

  it('honors the showInvoiceNumber toggle', () => {
    const off = renderInvoiceHtml(richSampleInvoice(), 'bill_bordered', cfg({ showInvoiceNumber: false })).html;
    expect(off).not.toContain('BR-1-10-20260709-0481');
    expect(off).not.toContain('Invoice #'); // label absent too
  });
});

describe('typography controls', () => {
  it('font size scales the root px', () => {
    const at100 = renderInvoiceHtml(sampleInvoice(), 'bill_bordered', cfg({ fontScalePct: 100 })).css;
    const at150 = renderInvoiceHtml(sampleInvoice(), 'bill_bordered', cfg({ fontScalePct: 150 })).css;
    expect(at100).toContain('font-size: 11px'); // base
    expect(at150).toContain('font-size: 16.5px'); // 11 * 1.5
  });

  it('clamps font size to 50–200%', () => {
    const css = renderInvoiceHtml(sampleInvoice(), 'bill_bordered', cfg({ fontScalePct: 999 })).css;
    expect(css).toContain('font-size: 22px'); // 11 * 2.0 (clamped)
  });

  it('powered-by has its own size and weight', () => {
    const css = renderInvoiceHtml(sampleInvoice(), 'thermal_classic', cfg({ poweredByFontPct: 120, poweredByBold: true })).css;
    // thermal_classic base 12px * 1.2 = 14.4px, bold 700
    expect(css).toContain('.inv-root .powered');
    expect(css).toContain('14.4px');
    expect(css).toContain('font-weight: 700');
  });
});

describe('layout-specific chrome', () => {
  it('bill_bordered: bordered items table + Grand Total', () => {
    const { html, css } = renderInvoiceHtml(sampleInvoice(), 'bill_bordered', DEFAULT_INVOICE_TEMPLATE_CONFIG);
    expect(html).toContain('Item Name');
    expect(html).toContain('Grand Total');
    expect(css).toContain('.inv-bill_bordered .itbl th');
    expect(css).toContain('80mm');
  });

  it('receipt_logo: big Order # band + Product column; band replaces order no in the meta table', () => {
    const { html } = renderInvoiceHtml(sampleInvoice(), 'receipt_logo', DEFAULT_INVOICE_TEMPLATE_CONFIG);
    expect(html).toContain('Order # BR-1-000123');
    expect(html).toContain('Product');
    expect(html).toContain('class="orderband"');
    // order number lives in the band, so the meta table must not repeat "Order #"
    expect(html).not.toContain('<td class="mk">Order #</td>');
  });

  it('thermal_modern: uppercase section label + 80mm paper', () => {
    const { html, css } = renderInvoiceHtml(sampleInvoice(), 'thermal_modern', DEFAULT_INVOICE_TEMPLATE_CONFIG);
    expect(html).toContain('class="seclabel"');
    expect(css).toContain('.inv-thermal_modern');
    expect(css).toContain('80mm');
  });

  it('thermal_classic: monospace face + TOTAL in caps', () => {
    const { html, css } = renderInvoiceHtml(sampleInvoice(), 'thermal_classic', DEFAULT_INVOICE_TEMPLATE_CONFIG);
    expect(html).toContain('TOTAL');
    expect(css).toContain("'Courier New'");
  });

  it('emits layout-specific paper CSS', () => {
    expect(renderInvoiceHtml(sampleInvoice(), 'thermal_58mm', null).css).toContain('58mm');
    expect(renderInvoiceHtml(sampleInvoice(), 'a4_invoice', null).css).toContain('A4');
  });

  it('shows a gross total for multi-brand groups', () => {
    const data = sampleInvoice();
    data.orders = [data.orders[0], { ...data.orders[0], order_id: 2, brand_name: 'Wok & Go' }];
    data.gross_total = 1984;
    const html = renderInvoiceHtml(data, 'bill_bordered', DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
    expect(html).toContain('Gross total');
  });
});

describe('brand logo — every brand prints its own, Foodies is the fallback', () => {
  it('falls back to the Foodies umbrella logo when the brand has none', () => {
    for (const layout of ALL_LAYOUTS) {
      expect(renderInvoiceHtml(sampleInvoice(), layout, null).html, layout).toContain('foodies-logo.png');
    }
  });

  it("uses the order's own brand logo when present (no template override exists)", () => {
    const data = sampleInvoice();
    data.orders[0].brand_logo_url = 'https://cdn/brand-x.png';
    const brand = renderInvoiceHtml(data, 'receipt_logo', null).html;
    expect(brand).toContain('brand-x.png');
    expect(brand).not.toContain('foodies-logo.png');
  });

  it('hides the logo entirely when showLogo is off', () => {
    const data = sampleInvoice();
    data.orders[0].brand_logo_url = 'https://cdn/brand-x.png';
    const html = renderInvoiceHtml(data, 'receipt_logo', cfg({ showLogo: false })).html;
    expect(html).not.toContain('brand-x.png');
    expect(html).not.toContain('foodies-logo.png');
  });

  it('multi-brand groups: umbrella logo in the header, per-brand logos per section', () => {
    const data = sampleInvoice();
    data.orders = [
      { ...data.orders[0], brand_logo_url: 'https://cdn/fireaway.png' },
      { ...data.orders[0], order_id: 2, brand_name: 'Wok & Go', brand_logo_url: 'https://cdn/wokgo.png' },
    ];
    const html = renderInvoiceHtml(data, 'bill_bordered', null).html;
    expect(html).toContain('foodies-logo.png'); // header umbrella
    expect(html).toContain('fireaway.png'); // per-order brand blocks
    expect(html).toContain('wokgo.png');
    expect(html).toContain('class="brandlogo"');
  });
});

describe('rich sample exercises every renderable field', () => {
  it('renders variants, add-ons, modifiers, a deal, notes, discounts and loyalty', () => {
    // itemize discounts so all four stages show (the seeded configs do this)
    const config = cfg({
      showDiscountTotal: false,
      showPromoDiscount: true,
      showOrderDiscount: true,
      showCouponDiscount: true,
      showCardDiscount: true,
      showCashier: true,
      showTaxRate: true,
    });
    const { html } = renderInvoiceHtml(richSampleInvoice(), 'thermal_modern', config);
    expect(html).toContain('Large 13'); // variant (the " is HTML-escaped)
    expect(html).toContain('Garlic Dip'); // add-on
    expect(html).toContain('Grilled Chicken'); // modifier
    expect(html).toContain('↳ Mint Margarita'); // conditional nested pick
    expect(html).toContain('Family Feast Deal'); // deal group
    expect(html).toContain('Large Pepperoni Pizza'); // deal component
    expect(html).toContain('Well done, extra crispy'); // item note
    expect(html).toContain('Birthday'); // order note
    expect(html).toContain('Promotional discount'); // all four discount stages
    expect(html).toContain('Order discount');
    expect(html).toContain('Coupon discount');
    expect(html).toContain('Card discount');
    expect(html).toContain('Service charge');
    expect(html).toContain('Points earned');
    expect(html).toContain('Points redeemed');
    expect(html).toContain('Cash + Card'); // payment method, title-cased
  });

  it('renders without error across every layout', () => {
    for (const layout of ALL_LAYOUTS) {
      const { html } = renderInvoiceHtml(richSampleInvoice(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG);
      expect(html, layout).toContain('Family Feast Deal');
      expect(html, layout).toContain('Fireaway');
    }
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
    const { html } = renderInvoiceHtml(data, 'thermal_modern', null);
    expect(html).toContain('↳ Raspberry Milkshake');
    expect(html).toContain('sub2');
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
    const { html } = renderInvoiceHtml(data, 'thermal_modern', null);
    expect(html).toContain('Included');
    expect(html).toContain('↳ Sprite 345ml');
    expect(html).toContain('Orphan');
    expect(html).not.toContain('↳ Orphan');
  });
});
