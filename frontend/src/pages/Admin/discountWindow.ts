/**
 * When a discount runs, as the admin picks it: a start and an end, each a date
 * plus an optional time on the business's clock (Asia/Karachi in practice),
 * and optional daily hours that repeat on every day it runs.
 *
 * What the backend stores (backend/src/utils/validity-window.ts):
 *  - a plain date ("2026-10-23") is saved as midnight UTC and means that WHOLE
 *    day on the branch clock: start of day for "from", end of day for "until";
 *  - any other value is an exact moment.
 * So a date without a time is sent as the plain date, exactly as before, and a
 * date with a time is sent as the exact moment — "until Mon 26 Oct, 2:00 AM"
 * becomes 2026-10-25T21:00:00Z.
 */
import { wallClock, zonedToUtc, zoneLabel } from './PushNotifications/pushTime';

export const DEFAULT_OFFER_TZ = 'Asia/Karachi';

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

/** One end of the window as the form holds it: "YYYY-MM-DD" + "HH:mm" (time may be empty). */
export interface WindowEnd {
  date: string;
  time: string;
}

/**
 * The clock the picked times are read on: the timezone of the branches the
 * offer is limited to (all of them when none are picked), the most common one
 * winning — the same fallback the backend uses where there is no branch.
 */
export function offerTimezone(
  branches: Array<{ id: number; timezone?: string | null }> | undefined,
  selectedBranchIds: number[],
): string {
  const pool = (branches ?? []).filter(
    (b) => selectedBranchIds.length === 0 || selectedBranchIds.includes(b.id),
  );
  const counts = new Map<string, number>();
  for (const b of pool) {
    if (b.timezone) counts.set(b.timezone, (counts.get(b.timezone) ?? 0) + 1);
  }
  let best = DEFAULT_OFFER_TZ;
  let most = 0;
  for (const [tz, n] of counts) {
    if (n > most) {
      best = tz;
      most = n;
    }
  }
  return best;
}

/** Form value for a stored valid_from / valid_until. */
export function windowEndToForm(value: string | null | undefined, tz: string): WindowEnd {
  if (!value) return { date: '', time: '' };
  const instant = new Date(value);
  if (Number.isNaN(instant.getTime())) return { date: '', time: '' };
  // A picked whole day: show the date, no time.
  if (instant.getTime() % DAY_MS === 0) {
    return { date: instant.toISOString().slice(0, 10), time: '' };
  }
  // Rounded to the minute: a moment that falls on midnight UTC is moved 1 ms
  // when it is saved (windowEndToApi), and must still read back as the time
  // the admin typed.
  const rounded = new Date(Math.round(instant.getTime() / MINUTE_MS) * MINUTE_MS);
  return wallClock(rounded, tz);
}

/** API value for a picked start or end: null (none), a plain date (whole day) or an exact moment. */
export function windowEndToApi(end: WindowEnd, side: 'from' | 'until', tz: string): string | null {
  if (!end.date) return null;
  if (!end.time) return end.date;
  const instant = zonedToUtc(end.date, end.time, tz).getTime();
  // A moment exactly on midnight UTC (5:00 AM in Pakistan) would be read back
  // as a whole picked day. Move it 1 ms inside the window so it stays a moment.
  if (instant % DAY_MS === 0) {
    return new Date(instant + (side === 'from' ? 1 : -1)).toISOString();
  }
  return new Date(instant).toISOString();
}

function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

/** First moment the window covers, or null when there is no start. */
function startMs(from: WindowEnd, tz: string): number | null {
  if (!from.date) return null;
  return zonedToUtc(from.date, from.time || '00:00', tz).getTime();
}

/** Last moment the window covers, or null when there is no end. A date without a time runs to the end of that day. */
function endMs(until: WindowEnd, tz: string): number | null {
  if (!until.date) return null;
  if (until.time) return zonedToUtc(until.date, until.time, tz).getTime();
  return zonedToUtc(nextDay(until.date), '00:00', tz).getTime() - 1;
}

export interface WindowForm {
  from: WindowEnd;
  until: WindowEnd;
  /** Daily hours, "HH:mm" or empty. */
  dailyStart: string;
  dailyEnd: string;
}

/** Why the window cannot be saved, or null when it is fine. */
export function windowProblem(w: WindowForm, tz: string): string | null {
  const s = startMs(w.from, tz);
  const e = endMs(w.until, tz);
  if (s != null && e != null && e < s) {
    return 'The discount ends before it starts. Check the start and end dates and times.';
  }
  // isWithinSchedule compares minutes within one day, so 10 PM – 2 AM would
  // never match. Refuse it rather than save an offer that never applies.
  // "HH:mm" from the form, "HH:mm:ss" from the API — compare the minutes.
  if (w.dailyStart && w.dailyEnd && w.dailyStart.slice(0, 5) > w.dailyEnd.slice(0, 5)) {
    return 'Daily hours cannot run past midnight (e.g. 10 PM – 2 AM). For a night that runs past midnight, set the end time under "Valid until" instead.';
  }
  return null;
}

/** "2:00 AM" for "02:00". */
export function formatClockTime(time: string): string {
  const [h, m] = time.split(':').map(Number);
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "Fri 23 Oct 2026" for "2026-10-23". */
function formatDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  const p = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).formatToParts(new Date(Date.UTC(y, m - 1, d)));
  const part = (t: string) => p.find((x) => x.type === t)?.value ?? '';
  return `${part('weekday')} ${part('day')} ${part('month')} ${part('year')}`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * The window in plain words, e.g. "Runs from the start of Fri 23 Oct 2026
 * until 2:00 AM on Mon 26 Oct 2026 (Pakistan time)." Null when nothing limits it.
 */
export function windowSummary(w: WindowForm & { days: number[] }, tz: string): string | null {
  const hasDates = !!(w.from.date || w.until.date);
  const hasHours = !!(w.dailyStart || w.dailyEnd);
  const hasDays = w.days.length > 0 && w.days.length < 7;
  if (!hasDates && !hasHours && !hasDays) return null;

  const parts: string[] = [];
  if (hasDates) {
    const start = !w.from.date
      ? ''
      : w.from.time
        ? `from ${formatClockTime(w.from.time)} on ${formatDay(w.from.date)}`
        : `from the start of ${formatDay(w.from.date)}`;
    const end = !w.until.date
      ? 'with no end date'
      : w.until.time
        ? `until ${formatClockTime(w.until.time)} on ${formatDay(w.until.date)}`
        : `until the end of ${formatDay(w.until.date)}`;
    parts.push(`Runs ${[start, end].filter(Boolean).join(' ')} (${zoneLabel(tz)}).`);
  }
  if (hasHours) {
    const from = w.dailyStart ? formatClockTime(w.dailyStart) : '12:00 AM';
    const to = w.dailyEnd ? formatClockTime(w.dailyEnd) : '11:59 PM';
    parts.push(`Only between ${from} and ${to} each day${hasDates ? '' : ` (${zoneLabel(tz)})`}.`);
  }
  if (hasDays) {
    parts.push(`Only on ${[...w.days].sort((a, b) => a - b).map((d) => DAY_NAMES[d]).join(', ')}.`);
  }
  return parts.join(' ');
}
