import {
  InvoiceVM,
  InvoiceOrderVM,
  InvoiceLineVM,
  InvoiceLayout,
  InvoiceTemplateConfig,
  resolveInvoiceConfig,
  LAYOUT_META,
} from './types';
import { APP_QR_SVG } from './appQr';
import { fbrLogoSrc, fbrQrSvg } from './fbr';

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

/** Plain 2dp number for table cells (currency symbol lives on the totals lines). */
function num(n: unknown): string {
  return Number(n ?? 0).toFixed(2);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Receipt-style date: 28-Mar-2026 09:50 PM */
function fmtDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  let h = d.getHours();
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${String(d.getDate()).padStart(2, '0')}-${MONTHS[d.getMonth()]}-${d.getFullYear()} ${String(h).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} ${ampm}`;
}

function titleCase(s: string): string {
  return s
    .replace(/_/g, ' ')
    .replace(/\w\S*/g, (w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
}

/**
 * Umbrella-logo fallback used only when a brand has no logo of its own. Absolute
 * URL because the print popup is a blank document where relative paths do not
 * resolve.
 */
function fallbackLogo(): string {
  const origin = typeof window !== 'undefined' ? window.location?.origin ?? '' : '';
  return `${origin}/foodies-logo.png`;
}

/**
 * The header logo: the order's own brand logo, falling back to the platform
 * umbrella mark when that brand has none. There is no per-template override —
 * every brand always prints its own logo. Multi-brand groups show the umbrella
 * in the header and each order section carries its own brand logo instead.
 */
function headerLogoUrl(cfg: InvoiceTemplateConfig, firstOrder: InvoiceOrderVM | undefined, multi: boolean): string | null {
  if (!cfg.showLogo) return null;
  if (!multi && firstOrder?.brand_logo_url) return firstOrder.brand_logo_url;
  return fallbackLogo();
}

/** Per-order brand banner (logo + name) for multi-brand group invoices. */
function brandBlockHtml(o: InvoiceOrderVM, cfg: InvoiceTemplateConfig): string {
  if (!o.brand_name && !o.brand_logo_url) return '';
  const logo =
    cfg.showLogo && o.brand_logo_url
      ? `<img class="brandlogo" src="${esc(o.brand_logo_url)}" alt="" />`
      : '';
  return `<div class="brandblk">${logo}${o.brand_name ? `<div class="brand">${esc(o.brand_name)}</div>` : ''}</div>`;
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

function row(left: string, right: string, cls = '', field = ''): string {
  const attr = field ? ` data-field="${field}"` : '';
  return `<div class="row ${cls}"${attr}><span class="l">${left}</span><span class="r">${right}</span></div>`;
}

/**
 * Nest conditional chooser picks (triggered_by) under their trigger option so
 * "Meal +130" and "Milkshake +250" read as one upgrade chain, not two drinks.
 */
function splitModifiers(modList: NonNullable<InvoiceLineVM['modifiers']>) {
  const children = new Map<string, typeof modList>();
  const roots: typeof modList = [];
  for (const m of modList) {
    const t = m.triggered_by ?? null;
    if (t && modList.some((x) => x !== m && (x.name ?? '') === t)) {
      if (!children.has(t)) children.set(t, []);
      children.get(t)!.push(m);
    } else roots.push(m);
  }
  return { roots, children };
}

/**
 * What a modifier actually bills. The group's included allowance (first-N-free)
 * makes free_quantity units free, so only (quantity - free_quantity) are charged
 * — a topping picked 3× with 1 included bills 2 × unit_price. Fully-included
 * picks bill 0, printed per the template's zeroAmountDisplay setting.
 */
function modifierBilling(m: NonNullable<InvoiceLineVM['modifiers']>[number]) {
  const qty = Math.max(1, Number(m.quantity ?? 1));
  const free = Math.min(qty, Math.max(0, Number(m.free_quantity ?? 0)));
  const unit = Number(m.unit_price ?? 0);
  return { qty, free, unit, amount: (qty - free) * unit };
}

/**
 * The amount cell for modifier / add-on / deal-component lines. Zero amounts
 * follow the template's zeroAmountDisplay: "0.00", "Included", or empty.
 */
function makeZeroAwareMoney(cfg: InvoiceTemplateConfig, money: (n: unknown) => string) {
  return (n: unknown): string => {
    if (Number(n ?? 0) !== 0) return money(n);
    if (cfg.zeroAmountDisplay === 'included') return 'Included';
    if (cfg.zeroAmountDisplay === 'blank') return '';
    return money(0);
  };
}

/** Same as makeZeroAwareMoney but for plain-number table cells (no currency symbol). */
function makeZeroAwareNum(cfg: InvoiceTemplateConfig) {
  return (n: unknown): string => {
    if (Number(n ?? 0) !== 0) return num(n);
    if (cfg.zeroAmountDisplay === 'included') return 'Included';
    if (cfg.zeroAmountDisplay === 'blank') return '';
    return num(0);
  };
}

/**
 * Rate cells follow whether the LINE BILLS ZERO (not whether the unit price is
 * zero), so the rate tracks the amount cell. A line that bills something always
 * shows its real rate; a line that bills nothing shows the rate only in 'zero'
 * mode and hides it in 'included'/'blank'. This hides the rate of a topping
 * that is free by the group's included allowance (real unit price, zero amount)
 * — the kitchen line then reads as name + qty only.
 */
function makeZeroAwareRate(cfg: InvoiceTemplateConfig) {
  return (unit: unknown, amount: unknown): string => {
    if (Number(amount ?? 0) !== 0) return num(unit);
    return cfg.zeroAmountDisplay === 'zero' ? num(unit) : '';
  };
}

/** An add-on's billed amount (explicit subtotal wins over unit × qty). */
function addonAmount(a: NonNullable<InvoiceLineVM['addons']>[number]): number {
  return a.subtotal != null ? Number(a.subtotal) : Number(a.unit_price) * Number(a.quantity ?? 1);
}

/**
 * Free/paid separation: free = lines that bill nothing — zero-total standalone
 * lines (BOGO freebies, 100%-off items) AND zero-priced deal components. Deal
 * grouping is stripped from the free lines so they list flat under the "Free
 * items" heading; the deal keeps its priced header with the paid items. The
 * showFreeItems toggle decides whether the free lines print at all.
 */
function splitFreeLines(items: InvoiceLineVM[]): { paid: InvoiceLineVM[]; free: InvoiceLineVM[] } {
  const paid: InvoiceLineVM[] = [];
  const free: InvoiceLineVM[] = [];
  for (const l of items ?? []) {
    if (Number(l.subtotal) === 0) free.push({ ...l, deal_id: null, deal_slot_index: null, deal_name: null });
    else paid.push(l);
  }
  return { paid, free };
}

/** Flexible-rows item body (name × qty on the left, price on the right). */
function itemsHtml(
  order: InvoiceOrderVM,
  cfg: InvoiceTemplateConfig,
  money: (n: unknown) => string,
): string {
  const zeroMoney = makeZeroAwareMoney(cfg, money);
  const renderGroup = (g: { dealId: number | null; lines: InvoiceLineVM[] }): string => {
      if (g.dealId != null && g.lines.length > 0) {
        const dealTotal = g.lines.reduce((s, l) => s + Number(l.subtotal), 0);
        const name = g.lines.find((l) => l.deal_name)?.deal_name ?? 'Deal';
        const sub = g.lines
          .map((l) => {
            const v = cfg.showVariant && l.variant_name ? `<span data-field="showVariant"> (${esc(l.variant_name)})</span>` : '';
            // Zero-priced bundle components follow zeroAmountDisplay.
            return `<div class="row sub"><span class="l">${esc(l.name_snapshot ?? 'Item')}${v} × ${l.quantity}</span><span class="r">${zeroMoney(l.subtotal)}</span></div>`;
          })
          .join('');
        return row(`<strong>${esc(name)}</strong>`, money(dealTotal)) + sub;
      }
      return g.lines
        .map((l) => {
          const cat = cfg.showCategory && l.category ? `<span class="cat" data-field="showCategory">${esc(l.category)}</span>` : '';
          const v = cfg.showVariant && l.variant_name ? ` <span class="muted" data-field="showVariant">(${esc(l.variant_name)})</span>` : '';
          const base = Number(l.unit_price) * Number(l.quantity ?? 1);
          const head = row(
            `${cat}${esc(l.name_snapshot ?? 'Item')}${v} × ${l.quantity}`,
            cfg.showUnitPrice ? `<span data-field="showUnitPrice">${zeroMoney(base)}</span>` : '',
          );
          // Per-item note (kitchen instruction). Sits right under the item name,
          // opt-in — receipts carried no notes until this toggle.
          const noteHtml =
            cfg.showLineNotes && l.notes
              ? row(`<span class="sub-l">Note: ${esc(l.notes)}</span>`, '', 'sub', 'showLineNotes')
              : '';
          // "+ " and the "Base:"-style group name are each independently
          // toggleable; both on = today's look.
          const plus = cfg.showModifierPlus ? '+ ' : '';
          const grp = (m: NonNullable<InvoiceLineVM['modifiers']>[number]) =>
            cfg.showModifierGroup && m.group ? esc(`${m.group}: `) : '';
          // Zero-billing add-ons/modifiers are "free lines" too: hidden entirely
          // when free items are off (paid ones always print).
          const addons = cfg.showModifiers
            ? (l.addons ?? [])
                .filter((a) => cfg.showFreeItems || addonAmount(a) !== 0)
                .map((a) =>
                  row(
                    `<span class="sub-l">${plus}${esc(a.name ?? 'Add-on')}${Number(a.quantity ?? 1) !== 1 ? ` × ${a.quantity}` : ''}</span>`,
                    zeroMoney(addonAmount(a)),
                    'sub',
                    'showModifiers',
                  ),
                )
                .join('')
            : '';
          const modList = (l.modifiers ?? []).filter(
            (m) => cfg.showFreeItems || modifierBilling(m).amount !== 0,
          );
          const { roots, children } = splitModifiers(modList);
          const modRow = (m: (typeof modList)[number], nested: boolean) => {
            const b = modifierBilling(m);
            const qty = b.qty !== 1 ? ` × ${b.qty}` : '';
            return nested
              ? row(
                  `<span class="sub2-l">↳ ${esc(m.name ?? 'Modifier')}${qty}</span>`,
                  zeroMoney(b.amount),
                  'sub sub2',
                  'showModifiers',
                )
              : row(
                  `<span class="sub-l">${plus}${grp(m)}${esc(m.name ?? 'Modifier')}${qty}</span>`,
                  zeroMoney(b.amount),
                  'sub',
                  'showModifiers',
                );
          };
          const mods = cfg.showModifiers
            ? roots
                .map((m) =>
                  [modRow(m, false), ...(children.get(m.name ?? '') ?? []).map((c) => modRow(c, true))].join(''),
                )
                .join('')
            : '';
          return head + noteHtml + addons + mods;
        })
        .join('');
  };
  const { paid, free } = splitFreeLines(order.items ?? []);
  const paidHtml = groupItemsForReceipt(paid).map(renderGroup).join('');
  const freeHtml =
    cfg.showFreeItems && free.length
      ? `<div class="seclabel freelabel" data-field="showFreeItems">Free items</div>${groupItemsForReceipt(free).map(renderGroup).join('')}`
      : '';
  // Order-level note closes the items, right before the totals begin.
  const orderNote =
    cfg.showOrderNotes && order.notes
      ? row(`Note: ${esc(order.notes)}`, '', 'ordernote', 'showOrderNotes')
      : '';
  return paidHtml + freeHtml + orderNote;
}

/**
 * Column-table items block: Item | Qty | Rate | Amount. The Rate column follows
 * showUnitPrice. Deals render as a bold group row with indented component rows;
 * addons and modifiers indent under their item, with conditional picks nested
 * one deeper.
 */
function itemsTableHtml(
  order: InvoiceOrderVM,
  cfg: InvoiceTemplateConfig,
  labels: { item: string; qty: string; rate: string; amount: string },
): string {
  const showRate = cfg.showUnitPrice;
  const zeroNum = makeZeroAwareNum(cfg);
  const zeroRate = makeZeroAwareRate(cfg);
  const cell = (
    name: string,
    qty: string,
    rate: string,
    amount: string,
    cls = '',
    field = '',
  ) =>
    `<tr${cls ? ` class="${cls}"` : ''}${field ? ` data-field="${field}"` : ''}><td class="ci">${name}</td><td class="cq">${qty}</td>${showRate ? `<td class="cr">${rate}</td>` : ''}<td class="ca">${amount}</td></tr>`;
  const variantHtml = (name?: string | null) =>
    cfg.showVariant && name ? `<span data-field="showVariant"> (${esc(name)})</span>` : '';

  const renderGroup = (g: { dealId: number | null; lines: InvoiceLineVM[] }): string => {
      if (g.dealId != null && g.lines.length > 0) {
        const dealTotal = g.lines.reduce((s, l) => s + Number(l.subtotal), 0);
        const name = g.lines.find((l) => l.deal_name)?.deal_name ?? 'Deal';
        const head = cell(`<strong>${esc(name)}</strong>`, '', '', num(dealTotal), 'dealrow');
        const comps = g.lines
          .map((l) => {
            // Zero-priced bundle components follow zeroAmountDisplay.
            return cell(
              `<span class="ind">${esc(l.name_snapshot ?? 'Item')}${variantHtml(l.variant_name)}</span>`,
              String(l.quantity),
              zeroRate(l.unit_price, l.subtotal),
              zeroNum(l.subtotal),
            );
          })
          .join('');
        return head + comps;
      }
      return g.lines
        .map((l) => {
          const cat = cfg.showCategory && l.category ? `<span class="cat" data-field="showCategory">${esc(l.category)}</span>` : '';
          const base = Number(l.unit_price) * Number(l.quantity ?? 1);
          const head = cell(
            `${cat}${esc(l.name_snapshot ?? 'Item')}${variantHtml(l.variant_name)}`,
            String(l.quantity),
            zeroRate(l.unit_price, base),
            zeroNum(base),
          );
          // Per-item note (kitchen instruction), spanning the item column only.
          const noteCell =
            cfg.showLineNotes && l.notes
              ? cell(`<span class="ind">Note: ${esc(l.notes)}</span>`, '', '', '', '', 'showLineNotes')
              : '';
          const plus = cfg.showModifierPlus ? '+ ' : '';
          const grp = (m: NonNullable<InvoiceLineVM['modifiers']>[number]) =>
            cfg.showModifierGroup && m.group ? esc(`${m.group}: `) : '';
          // Zero-billing add-ons/modifiers are "free lines" too: hidden entirely
          // when free items are off (paid ones always print).
          const addons = cfg.showModifiers
            ? (l.addons ?? [])
                .filter((a) => cfg.showFreeItems || addonAmount(a) !== 0)
                .map((a) => {
                  const qty = Number(a.quantity ?? 1);
                  return cell(
                    `<span class="ind">${plus}${esc(a.name ?? 'Add-on')}</span>`,
                    qty !== 1 ? String(qty) : '',
                    zeroRate(a.unit_price, addonAmount(a)),
                    zeroNum(addonAmount(a)),
                    '',
                    'showModifiers',
                  );
                })
                .join('')
            : '';
          const modList = (l.modifiers ?? []).filter(
            (m) => cfg.showFreeItems || modifierBilling(m).amount !== 0,
          );
          const { roots, children } = splitModifiers(modList);
          const modCell = (m: (typeof modList)[number], nested: boolean) => {
            const b = modifierBilling(m);
            return cell(
              nested
                ? `<span class="ind2">↳ ${esc(m.name ?? 'Modifier')}</span>`
                : `<span class="ind">${plus}${grp(m)}${esc(m.name ?? 'Modifier')}</span>`,
              String(b.qty),
              zeroRate(b.unit, b.amount),
              zeroNum(b.amount),
              '',
              'showModifiers',
            );
          };
          const mods = cfg.showModifiers
            ? roots
                .map((m) =>
                  [modCell(m, false), ...(children.get(m.name ?? '') ?? []).map((c) => modCell(c, true))].join(''),
                )
                .join('')
            : '';
          return head + noteCell + addons + mods;
        })
        .join('');
  };
  const { paid, free } = splitFreeLines(order.items ?? []);
  const colCount = showRate ? 4 : 3;
  // Order-level note as the last row, spanning every column so it reads as a
  // full-width line where the items end — just above the totals.
  const orderNoteRow =
    cfg.showOrderNotes && order.notes
      ? `<tr class="ordernote" data-field="showOrderNotes"><td colspan="${colCount}">Note: ${esc(order.notes)}</td></tr>`
      : '';
  const rows =
    groupItemsForReceipt(paid).map(renderGroup).join('') +
    (cfg.showFreeItems && free.length
      ? `<tr class="freehead" data-field="showFreeItems"><td colspan="${colCount}">Free items</td></tr>${groupItemsForReceipt(free).map(renderGroup).join('')}`
      : '') +
    orderNoteRow;

  return `<table class="itbl"><thead><tr><th class="ci">${esc(labels.item)}</th><th class="cq">${esc(labels.qty)}</th>${showRate ? `<th class="cr">${esc(labels.rate)}</th>` : ''}<th class="ca">${esc(labels.amount)}</th></tr></thead><tbody>${rows}</tbody></table>`;
}

/**
 * Meta block as a two-column label / value table — order no, invoice no, type,
 * table, date, cashier, payment, customer. Shared by every template so the
 * header details read the same way everywhere.
 */
function metaTableHtml(order: InvoiceOrderVM, cfg: InvoiceTemplateConfig): string {
  const rows: string[] = [];
  const add = (k: string, v: string, field: string) =>
    rows.push(`<tr data-field="${field}"><td class="mk">${esc(k)}</td><td class="mv">${v}</td></tr>`);
  if (cfg.showOrderNumber) add('Order #', esc(order.order_number), 'showOrderNumber');
  if (cfg.showInvoiceNumber && order.invoice_number) add('Invoice #', esc(order.invoice_number), 'showInvoiceNumber');
  if (cfg.showOrderType && order.order_type) add('Type', esc(titleCase(String(order.order_type))), 'showOrderType');
  if (cfg.showTableNumber && order.table_number) add('Table', esc(order.table_number), 'showTableNumber');
  if (cfg.showDateTime && order.placed_at) add('Date', esc(fmtDateTime(order.placed_at)), 'showDateTime');
  if (cfg.showCashier && order.cashier_name) add('Cashier', esc(order.cashier_name), 'showCashier');
  if (cfg.showPaymentMethod && order.payment_method) add('Payment', esc(titleCase(order.payment_method)), 'showPaymentMethod');
  // A dine-in customer is at the table, so their receipt stays name-only. A
  // takeaway or delivery order may have to be called about, so those carry the
  // phone beside the name — the format receipts used before phones were dropped
  // from every type. Still gated by showCustomerInfo like the name itself.
  const withPhone =
    (order.order_type === 'takeaway' || order.order_type === 'delivery') &&
    !!order.customer_phone;
  const customerLine = withPhone
    ? [order.customer_name, order.customer_phone].filter(Boolean).join(' · ')
    : (order.customer_name ?? '');
  if (cfg.showCustomerInfo && customerLine)
    add('Customer', esc(customerLine), 'showCustomerInfo');
  return rows.length ? `<table class="metatbl"><tbody>${rows.join('')}</tbody></table>` : '';
}

function totalsHtml(
  order: InvoiceOrderVM,
  cfg: InvoiceTemplateConfig,
  money: (n: unknown) => string,
  grandLabel = 'Total',
): string {
  const parts: string[] = [];
  if (cfg.showSubtotal) parts.push(row('Subtotal', money(order.subtotal), '', 'showSubtotal'));

  // Discounts: show EITHER the combined line OR the per-stage breakdown, never
  // both (avoids listing the same amount twice). Turn off "total discount" to
  // itemize. Per-stage amounts are only populated for orders placed after the
  // split shipped, so if an itemized template hits an older order with a combined
  // discount but no split, fall back to the combined line so it never vanishes.
  const combinedLabel =
    cfg.showDiscountName && order.discount_code
      ? `Discount (${esc(order.discount_code)})`
      : 'Discount';
  const perStage: Array<[boolean, string, number | undefined, string]> = [
    [cfg.showPromoDiscount, 'Promotional discount', order.promo_discount_amount, 'showPromoDiscount'],
    [cfg.showOrderDiscount, 'Order discount', order.order_discount_amount, 'showOrderDiscount'],
    [cfg.showCouponDiscount, 'Coupon discount', order.coupon_discount_amount, 'showCouponDiscount'],
    [cfg.showCardDiscount, 'Card discount', order.card_discount_amount, 'showCardDiscount'],
  ];
  const enabledStages = perStage.filter(([on]) => on);
  const shownStageTotal = enabledStages.reduce((s, [, , amt]) => s + Number(amt ?? 0), 0);

  if (cfg.showDiscountTotal || enabledStages.length === 0) {
    if (Number(order.discount_amount) > 0)
      parts.push(row(combinedLabel, `-${money(order.discount_amount)}`, 'disc', 'showDiscountTotal'));
  } else if (shownStageTotal > 0) {
    for (const [, label, amt, field] of enabledStages)
      if (Number(amt ?? 0) > 0) parts.push(row(label, `-${money(amt)}`, 'disc', field));
  } else if (Number(order.discount_amount) > 0) {
    // Itemized template, but this (older) order has no split → don't hide it.
    parts.push(row(combinedLabel, `-${money(order.discount_amount)}`, 'disc', 'showDiscountTotal'));
  }

  if (cfg.showTax) {
    const rate =
      cfg.showTaxRate && order.tax_rate != null && Number(order.tax_rate) > 0
        ? ` (${(Number(order.tax_rate) * 100).toFixed(Number(order.tax_rate) * 100 % 1 === 0 ? 0 : 2)}%)`
        : '';
    parts.push(row(`Tax${rate}`, money(order.tax_amount), '', 'showTax'));
  }
  if (cfg.showServiceCharge && Number(order.service_charge) > 0)
    parts.push(row('Service charge', money(order.service_charge), '', 'showServiceCharge'));
  if (cfg.showDeliveryFee && Number(order.delivery_fee) > 0)
    parts.push(row('Delivery fee', money(order.delivery_fee), '', 'showDeliveryFee'));

  parts.push(
    row(`<strong>${grandLabel}</strong>`, `<strong>${money(order.total_amount)}</strong>`, 'grand'),
  );

  const loyalty: string[] = [];
  if (cfg.showLoyaltyEarned && Number(order.loyalty_points_earned ?? 0) > 0)
    loyalty.push(row('Points earned', String(order.loyalty_points_earned ?? 0), '', 'showLoyaltyEarned'));
  if (cfg.showLoyaltyRedeemed && Number(order.loyalty_points_redeemed ?? 0) > 0)
    loyalty.push(row('Points redeemed', String(order.loyalty_points_redeemed ?? 0), '', 'showLoyaltyRedeemed'));
  if (cfg.showLoyaltyBalance)
    loyalty.push(row('Points balance', String(order.loyalty_points_remaining ?? 0), '', 'showLoyaltyBalance'));

  return `<div class="totals">${parts.join('')}</div>${loyalty.length ? `<div class="loyalty">${loyalty.join('')}</div>` : ''}`;
}

/**
 * Business header: logo, brand/business name, then whatever the admin typed in
 * the template's Header Text box. Branch address / phone are NOT auto-filled —
 * that area is empty by default and the admin controls it entirely via Header
 * Text (so each brand shows exactly the contact details it wants). A single-
 * brand receipt leads with THAT brand's name; a multi-brand group leads with
 * the business name and shows each brand per section.
 */
/**
 * Logo and header text only — the receipt carries no business/brand name line.
 * The logo identifies the brand; put a name in the template's Header Text box if
 * one is needed (e.g. legal name for tax wording).
 */
function bizHeaderHtml(data: InvoiceVM, cfg: InvoiceTemplateConfig): string {
  const multi = (data.orders?.length ?? 0) > 1;
  const logoUrl = headerLogoUrl(cfg, data.orders?.[0], multi);
  return `
    <div class="head">
      ${logoUrl ? `<img class="logo" data-field="showLogo" src="${esc(logoUrl)}" alt="" />` : ''}
      ${cfg.headerText ? `<div class="line note">${esc(cfg.headerText)}</div>` : ''}
    </div>`;
}

/** Whether the order renders any loyalty/points line under the totals — mirrors
 *  the conditions in totalsHtml so the footer can tell if points separate the
 *  grand total from it. */
function orderHasLoyaltyLines(
  order: InvoiceOrderVM | undefined,
  cfg: InvoiceTemplateConfig,
): boolean {
  if (!order) return false;
  return (
    cfg.showLoyaltyBalance ||
    (cfg.showLoyaltyEarned && Number(order.loyalty_points_earned ?? 0) > 0) ||
    (cfg.showLoyaltyRedeemed && Number(order.loyalty_points_redeemed ?? 0) > 0)
  );
}

function footerHtml(data: InvoiceVM, cfg: InvoiceTemplateConfig): string {
  // On a single-order receipt with no loyalty line, the grand-total's own
  // (bold) bottom rule already divides it from the footer, so the FIRST footer
  // block below it drops its lighter top rule to avoid a stacked double line.
  const flushTop =
    (data.orders?.length ?? 0) === 1 && !orderHasLoyaltyLines(data.orders?.[0], cfg);
  // App-download QR closes the receipt, above the footer: prompt text on the
  // left, the QR on the right. The QR encodes the same deep link the consumer
  // site shows (see appQr.ts), so scanning a receipt lands in the same place.
  const qrBlock = cfg.showAppQr
    ? `
    <div class="qrblock${flushTop ? ' flush' : ''}" data-field="showAppQr">
      <div class="qr-text">${cfg.appQrText ? esc(cfg.appQrText) : ''}</div>
      <div class="qr-img">${APP_QR_SVG}</div>
    </div>`
    : '';
  // FBR fiscalization block, directly below the app-QR row: the tax-authority
  // logo bottom-left (under the app-QR prompt text) and the verification QR
  // bottom-right (under the app QR), then the "FBR Invoice #" line BENEATH that
  // row. The QR encodes the FBR invoice number for the Tax Asaan app. Orders
  // without a number (FBR never active for the branch) print nothing. POS/app/
  // kiosk groups are single-order, so the first order carrying a number is THE
  // order. The logo is the template's own (config.fbrLogoUrl) or the default.
  const fbrNumber = (data.orders ?? []).find((o) => o.fbr_invoice_number)?.fbr_invoice_number;
  const fbrBlock =
    cfg.showFbrInvoice && fbrNumber
      ? `
    <div class="fbrblock${flushTop && !cfg.showAppQr ? ' flush' : ''}" data-field="showFbrInvoice">
      <div class="fbr-row">
        <img class="fbr-logo" src="${esc(fbrLogoSrc(cfg.fbrLogoUrl))}" alt="Tax authority" />
        <div class="fbr-qr">${fbrQrSvg(fbrNumber)}</div>
      </div>
      <div class="fbr-head">FBR Invoice # <span class="fbr-num">${esc(fbrNumber)}</span></div>
    </div>`
      : '';
  return `${qrBlock}${fbrBlock}
    <div class="foot">
      ${cfg.footerText ? `<div class="line">${esc(cfg.footerText)}</div>` : ''}
      ${cfg.showPoweredBy ? `<div class="powered" data-field="showPoweredBy">Powered by Rex Technologies</div>` : ''}
    </div>`;
}

function grossTotalHtml(data: InvoiceVM, money: (n: unknown) => string): string {
  const multi = (data.orders?.length ?? 0) > 1;
  return multi
    ? `<div class="grandtotal">${row('<strong>Gross total</strong>', `<strong>${money(data.gross_total)}</strong>`)}</div>`
    : '';
}

/**
 * "Bordered Bill" — modeled on the Chow Ming sample. Centered logo header, a
 * tabular meta block, and a fully bordered Item | Qty | Rate | Amount table with
 * right-anchored totals. Best for dine-in bills.
 */
function billBorderedBody(
  data: InvoiceVM,
  cfg: InvoiceTemplateConfig,
  money: (n: unknown) => string,
): string {
  const multi = (data.orders?.length ?? 0) > 1;
  const ordersHtml = (data.orders ?? [])
    .map(
      (o) => `
        <div class="order">
          ${multi ? brandBlockHtml(o, cfg) : ''}
          ${metaTableHtml(o, cfg)}
          ${itemsTableHtml(o, cfg, { item: 'Item Name', qty: 'Qty', rate: 'Rate', amount: 'Amount' })}
          ${totalsHtml(o, cfg, money, 'Grand Total')}
        </div>`,
    )
    .join('<div class="rule"></div>');
  return `${bizHeaderHtml(data, cfg)}${ordersHtml}${grossTotalHtml(data, money)}${footerHtml(data, cfg)}`;
}

/**
 * "Logo Receipt" — modeled on the Devour sample. Oversized brand logo + name, a
 * tabular invoice-meta block, a big centered Order # band, an underlined
 * Product | Qty | Rate | Total table and a dash-framed grand total. Best for
 * takeaway / counter pickup.
 */
function receiptLogoBody(
  data: InvoiceVM,
  cfg: InvoiceTemplateConfig,
  money: (n: unknown) => string,
): string {
  const multi = (data.orders?.length ?? 0) > 1;

  const ordersHtml = (data.orders ?? [])
    .map((o) => {
      const typeBits: string[] = [];
      if (cfg.showOrderType && o.order_type) typeBits.push(titleCase(String(o.order_type)));
      if (cfg.showTableNumber && o.table_number) typeBits.push(`Table ${o.table_number}`);
      const onumLine = cfg.showOrderNumber
        ? `<div class="onum" data-field="showOrderNumber">Order # ${esc(o.order_number)}</div>`
        : '';
      const invLine =
        cfg.showInvoiceNumber && o.invoice_number
          ? `<div class="oinv" data-field="showInvoiceNumber">Invoice # ${esc(o.invoice_number)}</div>`
          : '';
      const typeLine = typeBits.length ? `<div class="otype">${esc(typeBits.join(' · '))}</div>` : '';
      const band =
        onumLine || invLine || typeLine
          ? `<div class="orderband">${onumLine}${invLine}${typeLine}</div>`
          : '';
      // The big band already carries order no / invoice no / type / table, so
      // drop them from the meta table here to avoid repeating the same fields.
      const metaCfg = {
        ...cfg,
        showOrderNumber: false,
        showInvoiceNumber: false,
        showOrderType: false,
        showTableNumber: false,
      };
      return `
        <div class="order">
          ${multi ? brandBlockHtml(o, cfg) : ''}
          ${band}
          ${metaTableHtml(o, metaCfg)}
          ${itemsTableHtml(o, cfg, { item: 'Product', qty: 'Qty', rate: 'Rate', amount: 'Total' })}
          ${totalsHtml(o, cfg, money, 'Grand Total')}
        </div>`;
    })
    .join('<div class="rule"></div>');

  return `${bizHeaderHtml(data, cfg)}${ordersHtml}${grossTotalHtml(data, money)}${footerHtml(data, cfg)}`;
}

