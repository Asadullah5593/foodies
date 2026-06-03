/** Date helpers + quick-range presets for the dashboard filters. */

export type PresetKey = 'today' | '7d' | '30d' | 'month';

export function toIso(d: Date): string {
  // Local calendar date as YYYY-MM-DD (matches <input type="date">).
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDays(d: Date, n: number): Date {
  const copy = new Date(d);
  copy.setDate(copy.getDate() + n);
  return copy;
}

export interface PresetRange {
  key: PresetKey;
  label: string;
  from: string;
  to: string;
}

export function presetRanges(now: Date = new Date()): PresetRange[] {
  const today = toIso(now);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  return [
    { key: 'today', label: 'Today', from: today, to: today },
    { key: '7d', label: '7d', from: toIso(addDays(now, -6)), to: today },
    { key: '30d', label: '30d', from: toIso(addDays(now, -29)), to: today },
    { key: 'month', label: 'This month', from: toIso(monthStart), to: today },
  ];
}

/** The default range shown on first load (last 30 days). */
export function defaultRange(now: Date = new Date()): { from: string; to: string } {
  return { from: toIso(addDays(now, -29)), to: toIso(now) };
}

/** Which preset (if any) exactly matches the current from/to. */
export function matchPreset(from: string, to: string, now: Date = new Date()): PresetKey | null {
  const match = presetRanges(now).find((p) => p.from === from && p.to === to);
  return match ? match.key : null;
}
