/**
 * How the Customers module (table + profile) writes things out. Kept apart from
 * the app-wide helpers on purpose: the money format here groups thousands
 * ("Rs. 31,240.00"), which the design for these two pages calls for and which
 * the receipts and the POS — sharing `formatCurrency` — do not use.
 */

const TWO_DECIMALS = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** "Rs. 31,240.00" */
export function formatRs(amount: number | null | undefined): string {
  return `Rs. ${TWO_DECIMALS.format(Number(amount) || 0)}`;
}

/** "12,522" */
export function formatPoints(points: number | null | undefined): string {
  return (Number(points) || 0).toLocaleString('en-US');
}

/** "0300 1234567" for a Pakistani mobile; anything else is left as typed. */
export function formatPhone(phone: string | null | undefined): string {
  const p = (phone ?? '').trim();
  return /^03\d{9}$/.test(p) ? `${p.slice(0, 4)} ${p.slice(4)}` : p;
}

/** The words of a name that carry a letter or digit ("Wok & Go" → ["Wok", "Go"]). */
function words(name: string | null | undefined): string[] {
  return (name ?? '')
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(Boolean);
}

/** "JD" for "John Doe", "H" for "hussain"; "?" when there is no name to go on. */
export function nameInitials(name: string | null | undefined, max = 2): string {
  const w = words(name);
  if (w.length === 0) return '?';
  return w
    .slice(0, max)
    .map((x) => Array.from(x)[0])
    .join('')
    .toUpperCase();
}
