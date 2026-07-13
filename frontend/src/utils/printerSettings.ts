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
