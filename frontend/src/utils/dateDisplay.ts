const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "28 Sep 2026" — a calendar day in the viewer's own timezone; '—' when absent. */
export function formatDay(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  // Spelled out by hand: the browser's own short month names differ between
  // engines and versions ("Sep" in one, "Sept" in another).
  return `${String(d.getDate()).padStart(2, '0')} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/** Local calendar day as YYYY-MM-DD, for comparing against a date picker's value. */
export function localDayKey(value: string | Date | null | undefined): string {
  if (!value) return '';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Whole calendar days between that day and today (0 = today); null when absent. */
export function daysSince(value: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  return Math.round((startOf(now) - startOf(d)) / 86_400_000);
}

/** "today" / "yesterday" / "12 days ago"; '' when absent. */
export function daysAgoLabel(value: string | Date | null | undefined, now: Date = new Date()): string {
  const n = daysSince(value, now);
  if (n == null) return '';
  if (n <= 0) return 'today';
  if (n === 1) return 'yesterday';
  return `${n} days ago`;
}
