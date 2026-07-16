/**
 * Invoice template config — the per-schema field toggles. Stored as a JSON blob
 * on invoice_templates.config and merged over DEFAULT_INVOICE_TEMPLATE_CONFIG on
 * read (null stored config => defaults, so existing tenants are unaffected).
 * Mirrors the offer-settings idiom. Keep in sync with the frontend copy in
 * frontend/src/invoices/types.ts.
 */

export type InvoiceLayout =
    | 'bill_bordered'
    | 'receipt_logo'
    | 'receipt_bordered_logo'
    | 'thermal_modern'
    | 'thermal_classic'
    | 'thermal_58mm'
    | 'a4_invoice';

export const INVOICE_LAYOUTS: InvoiceLayout[] = [
    'bill_bordered',
    'receipt_logo',
    'receipt_bordered_logo',
    'thermal_modern',
    'thermal_classic',
    'thermal_58mm',
    'a4_invoice',
];

export interface InvoiceTemplateConfig {
    // Branding / chrome
    showLogo: boolean;
    /** Free text under the logo (legal name, address, tax reg #). */
    headerText: string | null;
    /** Free text at the bottom (thank-you note, return policy). */
    footerText: string | null;
    /** Overall receipt font size, percent of the template's base (50–200). */
    fontScalePct: number;
    /** "Powered by Rex Technologies" line at the very end. */
    showPoweredBy: boolean;
    /** Size of the "powered by" line, percent of the base font (50–200). */
    poweredByFontPct: number;
    /** Bold the "powered by" line. */
    poweredByBold: boolean;
    /**
     * Extra blank paper (mm) fed after the last line on thermal receipts, so it
     * clears the print-head-to-cutter/tear-bar gap. Printers with a deeper gap
     * (e.g. SPEED-X 300U) need a larger value or the final line is cut off. 0–80,
     * print-only. Ignored by the A4 layout.
     */
    bottomFeedMm: number;

    // Line items
    showCategory: boolean;
    showVariant: boolean;
    showModifiers: boolean;
    showUnitPrice: boolean;
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

    // Totals & charges
    showSubtotal: boolean;
    showTax: boolean;
    showTaxRate: boolean;
    showServiceCharge: boolean;
    showDeliveryFee: boolean;

    // Discounts
    showDiscountTotal: boolean;
    showPromoDiscount: boolean;
    showOrderDiscount: boolean;
    showCouponDiscount: boolean;
    showCardDiscount: boolean;
    showDiscountName: boolean;
    /** Bold the discount-line headings in the totals block. */
    discountLabelsBold: boolean;

    // Loyalty
    showLoyaltyEarned: boolean;
    showLoyaltyRedeemed: boolean;
    showLoyaltyBalance: boolean;

    // Meta
    showOrderNumber: boolean;
    /** Permanent invoice reference (order's globally-unique ref), under the order number. */
    showInvoiceNumber: boolean;
    showOrderType: boolean;
    showTableNumber: boolean;
    showDateTime: boolean;
    showCashier: boolean;
    showCustomerInfo: boolean;
    /** Method of payment (cash / card / split) — shown when the order has recorded tenders. */
    showPaymentMethod: boolean;
    /** Bold the info-box headings (Order #, Type, Table, Date, Customer …). */
    metaLabelsBold: boolean;
    /** Bold the footer text line. */
    footerBold: boolean;
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
    zeroAmountDisplay: 'zero',
    showFreeItems: true,

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
    discountLabelsBold: false,

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
    metaLabelsBold: false,
    footerBold: false,
};

/** Numeric config keys and their clamp ranges (percent). */
const NUMERIC_KEYS: Record<string, { min: number; max: number }> = {
    fontScalePct: { min: 50, max: 200 },
    poweredByFontPct: { min: 50, max: 200 },
    bottomFeedMm: { min: 0, max: 80 },
};

/** Enum config keys and their allowed values (anything else is dropped). */
const ENUM_KEYS: Record<string, readonly string[]> = {
    zeroAmountDisplay: ['zero', 'included', 'blank'],
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
        if (typeof def === 'boolean' && typeof val === 'boolean')
            out[key] = val;
        else if (NUMERIC_KEYS[key] && typeof val === 'number' && !isNaN(val)) {
            const { min, max } = NUMERIC_KEYS[key];
            out[key] = Math.min(max, Math.max(min, Math.round(val)));
        } else if (
            ENUM_KEYS[key] &&
            typeof val === 'string' &&
            ENUM_KEYS[key].includes(val)
        )
            out[key] = val;
        else if (
            (key === 'headerText' || key === 'footerText') &&
            (typeof val === 'string' || val === null)
        )
            out[key] = val === '' ? null : val;
    }
    return out as Partial<InvoiceTemplateConfig>;
}
