/**
 * Frontend mirror of the backend invoice template contract
 * (backend/src/invoices/invoice-template-config.ts). Keep in sync.
 */

export type InvoiceLayout =
  | 'bill_bordered'
  | 'receipt_logo'
  | 'receipt_bordered_logo'
  | 'thermal_modern'
  | 'thermal_classic'
  | 'thermal_58mm'
  | 'a4_invoice';

export const LAYOUT_META: Record<
  InvoiceLayout,
  { label: string; widthMm: number; description: string }
> = {
  bill_bordered: {
    label: 'Bordered Bill · 80mm',
    widthMm: 80,
    description: 'Dine-in bill: bordered Item/Qty/Rate/Amount table, tabular header',
  },
  receipt_logo: {
    label: 'Logo Receipt · 80mm',
    widthMm: 80,
    description: 'Takeaway: big brand logo, large Order # band, thank-you footer',
  },
  receipt_bordered_logo: {
    label: 'Bordered Logo Receipt · 80mm',
    widthMm: 80,
    description: "Bordered Bill's logo header and meta box, with Logo Receipt's item table and totals",
  },
  thermal_modern: {
    label: 'Modern Minimal · 80mm',
    widthMm: 80,
    description: 'Clean, airy, uppercase section labels — a boutique-café feel',
  },
  thermal_classic: {
    label: 'Classic Mono · 80mm',
    widthMm: 80,
    description: 'Monospace, double/dashed rules — the traditional POS receipt',
  },
  thermal_58mm: { label: 'Compact · 58mm', widthMm: 58, description: 'Narrow 58mm thermal roll' },
  a4_invoice: { label: 'A4 Invoice', widthMm: 210, description: 'Full-page printed invoice' },
};

export interface InvoiceTemplateConfig {
  showLogo: boolean;
  headerText: string | null;
  footerText: string | null;
  /**
   * Print the SELLING BRANCH's own name and address in the footer, read from the
   * branch record rather than typed into Footer Text. Off by default so a
   * template that already spells one branch's address into Footer Text does not
   * print it twice.
   */
  showBranchAddress: boolean;
  /**
   * Contact number beside the app-download QR, e.g. a delivery UAN. Empty
   * prints nothing, so entering a number IS switching it on.
   */
  uanText: string | null;
  /** Wording before the number — empty prints the number alone. */
  uanLabel: string | null;
  /** Show the app-download QR (+ its text) above the footer. */
  showAppQr: boolean;
  /** Text shown to the left of the app-download QR (empty = QR only). */
  appQrText: string | null;
  /** Weight (100–900) and size (% of info-box values) of the app-QR text. */
  appQrTextFontWeight: number;
  appQrTextFontPct: number;
  /**
   * FBR fiscalization block below the app-QR row: the tax-authority logo (left)
   * and the verification QR (right), then the "FBR Invoice #" line beneath
   * them. Only prints when the order actually carries an FBR number, so leaving
   * this on is harmless for branches without FBR.
   */
  showFbrInvoice: boolean;
  /**
   * Custom logo for the FBR block (absolute image URL). Empty/null → the
   * bundled default (public/PRA.jpg). Lets an admin swap the tax-authority mark
   * per template without a code change.
   */
  fbrLogoUrl: string | null;
  fontScalePct: number;
  showPoweredBy: boolean;
  poweredByFontPct: number;
  poweredByBold: boolean;
  /** Extra blank paper (mm) fed after the last line on thermal receipts so it
   *  clears the print-head-to-cutter gap. 0–80, print-only, A4 ignores it. */
  bottomFeedMm: number;

  showCategory: boolean;
  showVariant: boolean;
  showModifiers: boolean;
  /** The modifier group name prefix, e.g. "Base: " on "Base: Classic Hand-Tossed". */
  showModifierGroup: boolean;
  /** The leading "+ " on add-on and modifier lines. */
  showModifierPlus: boolean;
  /** Per-item notes (kitchen instructions) printed under the item. */
  showLineNotes: boolean;
  showUnitPrice: boolean;
  /**
   * Where a deal's price prints: 'both' = deal name line + component lines,
   * 'deal_only' = only the deal name, 'items_only' = only the components.
   */
  dealPriceDisplay: 'both' | 'deal_only' | 'items_only';
  /**
   * How a zero amount prints on modifier / add-on / deal-component lines:
   * 'zero' → "0.00", 'included' → the word "Included", 'blank' → empty cell.
   */
  zeroAmountDisplay: 'zero' | 'included' | 'blank';
  /**
   * Whether zero-total lines (freebies, deal components) print at all. On →
   * they list under a "Free items" section after the paid items; off → they
   * are omitted from the receipt entirely.
   */
  showFreeItems: boolean;
  /**
   * Where a deal's zero-priced components print. Off → they are zero-total
   * lines like any other, so `showFreeItems` decides whether they appear in
   * the "Free items" section or vanish. On → they stay nested under their
   * deal header (priced per `dealPriceDisplay`) and never reach that section:
   * a side or drink chosen inside a deal is part of what the customer paid
   * for, not a giveaway, and the kitchen needs it listed with its deal.
   */
  nestDealComponents: boolean;

