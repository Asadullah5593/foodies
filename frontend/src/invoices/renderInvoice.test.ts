import { describe, it, expect } from 'vitest';
import { renderInvoiceHtml, sampleInvoice, richSampleInvoice } from './renderInvoice';
import {
  DEFAULT_INVOICE_TEMPLATE_CONFIG,
  InvoiceTemplateConfig,
  InvoiceLayout,
  InvoiceLineVM,
} from './types';

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
  'receipt_bordered_logo',
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

  // Notes are opt-in: nothing note-related prints under the default config, so
  // existing receipts are unchanged until an admin turns a note toggle on.
  it('prints no notes under the default config', () => {
    for (const layout of ALL_LAYOUTS) {
      const html = renderInvoiceHtml(richSampleInvoice(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
      expect(html, layout).not.toContain('Birthday'); // order note
      expect(html, layout).not.toContain('Well done, extra crispy'); // item note
      expect(html, layout).not.toContain('Note:');
      expect(html, layout).not.toContain('ordernote');
    }
  });

  it('prints the item note under its line when showLineNotes is on', () => {
    for (const layout of ['thermal_classic', 'bill_bordered'] as const) {
      const html = renderInvoiceHtml(richSampleInvoice(), layout, cfg({ showLineNotes: true })).html;
      expect(html, layout).toContain('Note: Well done, extra crispy');
    }
  });

  it('prints the order note where the items end, just before the totals', () => {
    for (const layout of ['thermal_classic', 'bill_bordered'] as const) {
      const html = renderInvoiceHtml(richSampleInvoice(), layout, cfg({ showOrderNotes: true })).html;
      expect(html, layout).toContain('Note: Birthday — please add candles');
      // It closes the items, above the totals — not up in the header meta table.
      const notePos = html.indexOf('Birthday');
      const subtotalPos = html.indexOf('Subtotal');
      expect(notePos, layout).toBeGreaterThan(-1);
      expect(notePos, layout).toBeLessThan(subtotalPos);
      // And it is NOT a header/meta row.
      expect(html, layout).not.toMatch(/<td class="mk">Note<\/td>/);
    }
  });

  it('keeps the note toggles independent — one on does not pull in the other', () => {
    const lineOnly = renderInvoiceHtml(richSampleInvoice(), 'bill_bordered', cfg({ showLineNotes: true })).html;
    expect(lineOnly).toContain('Well done, extra crispy');
    expect(lineOnly).not.toContain('Birthday');
    const orderOnly = renderInvoiceHtml(richSampleInvoice(), 'bill_bordered', cfg({ showOrderNotes: true })).html;
    expect(orderOnly).toContain('Birthday');
    expect(orderOnly).not.toContain('Well done, extra crispy');
  });

  it('drops the modifier group name when showModifierGroup is off', () => {
    for (const layout of ['thermal_classic', 'bill_bordered'] as const) {
      const on = renderInvoiceHtml(richSampleInvoice(), layout, cfg({ showModifierGroup: true })).html;
      expect(on, layout).toContain('Base: Classic Hand-Tossed'); // default look

      const off = renderInvoiceHtml(richSampleInvoice(), layout, cfg({ showModifierGroup: false })).html;
      expect(off, layout).toContain('Classic Hand-Tossed');
      expect(off, layout).not.toContain('Base:');
    }
  });

  it('drops the leading "+" on modifiers and add-ons when showModifierPlus is off', () => {
    for (const layout of ['thermal_classic', 'bill_bordered'] as const) {
      const on = renderInvoiceHtml(richSampleInvoice(), layout, cfg({ showModifierPlus: true })).html;
      expect(on, layout).toContain('+ Base: Classic Hand-Tossed'); // default look

      const off = renderInvoiceHtml(richSampleInvoice(), layout, cfg({ showModifierPlus: false })).html;
      expect(off, layout).toContain('Base: Classic Hand-Tossed');
      expect(off, layout).not.toContain('+ Base:');
    }
  });

  it('prints a dine-in customer by name only — they are at the table', () => {
    for (const layout of ALL_LAYOUTS) {
      const html = renderInvoiceHtml(richSampleInvoice(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
      expect(html, layout).toContain('Ayesha Malik');
      expect(html, layout).not.toContain('7654321');
    }
  });

  it('drops the Customer row entirely when a dine-in order has only a phone', () => {
    const data = richSampleInvoice();
    data.orders[0].customer_name = undefined;
    const html = renderInvoiceHtml(data, 'bill_bordered', DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
    expect(html).not.toContain('Customer');
    expect(html).not.toContain('7654321');
  });

  // Takeaway and delivery orders may have to be called about, so the phone goes
  // beside the name on those receipts (and only those).
  for (const type of ['takeaway', 'delivery'] as const) {
    it(`prints the phone beside the name on a ${type} receipt, on every template`, () => {
      for (const layout of ALL_LAYOUTS) {
        const data = richSampleInvoice();
        data.orders[0].order_type = type;
        const html = renderInvoiceHtml(data, layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
        expect(html, layout).toContain('Ayesha Malik · +92 301 7654321');
      }
    });
  }

  it('prints the phone alone on a takeaway order taken without a name', () => {
    const data = richSampleInvoice();
    data.orders[0].order_type = 'takeaway';
    data.orders[0].customer_name = undefined;
    const html = renderInvoiceHtml(data, 'bill_bordered', DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
    expect(html).toContain('Customer');
    expect(html).toContain('+92 301 7654321');
  });

  it('keeps a takeaway receipt name-only when no phone was taken', () => {
    const data = richSampleInvoice();
    data.orders[0].order_type = 'takeaway';
    data.orders[0].customer_phone = undefined;
    const html = renderInvoiceHtml(data, 'bill_bordered', DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
    expect(html).toContain('Ayesha Malik');
    expect(html).not.toContain('·');
  });

  it('honours showCustomerInfo: a delivery phone is hidden with the customer row', () => {
    const data = richSampleInvoice();
    data.orders[0].order_type = 'delivery';
    const html = renderInvoiceHtml(data, 'bill_bordered', cfg({ showCustomerInfo: false })).html;
    expect(html).not.toContain('Ayesha Malik');
    expect(html).not.toContain('7654321');
  });

  it('shows no business or brand name at the top — the logo identifies the brand', () => {
    for (const layout of ALL_LAYOUTS) {
      const html = renderInvoiceHtml(sampleInvoice(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
      expect(html, layout).not.toContain('class="biz"');
    }
  });
});

describe('app-download QR', () => {
  const QR_LAYOUTS: InvoiceLayout[] = ['thermal_classic', 'bill_bordered', 'receipt_logo'];

  it('is hidden by default', () => {
    for (const layout of QR_LAYOUTS) {
      const html = renderInvoiceHtml(sampleInvoice(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
      expect(html, layout).not.toContain('qrblock');
      expect(html, layout).not.toContain('Scan to download');
    }
  });

  it('shows the QR and its text when turned on, on every layout', () => {
    for (const layout of QR_LAYOUTS) {
      const html = render({ showAppQr: true }, layout);
      expect(html, layout).toContain('class="qrblock"');
      expect(html, layout).toContain('Scan to download the Foodies app');
      // The embedded QR matrix (29×29 modules — same code the consumer site shows).
      expect(html, layout).toContain('viewBox="0 0 29 29"');
    }
  });

  it('sits above the footer, not below it', () => {
    const html = render({ showAppQr: true, footerText: 'Thank you!' });
    expect(html.indexOf('qrblock')).toBeGreaterThan(-1);
    expect(html.indexOf('qrblock')).toBeLessThan(html.indexOf('class="foot"'));
  });

  it('uses the custom left text, and shows the QR alone when the text is cleared', () => {
    expect(render({ showAppQr: true, appQrText: 'Get 10% off in the app' })).toContain('Get 10% off in the app');
    const noText = render({ showAppQr: true, appQrText: null });
    expect(noText).toContain('class="qrblock"');
    expect(noText).toContain('viewBox="0 0 29 29"');
    expect(noText).not.toContain('Scan to download');
  });

  it('styles the prompt text exactly like the info-box value column by default', () => {
    // Same black + weight 600 + info-box value size the meta labels resolve to.
    const { css } = renderInvoiceHtml(sampleInvoice(), 'thermal_classic', cfg({ showAppQr: true }));
    const metaLabel = css.match(/\.inv-root \.metatbl \.mk \{[^}]*font-size: ([\d.]+)px/);
    const qrText = css.match(/\.inv-root \.qrblock \.qr-text \{ color: #000; font-weight: 600; font-size: ([\d.]+)px/);
    expect(qrText, 'qr-text rule present').not.toBeNull();
    // Info-box value column is weight 600 at that size; QR text matches it.
    expect(qrText![1]).toBe(metaLabel![1]);
  });

  it('applies the appQrTextFontWeight / appQrTextFontPct overrides to the prompt text only', () => {
    const { css } = renderInvoiceHtml(
      sampleInvoice(),
      'thermal_classic',
      cfg({ showAppQr: true, appQrTextFontWeight: 800, appQrTextFontPct: 150 }),
    );
    const metaLabel = css.match(/\.inv-root \.metatbl \.mk \{[^}]*font-size: ([\d.]+)px/);
    const qrText = css.match(/\.inv-root \.qrblock \.qr-text \{ color: #000; font-weight: 800; font-size: ([\d.]+)px/);
    expect(qrText, 'overridden qr-text rule present').not.toBeNull();
    // 150% of the info-box value size, while the meta labels keep theirs.
    expect(Number(qrText![1])).toBeCloseTo(Number(metaLabel![1]) * 1.5, 1);
    expect(css).toContain('.inv-root .metatbl .mk { color: #000; font-weight: 600;');
  });
});

describe('invoice number — shown beneath the order number on every template', () => {
  it('renders the invoice number on all layouts', () => {
    for (const layout of ALL_LAYOUTS) {
      const html = renderInvoiceHtml(richSampleInvoice(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
      expect(html, layout).toContain('014'); // order number
      expect(html, layout).toContain('FDS-A7K2M9QX'); // invoice number
      // invoice number comes AFTER the order number (beneath it)
      expect(html.indexOf('FDS-A7K2M9QX'), layout).toBeGreaterThan(html.indexOf('014'));
    }
  });

  it('honors the showInvoiceNumber toggle', () => {
    // The FBR fiscal block has its own "FBR Invoice #" label and its own toggle;
    // turn it off so this asserts only the meta-box invoice number line.
    const off = renderInvoiceHtml(
      richSampleInvoice(),
      'bill_bordered',
      cfg({ showInvoiceNumber: false, showFbrInvoice: false }),
    ).html;
    expect(off).not.toContain('FDS-A7K2M9QX');
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
    expect(html).toContain('Order # 023');
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
  it('renders variants, add-ons, modifiers, a deal, discounts and loyalty', () => {
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
      // The brand is identified by its logo — the name line is gone.
      expect(html, layout).toContain('class="logo"');
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

  it('prices a free triggered pick at zero and stays flat when trigger absent', () => {
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
    // Free picks print 0.00 rather than the word "Included".
    expect(html).not.toContain('Included');
    expect(html).toContain('Rs. 0.00');
    expect(html).toContain('↳ Sprite 345ml');
    expect(html).toContain('Orphan');
    expect(html).not.toContain('↳ Orphan');
  });
});

describe('free lines print zero, never a blank or a dash', () => {
  const lineWith = (modifiers: NonNullable<InvoiceLineVM['modifiers']>) => {
    const data = sampleInvoice();
    data.orders[0].items = [
      { name_snapshot: 'Hot Box', quantity: 1, unit_price: 999, subtotal: 999, modifiers },
    ];
    return data;
  };

  it('gives a free top-level modifier a zero Rate and Amount, not an empty cell', () => {
    const data = lineWith([{ group: 'Base', name: 'Classic Hand-Tossed', unit_price: 0 }]);
    const { html } = renderInvoiceHtml(data, 'bill_bordered', null);
    const row = html.slice(html.indexOf('Classic Hand-Tossed'));
    const cells = row.slice(0, row.indexOf('</tr>'));
    // Qty 1, Rate 0.00, Amount 0.00 — every column populated.
    expect(cells).toContain('<td class="cq">1</td>');
    expect(cells).toContain('<td class="cr">0.00</td>');
    expect(cells).toContain('<td class="ca">0.00</td>');
  });

  it('prices a deal component at zero instead of an em-dash', () => {
    const { html } = renderInvoiceHtml(richSampleInvoice(), 'bill_bordered', null);
    const deal = html.slice(html.indexOf('Large Pepperoni Pizza'));
    const cells = deal.slice(0, deal.indexOf('</tr>'));
    expect(cells).not.toContain('—');
    expect(cells).toContain('0.00');
  });

  it('bills only the units beyond the group allowance (first-N-free)', () => {
    // Picked 3×, 1 included by the group => 2 charged at 120 = 240.
    const data = lineWith([
      { group: 'Extra Toppings', name: 'Jalapeños', unit_price: 120, quantity: 3, free_quantity: 1 },
    ]);
    const { html } = renderInvoiceHtml(data, 'bill_bordered', null);
    const row = html.slice(html.indexOf('Jalapeños'));
    const cells = row.slice(0, row.indexOf('</tr>'));
    expect(cells).toContain('<td class="cq">3</td>');
    expect(cells).toContain('<td class="cr">120.00</td>');
    expect(cells).toContain('<td class="ca">240.00</td>');
  });

  it('zeroes a modifier whose every unit is included by the allowance', () => {
    const data = lineWith([
      { group: 'Extra Toppings', name: 'Olives', unit_price: 120, quantity: 2, free_quantity: 2 },
    ]);
    const { html } = renderInvoiceHtml(data, 'bill_bordered', null);
    const row = html.slice(html.indexOf('Olives'));
    const cells = row.slice(0, row.indexOf('</tr>'));
    expect(cells).toContain('<td class="ca">0.00</td>');
  });

  it('falls back to a single billed unit when the payload omits quantity', () => {
    const data = lineWith([{ group: 'Extra Toppings', name: 'Feta', unit_price: 90 }]);
    const { html } = renderInvoiceHtml(data, 'bill_bordered', null);
    const row = html.slice(html.indexOf('Feta'));
    const cells = row.slice(0, row.indexOf('</tr>'));
    expect(cells).toContain('<td class="cq">1</td>');
    expect(cells).toContain('<td class="ca">90.00</td>');
  });
});

describe('host print CSS cannot steal a table border', () => {
  // utils/print.ts writes `th, td { border-bottom: 1px solid #f3f4f6 }` into the
  // print popup. Under border-collapse a cell border outranks the table's own, so
  // without a reset the boxed meta block lost its bottom edge to a near-white line
  // that no thermal printer renders.
  it.each(['bill_bordered', 'receipt_bordered_logo'] as const)(
    'neutralises bare th/td styling for %s while keeping the box',
    (layout) => {
      const { css } = renderInvoiceHtml(richSampleInvoice(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG);
      expect(css).toContain('.inv-root th, .inv-root td { border: 0; color: inherit; }');
      // The reset must not disarm the layout's own bordered meta box.
      expect(css).toContain(`.inv-root.inv-${layout} .metatbl { border: 1px solid #000`);
      // The reset is in the shared base, so it precedes the layout's border rules.
      expect(css.indexOf('.inv-root th, .inv-root td { border: 0')).toBeLessThan(
        css.indexOf(`.inv-root.inv-${layout} .metatbl { border: 1px solid #000`),
      );
    },
  );
});

describe('Bordered Logo Receipt layout', () => {
  it("uses Bordered Bill's meta box with Logo Receipt's table labels and totals", () => {
    const { html, css } = renderInvoiceHtml(
      richSampleInvoice(),
      'receipt_bordered_logo',
      DEFAULT_INVOICE_TEMPLATE_CONFIG,
    );
    // Logo Receipt's column labels, not Bordered Bill's "Item Name"/"Amount".
    expect(html).toContain('Product');
    expect(html).toContain('Total');
    expect(html).not.toContain('Item Name');
    // Bordered Bill's boxed meta block.
    expect(css).toContain('.inv-root.inv-receipt_bordered_logo .metatbl { border: 1px solid #000');
    // Logo Receipt's dash-framed grand total.
    expect(css).toContain('.inv-root.inv-receipt_bordered_logo .row.grand { border-top: 1px dashed');
  });

  it("drops Logo Receipt's duplicate Order # band, since the meta box carries it", () => {
    const { html } = renderInvoiceHtml(
      richSampleInvoice(),
      'receipt_bordered_logo',
      DEFAULT_INVOICE_TEMPLATE_CONFIG,
    );
    expect(html).not.toContain('orderband');
    expect(html).toContain('metatbl');
  });
});

describe('info-box / footer / loyalty typography', () => {
  const cssOf = (over: Partial<InvoiceTemplateConfig>, layout: InvoiceLayout = 'thermal_modern') =>
    renderInvoiceHtml(sampleInvoice(), layout, cfg(over)).css;

  it('headings default to EXACTLY the value column: weight 600, same size, full black', () => {
    const css = cssOf({});
    // thermal_modern root is 11px → info-box (.84em) is 9.24px for values and headings alike.
    expect(css).toContain('.inv-root .metatbl .mk { color: #000; font-weight: 600; font-size: 9.24px; }');
    expect(css).toContain('.inv-root .foot .line { color: #000; font-weight: 600; font-size: 9.24px; }');
    expect(css).toContain('.inv-root .loyalty { color: #000; font-weight: 600; font-size: 9.24px; }');
    // Appended AFTER thermal_modern's own ".mk { … font-weight: 400 }" reset so it wins.
    expect(css.indexOf('.inv-root .metatbl .mk { color: #000;')).toBeGreaterThan(
      css.indexOf('.inv-root.inv-thermal_modern .metatbl .mk'),
    );
  });

  it('discount lines default to black, matching the info-box value column (no green)', () => {
    const css = cssOf({});
    expect(css).toContain(
      '.inv-root .row.disc, .inv-root .row.disc .l, .inv-root .row.disc .r { color: #000; font-weight: 600; font-size: 9.24px; }',
    );
    // The old green accent is gone entirely.
    expect(css).not.toContain('#067647');
  });

  it('manual weight and size adjust from the matched default', () => {
    const css = cssOf({ metaLabelsFontWeight: 400, metaLabelsFontPct: 150, footerFontWeight: 800, discountFontWeight: 700 });
    expect(css).toContain('.inv-root .metatbl .mk { color: #000; font-weight: 400; font-size: 13.86px; }');
    expect(css).toContain('.inv-root .foot .line { color: #000; font-weight: 800; font-size: 9.24px; }');
    expect(css).toContain(
      '.inv-root .row.disc, .inv-root .row.disc .l, .inv-root .row.disc .r { color: #000; font-weight: 700; font-size: 9.24px; }',
    );
  });

  it('typography sizes ride the whole-receipt font scale', () => {
    // 200% scale → root 22px → info box 18.48px.
    expect(cssOf({ fontScalePct: 200 })).toContain(
      '.inv-root .metatbl .mk { color: #000; font-weight: 600; font-size: 18.48px; }',
    );
  });
});

describe('zeroAmountDisplay — 0 / Included / empty for zero-billing lines', () => {
  // sampleInvoice has a zero-priced modifier (Pesto Base); richSampleInvoice
  // adds zero-priced deal components (Garlic Bread etc.).
  it("'zero' keeps printing 0.00 (default, unchanged behavior)", () => {
    const html = render({ zeroAmountDisplay: 'zero' });
    expect(html).toContain('Pesto Base');
    expect(html).toContain('Rs. 0.00');
    expect(html).not.toContain('Included');
  });

  it("'included' prints the word Included on row layouts", () => {
    const html = render({ zeroAmountDisplay: 'included' });
    expect(html).toContain('Included');
    expect(html).not.toContain('Rs. 0.00');
  });

  it("'blank' leaves the amount empty", () => {
    const html = render({ zeroAmountDisplay: 'blank' });
    expect(html).not.toContain('Rs. 0.00');
    expect(html).not.toContain('Included');
  });

  it('applies to zero-priced deal components in table layouts', () => {
    const html = renderInvoiceHtml(
      richSampleInvoice(),
      'bill_bordered',
      cfg({ zeroAmountDisplay: 'included' }),
    ).html;
    // Component amount cells read Included; the priced deal header keeps its number.
    expect(html).toContain('<td class="ca">Included</td>');
    expect(html).toContain('2999.00');
  });

  it('rate cells of zero-priced lines hide in included/blank modes and print in 0.00 mode', () => {
    const table = (over: Partial<InvoiceTemplateConfig>) =>
      renderInvoiceHtml(richSampleInvoice(), 'bill_bordered', cfg(over)).html;
    // Zero-priced modifiers (Classic Hand-Tossed) put 0.00 in the rate column…
    expect(table({ zeroAmountDisplay: 'zero' })).toContain('<td class="cr">0.00</td>');
    // …but the rate hides when zero amounts are Included/blank.
    expect(table({ zeroAmountDisplay: 'included' })).not.toContain('<td class="cr">0.00</td>');
    expect(table({ zeroAmountDisplay: 'blank' })).not.toContain('<td class="cr">0.00</td>');
    expect(table({ zeroAmountDisplay: 'blank' })).toContain('<td class="cr"></td>');
    // A line that BILLS something keeps its rate: Jalapeños ×2 with 1 free bills
    // 120, so 120.00 prints even in Included mode.
    expect(table({ zeroAmountDisplay: 'included' })).toContain('<td class="cr">120.00</td>');
  });

  it('hides the rate too when a line bills zero by allowance (real unit price, zero amount)', () => {
    // A topping with a real 149 unit price, fully covered by the group's
    // included allowance (qty 1, free 1) → bills 0. Mirrors the KOT toppings.
    const data = sampleInvoice();
    data.orders[0].items = [
      {
        name_snapshot: 'Build Your Own Pizza',
        category: 'Pizza',
        quantity: 1,
        unit_price: 1449,
        subtotal: 1449,
        modifiers: [
          { group: 'Meat', name: 'Beef Pepperoni', unit_price: 149, quantity: 1, free_quantity: 1 },
        ],
      },
    ];
    const table = (over: Partial<InvoiceTemplateConfig>) =>
      renderInvoiceHtml(data, 'bill_bordered', cfg(over)).html;
    // 'zero' keeps the informative rate (149.00) next to a 0.00 amount.
    expect(table({ zeroAmountDisplay: 'zero' })).toContain('<td class="cr">149.00</td>');
    // 'blank'/'included' hide the rate too — the kitchen line is name + qty only.
    const blank = table({ zeroAmountDisplay: 'blank' });
    expect(blank).toContain('Beef Pepperoni');
    expect(blank).not.toContain('<td class="cr">149.00</td>');
    expect(table({ zeroAmountDisplay: 'included' })).not.toContain('<td class="cr">149.00</td>');
  });

  it('does not touch paid modifier amounts', () => {
    const html = renderInvoiceHtml(
      richSampleInvoice(),
      'thermal_classic',
      cfg({ zeroAmountDisplay: 'blank' }),
    ).html;
    // Grilled Chicken bills 250 and must still print.
    expect(html).toContain('Rs. 250.00');
  });
});

describe('showFreeItems — zero-priced lines print in a Free items section, or not at all', () => {
  it('prints free lines under a Free items heading by default (on)', () => {
    const html = renderInvoiceHtml(richSampleInvoice(), 'thermal_classic', cfg({})).html;
    expect(html).toContain('Free items');
    // Free deal components list flat in the free section…
    const freeAt = html.indexOf('Free items');
    expect(html.indexOf('Garlic Bread')).toBeGreaterThan(freeAt);
    expect(html.indexOf('1.5L Soft Drink')).toBeGreaterThan(freeAt);
    // …while paid lines stay above it.
    expect(html.indexOf('Peri Peri Wings')).toBeLessThan(freeAt);
    expect(html.indexOf('Family Feast Deal')).toBeLessThan(freeAt);
  });

  it('off = zero-value lines are omitted from the receipt entirely', () => {
    const html = renderInvoiceHtml(
      richSampleInvoice(),
      'thermal_classic',
      cfg({ showFreeItems: false }),
    ).html;
    expect(html).not.toContain('Free items');
    expect(html).not.toContain('Garlic Bread');
    expect(html).not.toContain('1.5L Soft Drink');
    // Zero-billing modifiers are free lines too — hidden with the same toggle.
    expect(html).not.toContain('Classic Hand-Tossed');
    expect(html).not.toContain('Smoky BBQ');
    // The deal's priced header, paid items and paid modifiers still print —
    // including Jalapeños, which bills 1 unit despite its included allowance.
    expect(html).toContain('Family Feast Deal');
    expect(html).toContain('Peri Peri Wings');
    expect(html).toContain('Grilled Chicken');
    expect(html).toContain('Jalapeños');
    expect(html).toContain('Mint Margarita');
  });

  it('off hides zero-billing modifiers in table layouts too', () => {
    const html = renderInvoiceHtml(
      richSampleInvoice(),
      'bill_bordered',
      cfg({ showFreeItems: false }),
    ).html;
    expect(html).not.toContain('Classic Hand-Tossed');
    expect(html).toContain('Grilled Chicken');
  });

  it('off omits them from table layouts too', () => {
    const html = renderInvoiceHtml(
      richSampleInvoice(),
      'bill_bordered',
      cfg({ showFreeItems: false }),
    ).html;
    expect(html).not.toContain('class="freehead"');
    expect(html).not.toContain('Garlic Bread');
    expect(html).toContain('Family Feast Deal');
  });

  it('renders the Free items header row in table layouts when on', () => {
    const html = renderInvoiceHtml(
      richSampleInvoice(),
      'bill_bordered',
      cfg({ showFreeItems: true }),
    ).html;
    expect(html).toContain('class="freehead"');
    expect(html).toContain('Free items');
  });

  it('shows no Free items section when every line is paid', () => {
    const html = renderInvoiceHtml(
      sampleInvoice(),
      'thermal_classic',
      cfg({ showFreeItems: true }),
    ).html;
    expect(html).not.toContain('Free items');
  });
});

describe('FBR fiscal block — number line, logo left, QR right, below the app QR', () => {
  const FBR_NUM = '515011DDD1287011250929';
  const withFbr = () => {
    const data = sampleInvoice();
    data.orders[0].fbr_invoice_number = FBR_NUM;
    data.orders[0].fbr_number_source = 'fbr';
    return data;
  };

  it('renders on every layout when the order carries an FBR number', () => {
    for (const layout of ALL_LAYOUTS) {
      const html = renderInvoiceHtml(withFbr(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
      expect(html, layout).toContain('class="fbrblock"');
      expect(html, layout).toContain('FBR Invoice #');
      expect(html, layout).toContain(FBR_NUM);
      expect(html, layout).toContain('class="fbr-logo"');
      expect(html, layout).toContain('class="fbr-qr"');
    }
  });

  it('is omitted entirely when the order has no FBR number', () => {
    const html = renderInvoiceHtml(sampleInvoice(), 'thermal_classic', DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
    expect(html).not.toContain('fbrblock');
    expect(html).not.toContain('FBR Invoice #');
  });

  it('honors the showFbrInvoice toggle', () => {
    const off = renderInvoiceHtml(withFbr(), 'thermal_classic', cfg({ showFbrInvoice: false })).html;
    expect(off).not.toContain('fbrblock');
    expect(off).not.toContain(FBR_NUM);
  });

  it('sits below the app-QR block and above the footer', () => {
    const html = renderInvoiceHtml(withFbr(), 'thermal_classic', cfg({ showAppQr: true })).html;
    expect(html.indexOf('fbrblock')).toBeGreaterThan(html.indexOf('qrblock'));
    expect(html.indexOf('fbrblock')).toBeLessThan(html.indexOf('class="foot"'));
  });

  it('a fallback-sourced number prints exactly like a real one', () => {
    const data = withFbr();
    data.orders[0].fbr_number_source = 'fallback';
    const html = renderInvoiceHtml(data, 'thermal_classic', DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
    expect(html).toContain(FBR_NUM);
    expect(html).not.toContain('fallback'); // never leaks onto the receipt
  });

  it('embeds a generated SVG QR for the fiscal number', () => {
    const html = renderInvoiceHtml(withFbr(), 'thermal_classic', DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
    const qrIdx = html.indexOf('class="fbr-qr"');
    expect(qrIdx).toBeGreaterThan(-1);
    expect(html.slice(qrIdx, qrIdx + 300)).toContain('<svg');
  });

  it('prints the invoice-number line BELOW the logo + QR row, not above', () => {
    for (const layout of ALL_LAYOUTS) {
      const html = renderInvoiceHtml(withFbr(), layout, DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
      // The logo/QR row (fbr-row) comes first; the "FBR Invoice #" head after it.
      expect(html.indexOf('class="fbr-row"'), layout).toBeLessThan(html.indexOf('class="fbr-head"'));
      expect(html.indexOf('class="fbr-logo"'), layout).toBeLessThan(html.indexOf('FBR Invoice #'));
      expect(html.indexOf('class="fbr-qr"'), layout).toBeLessThan(html.indexOf('FBR Invoice #'));
    }
  });

  it('uses the bundled PRA logo by default and a custom logo when configured', () => {
    const def = renderInvoiceHtml(withFbr(), 'thermal_classic', DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
    expect(def).toContain('/PRA.jpg'); // default tax-authority mark
    const custom = renderInvoiceHtml(
      withFbr(),
      'thermal_classic',
      cfg({ fbrLogoUrl: 'https://cdn.example.com/my-logo.png' }),
    ).html;
    expect(custom).toContain('https://cdn.example.com/my-logo.png');
    expect(custom).not.toContain('/PRA.jpg');
  });

  it('rich sample previews the FBR block so the designer toggle is visible', () => {
    const html = renderInvoiceHtml(richSampleInvoice(), 'thermal_classic', DEFAULT_INVOICE_TEMPLATE_CONFIG).html;
    expect(html).toContain('class="fbrblock"');
  });
});

describe('dealPriceDisplay — where a deal prints its price', () => {
  const dealInvoice = () => {
    const inv = sampleInvoice();
    inv.orders[0].items = [
      {
        name_snapshot: 'Build Your Own Pizza (Small Deal)',
        variant_name: 'Small 7"',
        deal_id: 42,
        deal_slot_index: 0,
        deal_name: 'Small Pizza Lunch Offer',
        quantity: 1,
        unit_price: 549,
        subtotal: 549,
      },
    ];
    return inv;
  };
  const dealRowOf = (html: string, table: boolean) =>
    table
      ? html.match(/<tr class="dealrow"[^>]*>[\s\S]*?<\/tr>/)![0]
      : html.match(/<div class="row " data-field="dealPriceDisplay">[\s\S]*?<\/div>/)![0];
  const compRowOf = (html: string, table: boolean) =>
    table
      ? html.match(/<tr><td class="ci"><span class="ind">Build[\s\S]*?<\/tr>/)![0]
      : html.match(/<div class="row sub"><span class="l">Build[\s\S]*?<\/div>/)![0];

  for (const [layout, table] of [['bill_bordered', true], ['thermal_classic', false]] as const) {
    it(`both (default) prints the price on deal name AND component — ${layout}`, () => {
      const html = renderInvoiceHtml(dealInvoice(), layout, cfg({})).html;
      expect(dealRowOf(html, table)).toContain('549.00');
      expect(compRowOf(html, table)).toContain('549.00');
    });

    it(`items_only drops the price from the deal-name line — ${layout}`, () => {
      const html = renderInvoiceHtml(dealInvoice(), layout, cfg({ dealPriceDisplay: 'items_only' })).html;
      expect(dealRowOf(html, table)).not.toContain('549');
      expect(compRowOf(html, table)).toContain('549.00');
    });

    it(`deal_only keeps the deal-name price and blanks the components — ${layout}`, () => {
      const html = renderInvoiceHtml(dealInvoice(), layout, cfg({ dealPriceDisplay: 'deal_only' })).html;
      expect(dealRowOf(html, table)).toContain('549.00');
      expect(compRowOf(html, table)).not.toContain('549');
    });
  }
});

describe('tableNumberDisplay — table number prominence', () => {
  it('default row mode keeps the plain meta row and no band', () => {
    const html = render({});
    expect(html).toContain('<td class="mk">Table</td>');
    expect(html).not.toContain('class="tableband');
  });

  it('banner mode replaces the meta row with a big centered band', () => {
    const html = render({ tableNumberDisplay: 'banner' });
    expect(html).toContain('<div class="tableband" data-field="showTableNumber">TABLE 7</div>');
    expect(html).not.toContain('<td class="mk">Table</td>');
  });

  it('banner_inverted adds the white-on-black class', () => {
    const html = render({ tableNumberDisplay: 'banner_inverted' });
    expect(html).toContain('class="tableband invband"');
  });

  it('banner respects showTableNumber=false', () => {
    const html = render({ tableNumberDisplay: 'banner', showTableNumber: false });
    expect(html).not.toContain('tableband');
    expect(html).not.toContain('<td class="mk">Table</td>');
  });

  it('row_large keeps the row and emits the enlarging CSS override', () => {
    const out = renderInvoiceHtml(sampleInvoice(), 'thermal_classic', cfg({ tableNumberDisplay: 'row_large' }));
    expect(out.html).toContain('<td class="mk">Table</td>');
    expect(out.html).not.toContain('tableband');
    expect(out.css).toContain('tr[data-field="showTableNumber"] .mv');
    const off = renderInvoiceHtml(sampleInvoice(), 'thermal_classic', cfg({})).css;
    expect(off).not.toContain('tr[data-field="showTableNumber"]');
  });

  it('receipt_logo: banner mode moves the table out of the order band (no duplication)', () => {
    const html = renderInvoiceHtml(sampleInvoice(), 'receipt_logo', cfg({ tableNumberDisplay: 'banner' })).html;
    expect(html).toContain('TABLE 7');
    expect((html.match(/(TABLE|Table) 7/g) ?? []).length).toBe(1);
    expect(html).not.toContain('· Table 7');
  });

  it('receipt_logo: row_large hands the table to the meta table as a single enlarged row', () => {
    const out = renderInvoiceHtml(sampleInvoice(), 'receipt_logo', cfg({ tableNumberDisplay: 'row_large' }));
    expect(out.html).toContain('<td class="mk">Table</td>');
    expect(out.html).not.toContain('· Table 7');
    expect((out.html.match(/(TABLE|Table)&nbsp;?<\/td><td class="mv">7|Table 7/g) ?? []).length).toBeLessThanOrEqual(1);
    expect((out.html.match(/<td class="mk">Table<\/td>/g) ?? []).length).toBe(1);
    expect(out.css).toContain('tr[data-field="showTableNumber"] .mv');
  });

  it('receipt_logo: row mode still prints the table inside the order band only', () => {
    const html = renderInvoiceHtml(sampleInvoice(), 'receipt_logo', cfg({})).html;
    expect(html).toContain('Table 7');
    expect(html).not.toContain('tableband');
    expect(html).not.toContain('<td class="mk">Table</td>');
  });

  it('band prints on every layout in banner mode', () => {
    for (const layout of ALL_LAYOUTS) {
      const html = renderInvoiceHtml(sampleInvoice(), layout, cfg({ tableNumberDisplay: 'banner' })).html;
      expect(html, layout).toContain('class="tableband"');
    }
  });
});