/**
 * "Bordered Logo Receipt" — Bordered Bill's top (normal centered logo, brand
 * name, fully bordered meta box) over Logo Receipt's body (underlined
 * Product | Qty | Rate | Total table and dash-framed totals). Logo Receipt's big
 * centered Order # band is deliberately dropped: the bordered meta box already
 * carries order no / invoice no / type / table, so the band would repeat them.
 */
function receiptBorderedLogoBody(
  data: InvoiceVM,
  cfg: InvoiceTemplateConfig,
  money: (n: unknown) => string,
): string {
  const multi = (data.orders?.length ?? 0) > 1;
  const ordersHtml = (data.orders ?? [])
    .map(
      (o) => `
        <div class="order">
          ${multi ? brandBlockHtml(o, cfg) : ''}
          ${metaTableHtml(o, cfg)}
          ${itemsTableHtml(o, cfg, { item: 'Product', qty: 'Qty', rate: 'Rate', amount: 'Total' })}
          ${totalsHtml(o, cfg, money, 'Grand Total')}
        </div>`,
    )
    .join('<div class="rule"></div>');
  return `${bizHeaderHtml(data, cfg)}${ordersHtml}${grossTotalHtml(data, money)}${footerHtml(data, cfg)}`;
}

/**
 * "Modern Minimal" — an original design: small centered logo, hairline rules,
 * uppercase letter-spaced section labels and airy borderless item rows. A clean,
 * boutique-café feel.
 */
