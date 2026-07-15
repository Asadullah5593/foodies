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
  showUnitPrice: boolean;

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
  showDiscountName: boolean;

  showLoyaltyEarned: boolean;
  showLoyaltyRedeemed: boolean;
  showLoyaltyBalance: boolean;

  showOrderNumber: boolean;
  showInvoiceNumber: boolean;
  showOrderType: boolean;
  showTableNumber: boolean;
  showDateTime: boolean;
  showCashier: boolean;
  showCustomerInfo: boolean;
  showPaymentMethod: boolean;
}

export const DEFAULT_INVOICE_TEMPLATE_CONFIG: InvoiceTemplateConfig = {
  showLogo: true,
  headerText: null,
  footerText: null,
  fontScalePct: 100,
  showPoweredBy: true,
  poweredByFontPct: 95,
  poweredByBold: false,
  bottomFeedMm: 22,

  showCategory: false,
  showVariant: true,
  showModifiers: true,
  showUnitPrice: true,

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
  showDiscountName: true,

  showLoyaltyEarned: true,
  showLoyaltyRedeemed: true,
  showLoyaltyBalance: false,

  showOrderNumber: true,
  showInvoiceNumber: true,
  showOrderType: true,
  showTableNumber: true,
  showDateTime: true,
  showCashier: false,
  showCustomerInfo: true,
  showPaymentMethod: true,
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
      { key: 'showUnitPrice', label: 'Show unit price' },
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
    ],
  },
  {
    title: 'Branding',
    items: [
      { key: 'showLogo', label: 'Show logo' },
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
  /** Permanent globally-unique reference (BR-…) used as the invoice number. */
  invoice_number?: string | null;
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
