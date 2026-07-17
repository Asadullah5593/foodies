import { printContent } from './print';
import { printViaAgent, isAgentAvailable } from './printAgent';
import { getDevicePrinter, type PrintPurpose } from './printerSettings';

/**
 * Send a rendered invoice to the right place.
 *
 * With the print agent running AND a printer chosen for this document on this
 * terminal, the job goes straight to that printer with no dialog — which is the
 * only way to put the customer invoice on one printer and the KOT on another.
 * Otherwise it falls back to the browser print dialog, exactly as before, so
 * terminals without the agent keep working untouched.
 */
export async function printDocument(opts: {
  html: string;
  css?: string;
  title: string;
  purpose: PrintPurpose;
  /** Receipt roll width (mm) from the invoice layout — the agent sizes the page to it. */
  widthMm?: number;
}): Promise<{ printedVia: 'agent' | 'dialog'; printer?: string }> {
  const { html, css = '', title, purpose, widthMm } = opts;
  const printer = getDevicePrinter(purpose);
  if (printer && (await isAgentAvailable())) {
    try {
      await printViaAgent({ html, css, printer, title, widthMm });
      return { printedVia: 'agent', printer };
    } catch (e) {
      // A configured printer that fails must not swallow the receipt: fall
      // back to the dialog so the cashier can still get paper out.
      console.error('[print] agent failed, falling back to the dialog:', e);
    }
  }
  printContent(html, title, css);
  return { printedVia: 'dialog' };
}
