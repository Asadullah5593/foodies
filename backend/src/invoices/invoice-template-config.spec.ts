import {
    DEFAULT_INVOICE_TEMPLATE_CONFIG,
    sanitizeInvoiceTemplateConfig,
} from './invoice-template-config';

/**
 * The sanitizer decides what a saved template is allowed to persist. A key it
 * doesn't recognise is silently dropped — which is exactly how the app-download
 * QR text was lost until appQrText was added to the string-field branch.
 */
describe('sanitizeInvoiceTemplateConfig', () => {
    it('keeps the app-QR toggle and its text', () => {
        const out = sanitizeInvoiceTemplateConfig({
            showAppQr: true,
            appQrText: 'Get the app',
        });
        expect(out).toEqual({ showAppQr: true, appQrText: 'Get the app' });
    });

    it('normalises empty QR text to null (QR shows with no prompt)', () => {
        expect(
            sanitizeInvoiceTemplateConfig({ appQrText: '' }).appQrText,
        ).toBeNull();
        expect(
            sanitizeInvoiceTemplateConfig({ appQrText: null }).appQrText,
        ).toBeNull();
    });

    it('keeps the modifier-prefix and note toggles', () => {
        const out = sanitizeInvoiceTemplateConfig({
            showModifierGroup: false,
            showModifierPlus: false,
            showLineNotes: true,
            showOrderNotes: true,
        });
        expect(out).toEqual({
            showModifierGroup: false,
            showModifierPlus: false,
            showLineNotes: true,
            showOrderNotes: true,
        });
    });

    it('drops unknown keys and wrong types', () => {
        const out = sanitizeInvoiceTemplateConfig({
            bogus: 1,
            showAppQr: 'yes', // wrong type — a boolean key
            appQrText: 42, // wrong type — a string key
        });
        expect(out).toEqual({});
    });

    it('defaults ship the QR off with a ready-to-use prompt', () => {
        expect(DEFAULT_INVOICE_TEMPLATE_CONFIG.showAppQr).toBe(false);
        expect(DEFAULT_INVOICE_TEMPLATE_CONFIG.appQrText).toBe(
            'Scan to download the Foodies app',
        );
    });

    it('keeps a valid tableNumberDisplay and drops an invalid one', () => {
        expect(
            sanitizeInvoiceTemplateConfig({
                tableNumberDisplay: 'banner_inverted',
            }),
        ).toEqual({ tableNumberDisplay: 'banner_inverted' });
        expect(
            sanitizeInvoiceTemplateConfig({ tableNumberDisplay: 'huge' }),
        ).toEqual({});
        // Backward compatible: stored configs without the key resolve to 'row'.
        expect(DEFAULT_INVOICE_TEMPLATE_CONFIG.tableNumberDisplay).toBe('row');
    });
});
