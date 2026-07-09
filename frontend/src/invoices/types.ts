/**
 * Frontend mirror of the backend invoice template contract
 * (backend/src/invoices/invoice-template-config.ts). Keep in sync.
 */

export type InvoiceLayout = 'thermal_80mm' | 'thermal_58mm' | 'a4_invoice';

export const LAYOUT_META: Record<
  InvoiceLayout,
  { label: string; widthMm: number; description: string }
> = {
  thermal_80mm: { label: 'Thermal 80mm', widthMm: 80, description: 'Standard receipt printer' },
  thermal_58mm: { label: 'Thermal 58mm', widthMm: 58, description: 'Compact receipt printer' },
  a4_invoice: { label: 'A4 Invoice', widthMm: 210, description: 'Full-page printed invoice' },
};

export interface InvoiceTemplateConfig {
  showLogo: boolean;
  logoUrl: string | null;
  headerText: string | null;
  footerText: string | null;
  showPoweredBy: boolean;

  showCategory: boolean;
  showVariant: boolean;
  showModifiers: boolean;
  showItemNotes: boolean;
  showUnitPrice: boolean;

  showSubtotal: boolean;
  showTax: boolean;
  showTaxRate: boolean;
  showServiceCharge: boolean;
  showDeliveryFee: boolean;
  taxLabel: string | null;

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
  showOrderType: boolean;
  showTableNumber: boolean;
  showDateTime: boolean;
  showCashier: boolean;
  showCustomerInfo: boolean;
}

export const DEFAULT_INVOICE_TEMPLATE_CONFIG: InvoiceTemplateConfig = {
  showLogo: true,
  logoUrl: null,
  headerText: null,
  footerText: null,
  showPoweredBy: true,

  showCategory: false,
  showVariant: true,
  showModifiers: true,
  showItemNotes: false,
  showUnitPrice: true,

  showSubtotal: true,
  showTax: true,
  showTaxRate: false,
  showServiceCharge: true,
  showDeliveryFee: true,
  taxLabel: 'Tax',

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
  showOrderType: true,
  showTableNumber: true,
  showDateTime: true,
  showCashier: false,
  showCustomerInfo: true,
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
      { key: 'showItemNotes', label: 'Show item notes' },
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
      { key: 'showOrderType', label: 'Show order type' },
      { key: 'showTableNumber', label: 'Show table number' },
      { key: 'showDateTime', label: 'Show date / time' },
      { key: 'showCashier', label: 'Show cashier' },
      { key: 'showCustomerInfo', label: 'Show customer info' },
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
  modifiers?: Array<{ name?: string | null; unit_price: number; group?: string | null; triggered_by?: string | null }>;
};

export type InvoiceOrderVM = {
  order_id: number;
  order_number: string;
  brand_name?: string | null;
  brand_logo_url?: string | null;
  order_type?: string | null;
  table_number?: string | null;
  placed_at?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  cashier_name?: string | null;
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
