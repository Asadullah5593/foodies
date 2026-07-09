import {
  InvoiceVM,
  InvoiceOrderVM,
  InvoiceLineVM,
  InvoiceLayout,
  InvoiceTemplateConfig,
  resolveInvoiceConfig,
  LAYOUT_META,
} from './types';

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

const CURRENCY_SYMBOL: Record<string, string> = {
  PKR: 'Rs. ',
  USD: '$',
  GBP: '£',
  EUR: '€',
  AED: 'AED ',
  SAR: 'SAR ',
  INR: '₹',
};

function makeMoney(currency?: string | null) {
  // Escape the currency code — it is tenant-controlled and flows into the print HTML.
  const sym = esc(currency ? CURRENCY_SYMBOL[currency] ?? `${currency} ` : 'Rs. ');
  return (n: unknown) => `${sym}${Number(n ?? 0).toFixed(2)}`;
}

/** One row per deal (with component sub-rows); standalone items as-is. */
function groupItemsForReceipt(
  items: InvoiceLineVM[],
): Array<{ dealId: number | null; lines: InvoiceLineVM[] }> {
  const byDeal = new Map<number | 'standalone', InvoiceLineVM[]>();
  for (const line of items ?? []) {
    const key = line.deal_id != null ? line.deal_id : 'standalone';
    if (!byDeal.has(key)) byDeal.set(key, []);
    byDeal.get(key)!.push(line);
  }
  const result: Array<{ dealId: number | null; lines: InvoiceLineVM[] }> = [];
  byDeal.forEach((lines, key) => {
    if (key === 'standalone') for (const l of lines) result.push({ dealId: null, lines: [l] });
    else {
      lines.sort((a, b) => (a.deal_slot_index ?? 0) - (b.deal_slot_index ?? 0));
      result.push({ dealId: key as number, lines });
    }
  });
  return result;
}

function row(left: string, right: string, cls = ''): string {
  return `<div class="row ${cls}"><span class="l">${left}</span><span class="r">${right}</span></div>`;
}

function itemsHtml(
  order: InvoiceOrderVM,
  cfg: InvoiceTemplateConfig,
  money: (n: unknown) => string,
): string {
  const groups = groupItemsForReceipt(order.items ?? []);
  return groups
    .map((g) => {
      if (g.dealId != null && g.lines.length > 0) {
        const dealTotal = g.lines.reduce((s, l) => s + Number(l.subtotal), 0);
        const name = g.lines.find((l) => l.deal_name)?.deal_name ?? 'Deal';
        const sub = g.lines
          .map((l) => {
            const v = cfg.showVariant && l.variant_name ? ` (${esc(l.variant_name)})` : '';
            const note =
              cfg.showItemNotes && l.notes
                ? `<div class="row sub sub2"><span class="l muted">Note: ${esc(l.notes)}</span><span class="r"></span></div>`
                : '';
            return `<div class="row sub"><span class="l">${esc(l.name_snapshot ?? 'Item')}${v} × ${l.quantity}</span><span class="r">${Number(l.unit_price) === 0 ? '—' : money(l.subtotal)}</span></div>${note}`;
          })
          .join('');
        return row(`<strong>${esc(name)}</strong>`, money(dealTotal)) + sub;
      }
      return g.lines
        .map((l) => {
          const cat = cfg.showCategory && l.category ? `<span class="cat">${esc(l.category)}</span>` : '';
          const v = cfg.showVariant && l.variant_name ? ` <span class="muted">(${esc(l.variant_name)})</span>` : '';
          const base = Number(l.unit_price) * Number(l.quantity ?? 1);
          const head = row(
            `${cat}${esc(l.name_snapshot ?? 'Item')}${v} × ${l.quantity}`,
            cfg.showUnitPrice ? money(base) : '',
          );
          const addons = cfg.showModifiers
            ? (l.addons ?? [])
                .map((a) =>
                  row(
                    `<span class="sub-l">+ ${esc(a.name ?? 'Add-on')}${Number(a.quantity ?? 1) !== 1 ? ` × ${a.quantity}` : ''}</span>`,
                    money(a.subtotal != null ? a.subtotal : Number(a.unit_price) * Number(a.quantity ?? 1)),
                    'sub',
                  ),
                )
                .join('')
            : '';
          // Conditional chooser picks (triggered_by) nest under their trigger option so
          // "Meal +130" and "Milkshake +250" read as one upgrade chain, not two drinks.
          const modList = l.modifiers ?? [];
          const children = new Map<string, typeof modList>();
          const roots: typeof modList = [];
          for (const m of modList) {
            const t = m.triggered_by ?? null;
            if (t && modList.some((x) => x !== m && (x.name ?? '') === t)) {
              if (!children.has(t)) children.set(t, []);
              children.get(t)!.push(m);
            } else roots.push(m);
          }
          const modRow = (m: (typeof modList)[number], nested: boolean) =>
            nested
              ? row(
                  `<span class="sub2-l">↳ ${esc(m.name ?? 'Modifier')}</span>`,
                  Number(m.unit_price) ? `${money(m.unit_price)}` : 'Included',
                  'sub sub2',
                )
              : row(
                  `<span class="sub-l">+ ${esc(m.group ? `${m.group}: ` : '')}${esc(m.name ?? 'Modifier')}</span>`,
                  Number(m.unit_price) ? money(m.unit_price) : '',
                  'sub',
                );
          const mods = cfg.showModifiers
            ? roots
                .map((m) =>
                  [modRow(m, false), ...(children.get(m.name ?? '') ?? []).map((c) => modRow(c, true))].join(''),
                )
                .join('')
            : '';
          const notes =
            cfg.showItemNotes && l.notes
              ? `<div class="row sub"><span class="l muted">Note: ${esc(l.notes)}</span><span class="r"></span></div>`
              : '';
          return head + addons + mods + notes;
        })
        .join('');
    })
    .join('');
}

