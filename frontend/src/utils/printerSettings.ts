/**
 * Per-device (per-browser) thermal-printer overrides.
 *
 * The bottom cutter-feed is a property of the physical PRINTER, not of the
 * invoice content template — and the browser never tells our code which printer
 * a job was sent to. So the override lives here, in localStorage on the terminal
 * doing the printing, and wins over the invoice template's default at print time.
 *
 * null = not set on this device → fall back to the template's `bottomFeedMm`.
 */

const BOTTOM_FEED_KEY = 'foodies.printer.bottomFeedMm';

/**
 * Which physical printer each document goes to on THIS terminal.
 *
 * Same reasoning as the feed override, and the same storage: the printers are
 * plugged into this machine, so the mapping belongs to the machine — two tills
 * in one branch have different printers, and the tenant has no idea what either
 * is called. Set once per terminal; used only when the print agent is running
 * (nothing else can target a printer by name).
 *
 * null / unset = no printer chosen → that document falls back to the browser's
 * print dialog.
 */
export type PrintPurpose = 'customer' | 'kitchen';

const PRINTER_KEYS: Record<PrintPurpose, string> = {
  customer: 'foodies.printer.customerName',
  kitchen: 'foodies.printer.kitchenName',
};

export function getDevicePrinter(purpose: PrintPurpose): string | null {
  try {
    const raw = localStorage.getItem(PRINTER_KEYS[purpose]);
    return raw && raw.trim() ? raw : null;
  } catch {
    return null;
  }
}

export function setDevicePrinter(purpose: PrintPurpose, name: string | null): void {
  try {
    if (!name) localStorage.removeItem(PRINTER_KEYS[purpose]);
    else localStorage.setItem(PRINTER_KEYS[purpose], name);
  } catch {
    /* localStorage unavailable (private mode / SSR) — silently no-op */
  }
}

const clampMm = (n: number): number => Math.min(80, Math.max(0, Math.round(n)));

export function getDeviceBottomFeedMm(): number | null {
  try {
    const raw = localStorage.getItem(BOTTOM_FEED_KEY);
    if (raw == null || raw === '') return null;
    const n = Number(raw);
    return Number.isFinite(n) ? clampMm(n) : null;
  } catch {
    return null;
  }
}

export function setDeviceBottomFeedMm(v: number | null): void {
  try {
    if (v == null) localStorage.removeItem(BOTTOM_FEED_KEY);
    else localStorage.setItem(BOTTOM_FEED_KEY, String(clampMm(v)));
  } catch {
    /* localStorage unavailable (private mode / SSR) — silently no-op */
  }
}