function modernBody(
  data: InvoiceVM,
  cfg: InvoiceTemplateConfig,
  money: (n: unknown) => string,
): string {
  const multi = (data.orders?.length ?? 0) > 1;
  const ordersHtml = (data.orders ?? [])
    .map(
      (o) => `
        <div class="order">
          ${multi ? brandBlockHtml(o, cfg) : ''}
          ${metaTableHtml(o, cfg)}
          <div class="seclabel">Order</div>
          <div class="items">${itemsHtml(o, cfg, money)}</div>
          ${totalsHtml(o, cfg, money)}
        </div>`,
    )
    .join('<div class="rule"></div>');
  return `${bizHeaderHtml(data, cfg)}${ordersHtml}${grossTotalHtml(data, money)}${footerHtml(data, cfg)}`;
}

/**
 * "Classic Mono" — an original design: monospace face, ALL-CAPS store name and
 * double / dashed rules, the nostalgic dot-matrix POS receipt look.
 */
function classicMonoBody(
  data: InvoiceVM,
  cfg: InvoiceTemplateConfig,
  money: (n: unknown) => string,
): string {
  const multi = (data.orders?.length ?? 0) > 1;
  const ordersHtml = (data.orders ?? [])
    .map(
      (o) => `
        <div class="order">
          ${multi ? brandBlockHtml(o, cfg) : ''}
          ${metaTableHtml(o, cfg)}
          <div class="items">${itemsHtml(o, cfg, money)}</div>
          ${totalsHtml(o, cfg, money, 'TOTAL')}
        </div>`,
    )
    .join('<div class="rule"></div>');
  return `${bizHeaderHtml(data, cfg)}${ordersHtml}${grossTotalHtml(data, money)}${footerHtml(data, cfg)}`;
}