function totalsHtml(
  order: InvoiceOrderVM,
  cfg: InvoiceTemplateConfig,
  money: (n: unknown) => string,
): string {
  const parts: string[] = [];
  if (cfg.showSubtotal) parts.push(row('Subtotal', money(order.subtotal)));

  // Discounts: show EITHER the combined line OR the per-stage breakdown, never
  // both (avoids listing the same amount twice). Turn off "total discount" to
  // itemize. Per-stage amounts are only populated for orders placed after the
  // split shipped, so if an itemized template hits an older order with a combined
  // discount but no split, fall back to the combined line so it never vanishes.
  const combinedLabel =
    cfg.showDiscountName && order.discount_code
      ? `Discount (${esc(order.discount_code)})`
      : 'Discount';
  const perStage: Array<[boolean, string, number | undefined]> = [
    [cfg.showPromoDiscount, 'Promotional discount', order.promo_discount_amount],
    [cfg.showOrderDiscount, 'Order discount', order.order_discount_amount],
    [cfg.showCouponDiscount, 'Coupon discount', order.coupon_discount_amount],
    [cfg.showCardDiscount, 'Card discount', order.card_discount_amount],
  ];
  const enabledStages = perStage.filter(([on]) => on);
  const shownStageTotal = enabledStages.reduce((s, [, , amt]) => s + Number(amt ?? 0), 0);

  if (cfg.showDiscountTotal || enabledStages.length === 0) {
    if (Number(order.discount_amount) > 0)
      parts.push(row(combinedLabel, `-${money(order.discount_amount)}`, 'disc'));
  } else if (shownStageTotal > 0) {
    for (const [, label, amt] of enabledStages)
      if (Number(amt ?? 0) > 0) parts.push(row(label, `-${money(amt)}`, 'disc'));
  } else if (Number(order.discount_amount) > 0) {
    // Itemized template, but this (older) order has no split → don't hide it.
    parts.push(row(combinedLabel, `-${money(order.discount_amount)}`, 'disc'));
  }

  if (cfg.showTax) {
    const rate =
      cfg.showTaxRate && order.tax_rate != null && Number(order.tax_rate) > 0
        ? ` (${(Number(order.tax_rate) * 100).toFixed(Number(order.tax_rate) * 100 % 1 === 0 ? 0 : 2)}%)`
        : '';
    parts.push(row(`${esc(cfg.taxLabel || 'Tax')}${rate}`, money(order.tax_amount)));
  }
  if (cfg.showServiceCharge && Number(order.service_charge) > 0)
    parts.push(row('Service charge', money(order.service_charge)));
  if (cfg.showDeliveryFee && Number(order.delivery_fee) > 0)
    parts.push(row('Delivery fee', money(order.delivery_fee)));

  parts.push(row('<strong>Total</strong>', `<strong>${money(order.total_amount)}</strong>`, 'grand'));

  const loyalty: string[] = [];
  if (cfg.showLoyaltyEarned && Number(order.loyalty_points_earned ?? 0) > 0)
    loyalty.push(row('Points earned', String(order.loyalty_points_earned ?? 0)));
  if (cfg.showLoyaltyRedeemed && Number(order.loyalty_points_redeemed ?? 0) > 0)
    loyalty.push(row('Points redeemed', String(order.loyalty_points_redeemed ?? 0)));
  if (cfg.showLoyaltyBalance)
    loyalty.push(row('Points balance', String(order.loyalty_points_remaining ?? 0)));

  return `<div class="totals">${parts.join('')}</div>${loyalty.length ? `<div class="loyalty">${loyalty.join('')}</div>` : ''}`;
}