  showSubtotal: boolean;
  showTax: boolean;
  showTaxRate: boolean;
  showServiceCharge: boolean;
  showDeliveryFee: boolean;

  showDiscountTotal: boolean;
  showPromoDiscount: boolean;
  showOrderDiscount: boolean;
  showCouponDiscount: boolean;
  showCardDiscount: boolean;

  showStaffDiscount: boolean;
  showDiscountName: boolean;
  /** Discount-line typography; defaults match the info-box value column (black, weight 600, same size). */
  discountFontWeight: number;
  discountFontPct: number;

  showLoyaltyEarned: boolean;
  showLoyaltyRedeemed: boolean;
  showLoyaltyBalance: boolean;

  showOrderNumber: boolean;
  showInvoiceNumber: boolean;
  showOrderType: boolean;
  showTableNumber: boolean;
  /**
   * How the table number prints (when shown): its normal meta row, that row
   * with the value enlarged, or a big centered "TABLE N" band under the
   * header — plain or white-on-black for maximum pop on thermal paper.
   */
  tableNumberDisplay: 'row' | 'row_large' | 'banner' | 'banner_inverted';
  showDateTime: boolean;
  showCashier: boolean;
  showCustomerInfo: boolean;
  /** The order-level note (e.g. "Birthday — add candles") printed in the header block. */
  showOrderNotes: boolean;
  showPaymentMethod: boolean;
  /**
   * Info-box heading (Order #, Type, Table …) typography. Defaults match the
   * value column exactly (weight 600, same size), so both columns print
   * identically unless overridden.
   */
  metaLabelsFontWeight: number;
  /** Heading size, percent of the info-box value size (100 = identical). */
  metaLabelsFontPct: number;
  /** Footer text typography; defaults match the info-box value column. */
  footerFontWeight: number;
  footerFontPct: number;
  /** Loyalty / points lines typography; defaults match the info-box value column. */
  loyaltyFontWeight: number;
  loyaltyFontPct: number;
}

export const DEFAULT_INVOICE_TEMPLATE_CONFIG: InvoiceTemplateConfig = {
  showLogo: true,
  headerText: null,
  footerText: null,
  showBranchAddress: false,
  uanText: null,
  uanLabel: 'For delivery, call',
  showAppQr: false,
  appQrText: 'Scan to download the Foodies app',
  appQrTextFontWeight: 600,
  appQrTextFontPct: 100,
  showFbrInvoice: true,
  fbrLogoUrl: null,
  fontScalePct: 100,
  showPoweredBy: true,
  poweredByFontPct: 95,
  poweredByBold: false,
  bottomFeedMm: 22,

  showCategory: false,
  showVariant: true,
  showModifiers: true,
  showModifierGroup: true,
  showModifierPlus: true,
  showLineNotes: false,
  showUnitPrice: true,
  dealPriceDisplay: 'both',
  zeroAmountDisplay: 'zero',
  showFreeItems: true,
  // Off by default: existing templates keep printing exactly what they print
  // today until someone switches this on.
  nestDealComponents: false,

  showSubtotal: true,
  showTax: true,
  showTaxRate: false,
  showServiceCharge: true,
  showDeliveryFee: true,

  showDiscountTotal: true,
  showPromoDiscount: false,
  showOrderDiscount: false,
  showCouponDiscount: false,
  showCardDiscount: false,

  showStaffDiscount: false,
  showDiscountName: true,
  discountFontWeight: 600,
  discountFontPct: 100,

  showLoyaltyEarned: true,
  showLoyaltyRedeemed: true,
  showLoyaltyBalance: false,

  showOrderNumber: true,
  showInvoiceNumber: true,
  showOrderType: true,
  showTableNumber: true,
  tableNumberDisplay: 'row',
  showDateTime: true,
  showCashier: false,
  showCustomerInfo: true,
  showOrderNotes: false,
  showPaymentMethod: true,
  metaLabelsFontWeight: 600,
  metaLabelsFontPct: 100,
  footerFontWeight: 600,
  footerFontPct: 100,
  loyaltyFontWeight: 600,
  loyaltyFontPct: 100,
};

export function resolveInvoiceConfig(
  raw: Partial<InvoiceTemplateConfig> | null | undefined,
): InvoiceTemplateConfig {
  return { ...DEFAULT_INVOICE_TEMPLATE_CONFIG, ...(raw ?? {}) };
}