/** The original flexible-rows receipt body (thermal_58mm / a4_invoice). */
function classicBody(
  data: InvoiceVM,
  cfg: InvoiceTemplateConfig,
  money: (n: unknown) => string,
): string {
  const multi = (data.orders?.length ?? 0) > 1;
  const ordersHtml = (data.orders ?? [])
    .map(
      (o) => `
        <div class="order">
          ${multi ? brandBlockHtml(o, cfg) : ''}
          ${metaTableHtml(o, cfg)}
          <div class="items">${itemsHtml(o, cfg, money)}</div>
          ${totalsHtml(o, cfg, money)}
        </div>`,
    )
    .join('<div class="rule"></div>');
  return `${bizHeaderHtml(data, cfg)}${ordersHtml}${grossTotalHtml(data, money)}${footerHtml(data, cfg)}`;
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
  const body =
    layout === 'bill_bordered'
      ? billBorderedBody(data, cfg, money)
      : layout === 'receipt_logo'
        ? receiptLogoBody(data, cfg, money)
        : layout === 'receipt_bordered_logo'
          ? receiptBorderedLogoBody(data, cfg, money)
          : layout === 'thermal_modern'
            ? modernBody(data, cfg, money)
            : layout === 'thermal_classic'
              ? classicMonoBody(data, cfg, money)
              : classicBody(data, cfg, money);
  // Thermal receipts get a trailing "feed" spacer so the final line clears the
  // gap between the print head and the tear/cutter bar. Without it, printers
  // with a deeper gap (e.g. SPEED-X 300U) leave the last line stuck inside the
  // mechanism. The spacer ends in a printed dashed cut-line: drivers that trim
  // trailing BLANK paper before cutting (so a blank spacer has no effect) cannot
  // trim ink, so the printed line forces the paper to actually feed. Print-only
  // (see cutfeed CSS) so the on-screen preview is unaffected. 0mm = off.
  const feed =
    layout !== 'a4_invoice' && feedMmOf(cfg) > 0
      ? '<div class="cutfeed" aria-hidden="true"><span class="cutline"></span></div>'
      : '';
  const html = `<div class="inv-root inv-${layout}">${body}${feed}</div>`;
  return { html, css: cssFor(layout, cfg) };
}

