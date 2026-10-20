/**
 * Wall-clock helpers for push schedules: every "Friday 7 PM" and every quiet
 * hour is read in the tenant's time zone (Asia/Karachi in practice), while the
 * database stores real instants. Plain Intl, no date library — the backend has
 * none, and Pakistan has no daylight saving, but the maths below still handles
 * zones that do.
 */

const partFormatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
    let f = partFormatters.get(tz);
    if (!f) {
        f = new Intl.DateTimeFormat('en-US', {
            timeZone: tz,
            hourCycle: 'h23',
            year: 'numeric',
            month: '2-digit',
            day: '2-digit',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            weekday: 'short',
        });
        partFormatters.set(tz, f);
    }
    return f;
}

const WEEKDAYS: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
};

export interface LocalParts {
    date: string; // YYYY-MM-DD
    time: string; // HH:mm
    weekday: number; // 0 = Sunday
    minutes: number; // minutes since local midnight
}

/** What the clock on the wall says at `instant` in `tz`. */
export function localParts(instant: Date, tz: string): LocalParts {
    const parts: Record<string, string> = {};
    for (const p of formatterFor(tz).formatToParts(instant)) {
        parts[p.type] = p.value;
    }
    const hour = parts.hour === '24' ? '00' : parts.hour;
    return {
        date: `${parts.year}-${parts.month}-${parts.day}`,
        time: `${hour}:${parts.minute}`,
        weekday: WEEKDAYS[parts.weekday] ?? 0,
        minutes: Number(hour) * 60 + Number(parts.minute),
    };
}

/** Offset of `tz` from UTC at `instant`, in milliseconds (PKT = +5 h). */
function offsetMs(instant: Date, tz: string): number {
    const p = localParts(instant, tz);
    const [y, m, d] = p.date.split('-').map(Number);
    const asUtc = Date.UTC(
        y,
        m - 1,
        d,
        Math.floor(p.minutes / 60),
        p.minutes % 60,
        instant.getUTCSeconds(),
    );
    return asUtc - (instant.getTime() - instant.getUTCMilliseconds());
}

/** The real instant at which the clock in `tz` reads `date` `time`. */
export function zonedToUtc(date: string, time: string, tz: string): Date {
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    const guess = Date.UTC(y, m - 1, d, hh, mm);
    // First pass with the offset at the guess, second pass corrects for a
    // daylight-saving change between the guess and the answer.
    const first = guess - offsetMs(new Date(guess), tz);
    return new Date(guess - offsetMs(new Date(first), tz));
}

/** YYYY-MM-DD plus `days` (calendar arithmetic, zone-free). */
export function addDays(date: string, days: number): string {
    const [y, m, d] = date.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d + days));
    return t.toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (both YYYY-MM-DD). */
export function daysBetween(a: string, b: string): number {
    const [y1, m1, d1] = a.split('-').map(Number);
    const [y2, m2, d2] = b.split('-').map(Number);
    return Math.round(
        (Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000,
    );
}

export function daysInMonth(date: string): number {
    const [y, m] = date.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
export const DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

export function isValidTimeZone(tz: string): boolean {
    try {
        new Intl.DateTimeFormat('en-US', { timeZone: tz });
        return true;
    } catch {
        return false;
    }
}

function toMinutes(hhmm: string): number {
    const [h, m] = hhmm.split(':').map(Number);
    return h * 60 + m;
}

/**
 * Is `instant` inside the quiet window [start, end) on the local clock? A
 * window whose end is before its start crosses midnight (22:00–08:00). Equal
 * start and end means no quiet time at all.
 */
export function isQuietTime(
    instant: Date,
    tz: string,
    start: string,
    end: string,
): boolean {
    const s = toMinutes(start);
    const e = toMinutes(end);
    if (s === e) return false;
    const now = localParts(instant, tz).minutes;
    return s < e ? now >= s && now < e : now >= s || now < e;
}

/**
 * When the quiet window that contains `instant` ends — the moment a held send
 * may go out. Only meaningful when isQuietTime() is true.
 */
export function quietEndsAt(
    instant: Date,
    tz: string,
    start: string,
    end: string,
): Date {
    const local = localParts(instant, tz);
    const e = toMinutes(end);
    // Past the end time today means the window ends tomorrow (crossed midnight).
    const date =
        toMinutes(start) > e && local.minutes >= toMinutes(start)
            ? addDays(local.date, 1)
            : local.date;
    return zonedToUtc(date, end, tz);
}