/** Field toggle groups for the admin UI. */
export const INVOICE_TOGGLE_GROUPS: Array<{
  title: string;
  items: Array<{ key: keyof InvoiceTemplateConfig; label: string }>;
}> = [
  {
    title: 'Line items',
    items: [
      { key: 'showCategory', label: 'Show category' },
      { key: 'showVariant', label: 'Show variant' },
      { key: 'showModifiers', label: 'Show modifiers / add-ons' },
      { key: 'showModifierGroup', label: 'Show modifier group name (e.g. “Base:”)' },
      { key: 'showModifierPlus', label: 'Show “+” before modifiers / add-ons' },
      { key: 'showUnitPrice', label: 'Show unit price' },
      { key: 'showFreeItems', label: 'Show free items (zero-priced lines)' },
      {
        key: 'nestDealComponents',
        label: 'Show deal components under their deal (not in “Free items”)',
      },
      { key: 'showLineNotes', label: 'Show item notes' },
    ],
  },
  {
    title: 'Totals & charges',
    items: [
      { key: 'showSubtotal', label: 'Show subtotal' },
      { key: 'showTax', label: 'Show tax' },
      { key: 'showTaxRate', label: 'Show tax rate (%)' },
      { key: 'showServiceCharge', label: 'Show service charge' },
      { key: 'showDeliveryFee', label: 'Show delivery fee' },
    ],
  },
  {
    title: 'Discounts',
    items: [
      { key: 'showDiscountTotal', label: 'Show total discount' },
      { key: 'showPromoDiscount', label: 'Show promotional discount' },
      { key: 'showOrderDiscount', label: 'Show order discount' },
      { key: 'showCouponDiscount', label: 'Show coupon discount' },
      { key: 'showCardDiscount', label: 'Show card / bank discount' },
      { key: 'showStaffDiscount', label: 'Show staff discount' },
      { key: 'showDiscountName', label: 'Show discount / coupon code' },
    ],
  },
  {
    title: 'Loyalty',
    items: [
      { key: 'showLoyaltyEarned', label: 'Show points earned' },
      { key: 'showLoyaltyRedeemed', label: 'Show points redeemed' },
      { key: 'showLoyaltyBalance', label: 'Show points balance' },
    ],
  },
  {
    title: 'Meta',
    items: [
      { key: 'showOrderNumber', label: 'Show order number' },
      { key: 'showInvoiceNumber', label: 'Show invoice number' },
      { key: 'showOrderType', label: 'Show order type' },
      { key: 'showTableNumber', label: 'Show table number' },
      { key: 'showDateTime', label: 'Show date / time' },
      { key: 'showCashier', label: 'Show cashier' },
      { key: 'showCustomerInfo', label: 'Show customer info' },
      { key: 'showPaymentMethod', label: 'Show payment method' },
      { key: 'showOrderNotes', label: 'Show order notes' },
    ],
  },
  {
    title: 'Branding',
    items: [
      { key: 'showLogo', label: 'Show logo' },
      { key: 'showBranchAddress', label: "Show the branch's own name + address in the footer" },
      { key: 'showAppQr', label: 'Show app-download QR' },
      { key: 'showFbrInvoice', label: 'Show FBR invoice # + QR' },
      { key: 'showPoweredBy', label: 'Show "Powered by Rex Technologies"' },
    ],
  },
];

export type InvoiceLineVM = {
  name_snapshot?: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  variant_name?: string | null;
  category?: string | null;
  notes?: string | null;
  deal_id?: number | null;
  deal_slot_index?: number | null;
  deal_name?: string | null;
  addons?: Array<{ name?: string | null; quantity: number; unit_price: number; subtotal?: number }>;
  /**
   * quantity/free_quantity mirror order_item_modifiers: the group's included
   * allowance (first-N-free) is billed as (quantity - free_quantity) units.
   * Both optional — older payloads omit them and fall back to a single unit.
   */
  modifiers?: Array<{
    name?: string | null;
    unit_price: number;
    group?: string | null;
    triggered_by?: string | null;
    quantity?: number;
    free_quantity?: number;
  }>;
};

export type InvoiceOrderVM = {
  order_id: number;
  order_number: string;
  /** Permanent globally-unique reference (FDS-XXXXXXXX; legacy orders BR-…) used as the invoice number. Opaque — never parse it. */
  invoice_number?: string | null;
  /** FBR fiscal invoice number to print (with its verification QR). */
  fbr_invoice_number?: string | null;
  /** 'fbr' = FBR issued it for this order; 'fallback' = branch's last real number reused (FBR off/down). */
  fbr_number_source?: string | null;
  brand_name?: string | null;
  brand_logo_url?: string | null;
  order_type?: string | null;
  table_number?: string | null;
  notes?: string | null;
  placed_at?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  cashier_name?: string | null;
  payment_method?: string | null;
  items: InvoiceLineVM[];
  subtotal: number;
  discount_amount: number;
  promo_discount_amount?: number;
  order_discount_amount?: number;
  coupon_discount_amount?: number;
  card_discount_amount?: number;
  staff_discount_amount?: number;
  discount_code?: string | null;
  tax_amount: number;
  tax_rate?: number | null;
  service_charge: number;
  delivery_fee: number;
  total_amount: number;
  loyalty_points_earned?: number;
  loyalty_points_redeemed?: number;
  loyalty_points_remaining?: number;
};

export type InvoiceHeaderVM = {
  legal_name?: string | null;
  tenant_name?: string | null;
  branch_name?: string | null;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
};

export type InvoiceVM = {
  order_group_id: string;
  orders: InvoiceOrderVM[];
  gross_total: number;
  loyalty_points_remaining?: number;
  currency?: string | null;
  header?: InvoiceHeaderVM;
  template?: { id: number | null; layout: InvoiceLayout; config: Partial<InvoiceTemplateConfig> };
};