/** Each layout's base font size in px at 100% scale. */
const LAYOUT_BASE_PX: Record<InvoiceLayout, number> = {
  bill_bordered: 11,
  receipt_logo: 11,
  receipt_bordered_logo: 11,
  thermal_modern: 11,
  thermal_classic: 12,
  thermal_58mm: 10,
  a4_invoice: 13,
};

const clampPct = (n: unknown, min = 50, max = 200): number =>
  Math.min(max, Math.max(min, Number(n) || 100));

/** Resolved trailing-feed height (mm) for the cut-clearance spacer. 0 = off. */
const feedMmOf = (cfg: InvoiceTemplateConfig): number =>
  Math.min(80, Math.max(0, Math.round(Number(cfg.bottomFeedMm ?? 22))));

function cssFor(layout: InvoiceLayout, cfg: InvoiceTemplateConfig): string {
  // Typography overrides append AFTER the layout skin so they beat any layout
  // rule (e.g. thermal_modern resets the meta labels back to weight 400).
  //
  // Info-box headings, footer, loyalty and discount lines default to EXACTLY
  // the info-box value column (weight 600, same size, full black) so they read
  // uniformly; the weight/size settings adjust each from there. Discounts also
  // drop the green accent here. Sizes are emitted in px (relative ems compound
  // — .foot .line would otherwise multiply .82em × .8em) and already include
  // fontScalePct.
  const rootPx = Math.round(LAYOUT_BASE_PX[layout] * (clampPct(cfg.fontScalePct) / 100) * 100) / 100;
  const metaValuePx = rootPx * 0.84; // .metatbl is .84em of the root
  const px = (pct: unknown) => Math.round(metaValuePx * (clampPct(pct) / 100) * 100) / 100;
  const weight = (w: unknown) => Math.min(900, Math.max(100, Math.round(Number(w) || 600)));
  const overrides = [
    `.inv-root .metatbl .mk { color: #000; font-weight: ${weight(cfg.metaLabelsFontWeight)}; font-size: ${px(cfg.metaLabelsFontPct)}px; }`,
    `.inv-root .foot .line { color: #000; font-weight: ${weight(cfg.footerFontWeight)}; font-size: ${px(cfg.footerFontPct)}px; }`,
    `.inv-root .loyalty { color: #000; font-weight: ${weight(cfg.loyaltyFontWeight)}; font-size: ${px(cfg.loyaltyFontPct)}px; }`,
    `.inv-root .row.disc, .inv-root .row.disc .l, .inv-root .row.disc .r { color: #000; font-weight: ${weight(cfg.discountFontWeight)}; font-size: ${px(cfg.discountFontPct)}px; }`,
    // QR prompt text ("Scan to download …"): defaults to the info-box value
    // column (black, weight 600, same size), independently adjustable.
    `.inv-root .qrblock .qr-text { color: #000; font-weight: ${weight(cfg.appQrTextFontWeight)}; font-size: ${px(cfg.appQrTextFontPct)}px; }`,
  ].join('\n    ');
  return `${layoutCss(layout, cfg)}\n    ${overrides}`;
}

