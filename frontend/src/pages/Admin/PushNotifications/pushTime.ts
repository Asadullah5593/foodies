/**
 * Date/time pickers on the business's clock (Asia/Karachi in practice), not
 * the browser's: someone abroad picking "7 PM" still means 7 PM in Pakistan.
 * Same Intl maths as the backend's push-time.ts.
 */

function parts(instant: Date, tz: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).formatToParts(instant)) {
    out[p.type] = p.value;
  }
  if (out.hour === '24') out.hour = '00';
  return out;
}

/** "YYYY-MM-DD" and "HH:mm" of `instant` on the clock of `tz`. */
export function wallClock(instant: Date, tz: string): { date: string; time: string } {
  const p = parts(instant, tz);
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

function offsetMs(instant: Date, tz: string): number {
  const p = parts(instant, tz);
  const asUtc = Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour), Number(p.minute));
  return asUtc - Math.floor(instant.getTime() / 60000) * 60000;
}

/** The real instant at which the clock in `tz` reads `date` `time`. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = guess - offsetMs(new Date(guess), tz);
  return new Date(guess - offsetMs(new Date(first), tz));
}

/** "Pakistan time" for Asia/Karachi, else the zone's own name. */
export function zoneLabel(tz: string): string {
  if (tz === 'Asia/Karachi') return 'Pakistan time';
  return tz.replace(/_/g, ' ');
}