function metaHtml(order: InvoiceOrderVM, cfg: InvoiceTemplateConfig): string {
  const rows: string[] = [];
  if (cfg.showOrderNumber) rows.push(row('Order', `#${esc(order.order_number)}`, 'meta'));
  if (cfg.showOrderType && order.order_type)
    rows.push(row('Type', esc(String(order.order_type).replace('_', ' ')), 'meta'));
  if (cfg.showTableNumber && order.table_number)
    rows.push(row('Table', esc(order.table_number), 'meta'));
  if (cfg.showDateTime && order.placed_at)
    rows.push(row('Date', esc(new Date(order.placed_at).toLocaleString()), 'meta'));
  if (cfg.showCashier && order.cashier_name)
    rows.push(row('Cashier', esc(order.cashier_name), 'meta'));
  if (cfg.showCustomerInfo && (order.customer_name || order.customer_phone))
    rows.push(
      row('Customer', esc([order.customer_name, order.customer_phone].filter(Boolean).join(' · ')), 'meta'),
    );
  if (cfg.showOrderNotes && order.notes)
    rows.push(row('Note', `<em>${esc(order.notes)}</em>`, 'meta'));
  return rows.length ? `<div class="meta">${rows.join('')}</div>` : '';
}

/**
 * Render an invoice to print-ready HTML honoring the template config. Used for
 * both the on-screen preview and the print popup. CSS is namespaced under
 * `.inv-root` so it is safe to inject inline.
 */
export function renderInvoiceHtml(
  data: InvoiceVM,
  layout: InvoiceLayout,
  rawConfig: Partial<InvoiceTemplateConfig> | null | undefined,
): { html: string; css: string } {
  const cfg = resolveInvoiceConfig(rawConfig);
  const money = makeMoney(data.currency);
  const header = data.header ?? {};
  const multi = (data.orders?.length ?? 0) > 1;
  const firstOrder = data.orders?.[0];

  const logoUrl =
    cfg.showLogo
      ? cfg.logoUrl || firstOrder?.brand_logo_url || null
      : null;

  const headerBlock = `
    <div class="head">
      ${logoUrl ? `<img class="logo" src="${esc(logoUrl)}" alt="" />` : ''}
      <div class="biz">${esc(header.legal_name || header.tenant_name || '')}</div>
      ${header.branch_name ? `<div class="line">${esc(header.branch_name)}</div>` : ''}
      ${header.address ? `<div class="line">${esc(header.address)}</div>` : ''}
      ${header.phone ? `<div class="line">${esc(header.phone)}</div>` : ''}
      ${header.email ? `<div class="line">${esc(header.email)}</div>` : ''}
      ${cfg.headerText ? `<div class="line note">${esc(cfg.headerText)}</div>` : ''}
    </div>`;

  const ordersHtml = (data.orders ?? [])
    .map((o) => {
      const brandLine =
        multi && o.brand_name ? `<div class="brand">${esc(o.brand_name)}</div>` : '';
      return `
        <div class="order">
          ${brandLine}
          ${metaHtml(o, cfg)}
          <div class="items">${itemsHtml(o, cfg, money)}</div>
          ${totalsHtml(o, cfg, money)}
        </div>`;
    })
    .join('<div class="rule"></div>');

  const grandTotal = multi
    ? `<div class="grandtotal">${row('<strong>Gross total</strong>', `<strong>${money(data.gross_total)}</strong>`)}</div>`
    : '';

  const footer = `
    <div class="foot">
      ${cfg.footerText ? `<div class="line">${esc(cfg.footerText)}</div>` : ''}
      ${cfg.showPoweredBy ? `<div class="powered">Powered by Rex Technologies</div>` : ''}
    </div>`;

  const html = `<div class="inv-root inv-${layout}">${headerBlock}${ordersHtml}${grandTotal}${footer}</div>`;
  return { html, css: cssFor(layout) };
}