function layoutCss(layout: InvoiceLayout, cfg: InvoiceTemplateConfig): string {
  const widthMm = LAYOUT_META[layout].widthMm;
  // Whole-receipt font scaling: everything else is sized in em, so scaling the
  // root px cascades. Powered-by gets its own size + weight for readability.
  const rootPx = Math.round(LAYOUT_BASE_PX[layout] * (clampPct(cfg.fontScalePct) / 100) * 100) / 100;
  const poweredPx = Math.round(rootPx * (clampPct(cfg.poweredByFontPct) / 100) * 100) / 100;
  const poweredWeight = cfg.poweredByBold ? 700 : 400;
  // Trailing feed (mm) so the last line clears the head-to-cutter gap; see cutfeed.
  const feedMm = feedMmOf(cfg);
  const base = `
    .inv-root { box-sizing: border-box; color: #000; background: #fff; margin: 0 auto; }
    .inv-root * { box-sizing: border-box; }
    .inv-root .head { text-align: center; margin-bottom: 8px; }
    .inv-root .logo { max-width: 120px; max-height: 90px; object-fit: contain; margin: 0 auto 6px; display: block; }
    .inv-root .biz { font-weight: 700; font-size: 1.05em; }
    .inv-root .biz-legal { font-weight: 600; }
    .inv-root .line { font-size: 0.82em; }
    .inv-root .note { margin-top: 4px; white-space: pre-line; }
    .inv-root .brandblk { text-align: center; margin: 8px 0 4px; }
    .inv-root .brandlogo { max-width: 64px; max-height: 48px; object-fit: contain; display: block; margin: 0 auto 2px; }
    .inv-root .brand { font-weight: 700; text-transform: uppercase; letter-spacing: .04em; margin: 2px 0; font-size: .9em; }
    /* Host print stylesheets (utils/print.ts) style bare th/td for report tables.
       Inside a receipt that bleeds in, and with border-collapse the damage is not
       cosmetic: a cell's border-bottom outranks the table's own border (cell beats
       table at equal width/style), so a boxed meta block lost its bottom edge to a
       near-white line that no thermal printer renders. Reset here — the layout
       blocks below are more specific and still draw their own borders. */
    .inv-root th, .inv-root td { border: 0; color: inherit; }
    .inv-root .metatbl { width: 100%; border-collapse: collapse; margin: 6px 0; font-size: .84em; }
    .inv-root .metatbl td { padding: 1px 0; vertical-align: top; }
    .inv-root .metatbl .mk { width: 38%; color: #333; padding-right: 8px; white-space: nowrap; }
    .inv-root .metatbl .mv { text-align: left; font-weight: 600; }
    .inv-root .row { display: flex; justify-content: space-between; gap: 8px; padding: 1px 0; }
    .inv-root .row .l { flex: 1; }
    .inv-root .row .r { white-space: nowrap; text-align: right; }
    .inv-root .row.sub .l, .inv-root .sub-l { padding-left: 10px; color: #444; font-size: .92em; }
    .inv-root .row.sub2 .l, .inv-root .sub2-l { padding-left: 22px; }
    .inv-root .cat { display: inline-block; font-size: .72em; text-transform: uppercase; color: #666; margin-right: 4px; }
    .inv-root .muted { color: #666; }
    .inv-root .items { border-top: 1px dashed #999; border-bottom: 1px dashed #999; padding: 6px 0; margin: 6px 0; }
    .inv-root .totals { margin-top: 4px; }
    .inv-root .row.disc { color: #000; }
    .inv-root .row.grand { border-top: 1px solid #000; margin-top: 4px; padding-top: 4px; font-size: 1.05em; }
    .inv-root .loyalty { margin-top: 4px; font-size: .85em; color: #333; }
    .inv-root .rule { border-top: 1px dashed #999; margin: 8px 0; }
    .inv-root .grandtotal { border-top: 2px solid #000; margin-top: 8px; padding-top: 6px; font-size: 1.1em; }
    .inv-root .foot { text-align: center; margin-top: 10px; font-size: .8em; color: #333; }
    .inv-root .foot .line { white-space: pre-line; }
    /* App-download QR: prompt text left, code right. Sits above the footer. */
    .inv-root .qrblock { display: flex; align-items: center; justify-content: space-between; gap: 10px; margin-top: 10px; padding-top: 6px; border-top: 1px dashed #999; }
    /* First footer block sits flush under the grand total (no loyalty line
       between): drop its own top rule so only the grand total's bolder rule shows. */
    .inv-root .qrblock.flush, .inv-root .fbrblock.flush { border-top: none; padding-top: 0; }
    .inv-root .qrblock .qr-text { text-align: left; flex: 1 1 auto; }
    .inv-root .qrblock .qr-img { flex: 0 0 auto; }
    .inv-root .qrblock .qr-img svg { display: block; width: 20mm; height: 20mm; }
    /* FBR fiscalization: logo (left, under the app-QR text) and verification QR
       (right, under the app QR) on one row, with the number line BELOW them. */
    .inv-root .fbrblock { margin-top: 8px; padding-top: 6px; border-top: 1px dashed #999; }
    .inv-root .fbrblock .fbr-row { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
    /* Logo sized to match the QR box (20mm square); object-fit keeps its aspect ratio. */
    .inv-root .fbrblock .fbr-logo { flex: 0 0 auto; width: 20mm; height: 20mm; object-fit: contain; display: block; }
    .inv-root .fbrblock .fbr-qr { flex: 0 0 auto; }
    .inv-root .fbrblock .fbr-qr svg { display: block; width: 20mm; height: 20mm; }
    .inv-root .fbrblock .fbr-head { text-align: center; font-weight: 700; margin-top: 6px; }
    .inv-root .fbrblock .fbr-num { font-weight: 700; white-space: nowrap; }
    .inv-root .powered { margin-top: 6px; color: #222; font-size: ${poweredPx}px; font-weight: ${poweredWeight}; }
    .inv-root .seclabel { text-transform: uppercase; letter-spacing: .12em; font-size: .72em; color: #555; margin: 8px 0 2px; }
    .inv-root .freelabel { margin-top: 8px; padding-top: 4px; border-top: 1px dashed #999; font-weight: 700; }
    .inv-root .itbl .freehead td { font-weight: 700; text-transform: uppercase; letter-spacing: .08em; font-size: .78em; color: #555; padding-top: 6px; }
    .inv-root .itbl { width: 100%; border-collapse: collapse; margin: 6px 0; }
    .inv-root .itbl th, .inv-root .itbl td { padding: 2px 3px; vertical-align: top; }
    .inv-root .itbl .ci { text-align: left; }
    .inv-root .itbl .cq { text-align: center; width: 26px; }
    .inv-root .itbl .cr { text-align: right; width: 48px; }
    .inv-root .itbl .ca { text-align: right; width: 54px; }
    .inv-root .itbl .ind { padding-left: 8px; display: inline-block; }
    .inv-root .itbl .ind2 { padding-left: 16px; display: inline-block; }
    .inv-root .cutfeed { height: 0; }
    .inv-root .cutfeed .cutline { display: none; }
    @media print {
      .inv-root .cutfeed { display: block; position: relative; height: ${feedMm}mm; }
      /* Printed ink at the very bottom of the feed zone: forces drivers that trim
         trailing blank paper (SPEED-X etc.) to feed the full ${feedMm}mm before cutting. */
      .inv-root .cutfeed .cutline { display: block; position: absolute; left: 0; right: 0; bottom: 0; border-top: 1px dashed #000; }
    }
  `;
  if (layout === 'bill_bordered') {
    return `${base}
      .inv-root.inv-bill_bordered { width: ${widthMm}mm; max-width: ${widthMm}mm; font-family: Arial, system-ui, sans-serif; font-size: ${rootPx}px; padding: 6px; }
      .inv-root.inv-bill_bordered .metatbl { border: 1px solid #000; padding: 4px 6px; }
      .inv-root.inv-bill_bordered .metatbl td { padding: 1px 4px; }
      .inv-root.inv-bill_bordered .itbl th, .inv-root.inv-bill_bordered .itbl td { border: 1px solid #000; }
      .inv-root.inv-bill_bordered .itbl th { font-weight: 700; }
      .inv-root.inv-bill_bordered .totals { width: 78%; margin-left: auto; }
      .inv-root.inv-bill_bordered .row.grand { font-size: 1.2em; }
      @page { size: ${widthMm}mm auto; margin: 0; }
    `;
  }
  if (layout === 'receipt_bordered_logo') {
    // Bordered Bill's meta box over Logo Receipt's table/totals treatment. The
    // logo and brand name keep the base sizes (Bordered Bill's top), so this
    // skin deliberately omits receipt_logo's oversized .logo / .biz rules.
    return `${base}
      .inv-root.inv-receipt_bordered_logo { width: ${widthMm}mm; max-width: ${widthMm}mm; font-family: Arial, system-ui, sans-serif; font-size: ${rootPx}px; padding: 6px; }
      .inv-root.inv-receipt_bordered_logo .metatbl { border: 1px solid #000; padding: 4px 6px; }
      .inv-root.inv-receipt_bordered_logo .metatbl td { padding: 1px 4px; }
      .inv-root.inv-receipt_bordered_logo .itbl th { border-bottom: 1px solid #000; font-weight: 700; }
      .inv-root.inv-receipt_bordered_logo .totals { border-top: 1px dashed #000; margin-top: 6px; padding-top: 4px; }
      .inv-root.inv-receipt_bordered_logo .row.grand { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; font-size: 1.2em; }
      .inv-root.inv-receipt_bordered_logo .foot { margin-top: 12px; }
      @page { size: ${widthMm}mm auto; margin: 0; }
    `;
  }
  if (layout === 'receipt_logo') {
    return `${base}
      .inv-root.inv-receipt_logo { width: ${widthMm}mm; max-width: ${widthMm}mm; font-family: Arial, system-ui, sans-serif; font-size: ${rootPx}px; padding: 6px; }
      .inv-root.inv-receipt_logo .logo { max-width: 170px; max-height: 130px; }
      .inv-root.inv-receipt_logo .biz { font-weight: 800; font-size: 1.5em; letter-spacing: .08em; text-transform: uppercase; }
      .inv-root.inv-receipt_logo .metatbl { border-top: 1px solid #000; padding-top: 6px; margin-top: 8px; }
      .inv-root.inv-receipt_logo .orderband { text-align: center; margin: 10px 0 4px; }
      .inv-root.inv-receipt_logo .onum { font-weight: 800; font-size: 1.35em; }
      .inv-root.inv-receipt_logo .oinv { font-weight: 700; font-size: 1em; }
      .inv-root.inv-receipt_logo .otype { font-weight: 600; font-size: .95em; }
      .inv-root.inv-receipt_logo .itbl th { border-bottom: 1px solid #000; font-weight: 700; }
      .inv-root.inv-receipt_logo .totals { border-top: 1px dashed #000; margin-top: 6px; padding-top: 4px; }
      .inv-root.inv-receipt_logo .row.grand { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; font-size: 1.2em; }
      .inv-root.inv-receipt_logo .foot { margin-top: 12px; }
      @page { size: ${widthMm}mm auto; margin: 0; }
    `;
  }
  if (layout === 'thermal_modern') {
    return `${base}
      .inv-root.inv-thermal_modern { width: ${widthMm}mm; max-width: ${widthMm}mm; font-family: 'Helvetica Neue', Arial, system-ui, sans-serif; font-size: ${rootPx}px; padding: 8px; line-height: 1.5; }
      .inv-root.inv-thermal_modern .logo { max-width: 80px; max-height: 60px; }
      .inv-root.inv-thermal_modern .biz { font-weight: 400; font-size: 1.35em; letter-spacing: .18em; text-transform: uppercase; }
      .inv-root.inv-thermal_modern .metatbl { margin: 10px 0; }
      .inv-root.inv-thermal_modern .metatbl .mk { color: #666; font-weight: 400; }
      .inv-root.inv-thermal_modern .items { border-top: 1px solid #222; border-bottom: 1px solid #222; padding: 8px 0; }
      .inv-root.inv-thermal_modern .row { padding: 2px 0; }
      .inv-root.inv-thermal_modern .row .l { font-weight: 500; }
      .inv-root.inv-thermal_modern .row.grand { border-top: none; margin-top: 8px; padding-top: 4px; font-size: 1.25em; font-weight: 700; letter-spacing: .04em; }
      .inv-root.inv-thermal_modern .totals { margin-top: 8px; }
      @page { size: ${widthMm}mm auto; margin: 0; }
    `;
  }
  if (layout === 'thermal_classic') {
    return `${base}
      .inv-root.inv-thermal_classic { width: ${widthMm}mm; max-width: ${widthMm}mm; font-family: 'Courier New', ui-monospace, monospace; font-size: ${rootPx}px; padding: 6px; }
      .inv-root.inv-thermal_classic .biz { font-size: 1.2em; text-transform: uppercase; letter-spacing: .05em; }
      .inv-root.inv-thermal_classic .line { font-size: .85em; }
      .inv-root.inv-thermal_classic .metatbl { border-top: 1px dashed #000; border-bottom: 1px dashed #000; padding: 4px 0; }
      .inv-root.inv-thermal_classic .metatbl .mk { color: #000; }
      .inv-root.inv-thermal_classic .items { border-top: 2px double #000; border-bottom: 2px double #000; padding: 5px 0; }
      .inv-root.inv-thermal_classic .row.grand { border-top: 1px dashed #000; font-weight: 700; text-transform: uppercase; }
      .inv-root.inv-thermal_classic .grandtotal { border-top: 2px double #000; }
      @page { size: ${widthMm}mm auto; margin: 0; }
    `;
  }
  if (layout === 'thermal_58mm') {
    return `${base}
      .inv-root.inv-thermal_58mm { width: ${widthMm}mm; max-width: ${widthMm}mm; font-family: 'Courier New', ui-monospace, monospace; font-size: ${rootPx}px; padding: 6px; }
      .inv-root.inv-thermal_58mm .metatbl .mk { width: 42%; }
      @page { size: ${widthMm}mm auto; margin: 0; }
    `;
  }
  return `${base}
    .inv-root.inv-a4_invoice { width: 190mm; max-width: 190mm; font-family: system-ui, -apple-system, sans-serif; font-size: ${rootPx}px; padding: 12mm; }
    .inv-root.inv-a4_invoice .items { border-color: #ccc; }
    .inv-root.inv-a4_invoice .row.grand { font-size: 1.15em; }
    @page { size: A4; margin: 12mm; }
    @media print { .inv-root.inv-a4_invoice { padding: 0; width: auto; max-width: none; } }
  `;
}

