/**
 * Invoice template config — the per-schema field toggles. Stored as a JSON blob
 * on invoice_templates.config and merged over DEFAULT_INVOICE_TEMPLATE_CONFIG on
 * read (null stored config => defaults, so existing tenants are unaffected).
 * Mirrors the offer-settings idiom. Keep in sync with the frontend copy in
 * frontend/src/invoices/types.ts.
 */

export type InvoiceLayout = 'thermal_80mm' | 'thermal_58mm' | 'a4_invoice';

export const INVOICE_LAYOUTS: InvoiceLayout[] = [
  'thermal_80mm',
  'thermal_58mm',
  'a4_invoice',
];

export interface InvoiceTemplateConfig {
  // Branding / chrome
  showLogo: boolean;
  /** Override logo URL; null = fall back to the order's brand logo, then tenant. */
  logoUrl: string | null;
  /** Free text under the logo (legal name, address, tax reg #). */
  headerText: string | null;
  /** Free text at the bottom (thank-you note, return policy). */
  footerText: string | null;
  /** "Powered by Rex Technologies" line at the very end. */
  showPoweredBy: boolean;

  // Line items
  showCategory: boolean;
  showVariant: boolean;
  showModifiers: boolean;
  showItemNotes: boolean;
  showOrderNotes: boolean;
  showUnitPrice: boolean;

  // Totals & charges
  showSubtotal: boolean;
  showTax: boolean;
  showTaxRate: boolean;
  showServiceCharge: boolean;
  showDeliveryFee: boolean;
  /** Label for the tax line (e.g. "GST", "VAT", "Sales Tax"). */
  taxLabel: string | null;

  // Discounts
  showDiscountTotal: boolean;
  showPromoDiscount: boolean;
  showOrderDiscount: boolean;
  showCouponDiscount: boolean;
  showCardDiscount: boolean;
  showDiscountName: boolean;

  // Loyalty
  showLoyaltyEarned: boolean;
  showLoyaltyRedeemed: boolean;
  showLoyaltyBalance: boolean;

  // Meta
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
  showItemNotes: true,
  showOrderNotes: true,
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

/** Merge stored config over defaults; unknown/missing keys fall back to default. */
export function resolveInvoiceTemplateConfig(
  raw: Partial<InvoiceTemplateConfig> | null | undefined,
): InvoiceTemplateConfig {
  return { ...DEFAULT_INVOICE_TEMPLATE_CONFIG, ...(raw ?? {}) };
}

/** Keep only known keys with the right primitive type (strip junk before persisting). */
export function sanitizeInvoiceTemplateConfig(
  raw: unknown,
): Partial<InvoiceTemplateConfig> {
  if (raw == null || typeof raw !== 'object') return {};
  const src = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [key, def] of Object.entries(DEFAULT_INVOICE_TEMPLATE_CONFIG)) {
    if (!(key in src)) continue;
    const val = src[key];
    if (typeof def === 'boolean' && typeof val === 'boolean') out[key] = val;
    else if (
      (key === 'logoUrl' ||
        key === 'headerText' ||
        key === 'footerText' ||
        key === 'taxLabel') &&
      (typeof val === 'string' || val === null)
    )
      out[key] = val === '' ? null : val;
  }
  return out as Partial<InvoiceTemplateConfig>;
}
