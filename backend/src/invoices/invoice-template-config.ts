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
    /** Show the app-download QR (+ its text) above the footer. */
    showAppQr: boolean;
    /** Text shown to the left of the app-download QR (empty = QR only). */
    appQrText: string | null;
    /** Weight of the app-QR text (100–900; default 600, the info-box value weight). */
    appQrTextFontWeight: number;
    /** Size of the app-QR text, percent of the info-box value size (50–200). */
    appQrTextFontPct: number;
    /**
     * FBR fiscalization block below the app-QR row: the tax-authority logo
     * (left) and the verification QR (right), then the "FBR Invoice #" line
     * beneath them. Only prints when the order carries an FBR number, so it is
     * harmless without FBR.
     */
    showFbrInvoice: boolean;
    /**
     * Custom logo for the FBR block (absolute image URL). Empty/null → the
     * bundled default (frontend public/PRA.jpg). Lets an admin swap the
     * tax-authority mark per template without a code change.
     */
    fbrLogoUrl: string | null;
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
    /** The modifier group name prefix, e.g. "Base: " on "Base: Classic Hand-Tossed". */
    showModifierGroup: boolean;
    /** The leading "+ " on add-on and modifier lines. */
    showModifierPlus: boolean;
    /** Per-item notes (kitchen instructions) printed under the item. */
    showLineNotes: boolean;
    showUnitPrice: boolean;
    /**
     * Where a deal's price prints: 'both' = on the deal name line AND its
     * component lines (legacy behavior), 'deal_only' = only on the deal name
     * (components list without prices), 'items_only' = only on the component
     * lines (deal name carries no price).
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
    /** Discount-line typography; defaults match the info-box value column (black, weight 600, same size). */
    discountFontWeight: number;
    discountFontPct: number;

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
    /** The order-level note (e.g. "Birthday — add candles") printed in the header block. */
    showOrderNotes: boolean;
    /** Method of payment (cash / card / split) — shown when the order has recorded tenders. */
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
    discountFontWeight: 600,
    discountFontPct: 100,

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
    showOrderNotes: false,
    showPaymentMethod: true,
    metaLabelsFontWeight: 600,
    metaLabelsFontPct: 100,
    footerFontWeight: 600,
    footerFontPct: 100,
    loyaltyFontWeight: 600,
    loyaltyFontPct: 100,
};

/** Numeric config keys and their clamp ranges (percent). */
const NUMERIC_KEYS: Record<string, { min: number; max: number }> = {
    fontScalePct: { min: 50, max: 200 },
    poweredByFontPct: { min: 50, max: 200 },
    bottomFeedMm: { min: 0, max: 80 },
    discountFontWeight: { min: 100, max: 900 },
    discountFontPct: { min: 50, max: 200 },
    appQrTextFontWeight: { min: 100, max: 900 },
    appQrTextFontPct: { min: 50, max: 200 },
    metaLabelsFontWeight: { min: 100, max: 900 },
    metaLabelsFontPct: { min: 50, max: 200 },
    footerFontWeight: { min: 100, max: 900 },
    footerFontPct: { min: 50, max: 200 },
    loyaltyFontWeight: { min: 100, max: 900 },
    loyaltyFontPct: { min: 50, max: 200 },
};

/** Enum config keys and their allowed values (anything else is dropped). */
const ENUM_KEYS: Record<string, readonly string[]> = {
    dealPriceDisplay: ['both', 'deal_only', 'items_only'],
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
            (key === 'headerText' ||
                key === 'footerText' ||
                key === 'appQrText' ||
                key === 'fbrLogoUrl') &&
            (typeof val === 'string' || val === null)
        )
            out[key] = val === '' ? null : val;
    }
    return out as Partial<InvoiceTemplateConfig>;
}