/** Minimal sample for unit tests / simple checks. */
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
        order_number: '023',
        invoice_number: 'FDS-B4T7WQ2N',
        brand_name: 'Fireaway',
        brand_logo_url: null,
        order_type: 'dine_in',
        table_number: '7',
        placed_at: '2026-07-08T12:30:00Z',
        customer_name: 'Ali Khan',
        customer_phone: '+92 301 7654321',
        payment_method: 'card',
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

/**
 * A deliberately maximal order for the admin template preview: variants, add-ons,
 * flat and conditional-nested modifiers, a multi-component deal, item + order
 * notes, every discount stage, service charge, tax and loyalty — so the preview
 * exercises every field a template can render.
 */
export function richSampleInvoice(): InvoiceVM {
  return {
    order_group_id: 'preview-rich',
    currency: 'PKR',
    header: {
      legal_name: 'Foodies Restaurant (Pvt) Ltd',
      tenant_name: 'Foodies',
      branch_name: 'Bahria Town Branch',
      address: 'Shop 12, Civic Center, Bahria Town, Lahore',
      phone: '+92 42 111 666 333',
      email: null,
    },
    orders: [
      {
        order_id: 481,
        order_number: '014',
        invoice_number: 'FDS-A7K2M9QX',
        // Sample fiscal number so the designer's "Show FBR invoice # + QR"
        // toggle has something to preview.
        fbr_invoice_number: '515011DDD1287011250929',
        fbr_number_source: 'fbr',
        brand_name: 'Fireaway',
        brand_logo_url: null, // preview uses the Foodies fallback mark
        order_type: 'dine_in',
        table_number: '14',
        placed_at: '2026-07-09T17:30:00Z',
        customer_name: 'Ayesha Malik',
        customer_phone: '+92 301 7654321',
        cashier_name: 'Bilal',
        payment_method: 'cash + card',
        notes: 'Birthday — please add candles',
        items: [
          {
            name_snapshot: 'Build Your Own Pizza',
            category: 'Pizza',
            variant_name: 'Large 13"',
            quantity: 1,
            unit_price: 1499,
            subtotal: 1499,
            notes: 'Well done, extra crispy',
            addons: [{ name: 'Garlic Dip', quantity: 2, unit_price: 60, subtotal: 120 }],
            modifiers: [
              { group: 'Base', name: 'Classic Hand-Tossed', unit_price: 0 },
              { group: 'Sauce', name: 'Smoky BBQ', unit_price: 0 },
              { group: 'Extra Toppings', name: 'Grilled Chicken', unit_price: 250, quantity: 1 },
              // Picked twice with one included by the group allowance: bills 1 × 120.
              { group: 'Extra Toppings', name: 'Jalapeños', unit_price: 120, quantity: 2, free_quantity: 1 },
              { group: 'Make it a Meal', name: 'Add a 345ml Drink', unit_price: 150 },
              {
                group: 'Choose your Drink',
                name: 'Mint Margarita',
                unit_price: 100,
                triggered_by: 'Add a 345ml Drink',
              },
            ],
          },
          {
            name_snapshot: 'Peri Peri Wings',
            category: 'Starters',
            variant_name: '8 pcs',
            quantity: 2,
            unit_price: 649,
            subtotal: 1298,
          },
          {
            name_snapshot: 'Family Feast Deal',
            deal_id: 900,
            deal_slot_index: 0,
            deal_name: 'Family Feast Deal',
            quantity: 1,
            unit_price: 2999,
            subtotal: 2999,
          },
          {
            name_snapshot: 'Large Pepperoni Pizza',
            variant_name: 'Large',
            deal_id: 900,
            deal_slot_index: 1,
            deal_name: 'Family Feast Deal',
            quantity: 1,
            unit_price: 0,
            subtotal: 0,
          },
          {
            name_snapshot: 'Garlic Bread',
            deal_id: 900,
            deal_slot_index: 2,
            deal_name: 'Family Feast Deal',
            quantity: 1,
            unit_price: 0,
            subtotal: 0,
          },
          {
            name_snapshot: '1.5L Soft Drink',
            deal_id: 900,
            deal_slot_index: 3,
            deal_name: 'Family Feast Deal',
            quantity: 1,
            unit_price: 0,
            subtotal: 0,
            notes: 'Diet, please',
          },
        ],
        subtotal: 6536,
        discount_amount: 1180,
        promo_discount_amount: 590,
        order_discount_amount: 295,
        coupon_discount_amount: 200,
        card_discount_amount: 95,
        discount_code: 'FIREAWAY20',
        tax_amount: 268,
        tax_rate: 0.05,
        service_charge: 150,
        delivery_fee: 0,
        total_amount: 5774,
        loyalty_points_earned: 57,
        loyalty_points_redeemed: 120,
        loyalty_points_remaining: 380,
      },
    ],
    gross_total: 5774,
    loyalty_points_remaining: 380,
  };
}