function cssFor(layout: InvoiceLayout): string {
  const widthMm = LAYOUT_META[layout].widthMm;
  const thermal = layout !== 'a4_invoice';
  const base = `
    .inv-root { box-sizing: border-box; color: #000; background: #fff; margin: 0 auto; }
    .inv-root * { box-sizing: border-box; }
    .inv-root .head { text-align: center; margin-bottom: 8px; }
    .inv-root .logo { max-width: 120px; max-height: 90px; object-fit: contain; margin: 0 auto 6px; display: block; }
    .inv-root .biz { font-weight: 700; font-size: 1.05em; }
    .inv-root .line { font-size: 0.82em; }
    .inv-root .note { margin-top: 4px; white-space: pre-line; }
    .inv-root .brand { font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin: 6px 0 2px; font-size: .9em; }
    .inv-root .meta { margin: 6px 0; }
    .inv-root .row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
    .inv-root .row .l { flex: 1; }
    .inv-root .row .r { white-space: nowrap; text-align: right; }
    .inv-root .row.sub .l, .inv-root .sub-l { padding-left: 10px; color: #444; font-size: .92em; }
    .inv-root .row.sub2 .l, .inv-root .sub2-l { padding-left: 22px; }
    .inv-root .row.meta { font-size: .82em; color: #333; }
    .inv-root .cat { display: inline-block; font-size: .72em; text-transform: uppercase; color: #666; margin-right: 4px; }
    .inv-root .muted { color: #666; }
    .inv-root .items { border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 6px 0; margin: 6px 0; }
    .inv-root .totals { margin-top: 4px; }
    .inv-root .row.disc { color: #067647; }
    .inv-root .row.grand { border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; font-size: 1.05em; }
    .inv-root .loyalty { margin-top: 4px; font-size: .85em; color: #333; }
    .inv-root .rule { border-top: 1px dashed #999; margin: 8px 0; }
    .inv-root .grandtotal { border-top: 2px solid #000; margin-top: 8px; padding-top: 6px; font-size: 1.1em; }
    .inv-root .foot { text-align: center; margin-top: 10px; font-size: .8em; color: #333; }
    .inv-root .powered { margin-top: 6px; font-size: .78em; color: #666; }
  `;
  if (thermal) {
    return `${base}
      .inv-root.inv-${layout} { width: ${widthMm}mm; max-width: ${widthMm}mm; font-family: 'Courier New', ui-monospace, monospace; font-size: ${layout === 'thermal_58mm' ? 10 : 11}px; padding: 6px; }
      @media print { @page { size: ${widthMm}mm auto; margin: 0; } }
    `;
  }
  return `${base}
    .inv-root.inv-a4_invoice { width: 190mm; max-width: 190mm; font-family: system-ui, -apple-system, sans-serif; font-size: 13px; padding: 12mm; }
    .inv-root.inv-a4_invoice .items { border-color: #ccc; }
    .inv-root.inv-a4_invoice .row.grand { font-size: 1.15em; }
    @media print { @page { size: A4; margin: 12mm; } .inv-root.inv-a4_invoice { padding: 0; width: auto; max-width: none; } }
  `;
}

/** Sample data for the admin live preview. */
export function sampleInvoice(): InvoiceVM {
  return {
    order_group_id: 'preview',
    currency: 'PKR',
    header: {
      legal_name: 'Your Restaurant Pvt Ltd',
      branch_name: 'Main Branch',
      address: '123 Food Street, Lahore',
      phone: '+92 300 1234567',
      email: null,
    },
    orders: [
      {
        order_id: 1,
        order_number: 'BR-1-000123',
        brand_name: 'Fireaway',
        brand_logo_url: null,
        order_type: 'dine_in',
        table_number: '7',
        placed_at: '2026-07-08T12:30:00Z',
        customer_name: 'Ali Khan',
        customer_phone: '+92 301 7654321',
        items: [
          {
            name_snapshot: 'Build Your Own Pizza',
            category: 'Pizza',
            variant_name: 'Large 12"',
            quantity: 1,
            unit_price: 699,
            subtotal: 699,
            modifiers: [{ group: 'Base', name: 'Pesto Base', unit_price: 0 }],
          },
          { name_snapshot: 'Coca-Cola 345ml', category: 'Drinks', quantity: 2, unit_price: 130, subtotal: 260 },
        ],
        subtotal: 959,
        discount_amount: 96,
        promo_discount_amount: 70,
        coupon_discount_amount: 26,
        order_discount_amount: 0,
        card_discount_amount: 0,
        discount_code: 'SAVE10',
        tax_amount: 129,
        tax_rate: 0.15,
        service_charge: 0,
        delivery_fee: 0,
        total_amount: 992,
        loyalty_points_earned: 9,
        loyalty_points_redeemed: 0,
        loyalty_points_remaining: 42,
      },
    ],
    gross_total: 992,
    loyalty_points_remaining: 42,
  };
}
