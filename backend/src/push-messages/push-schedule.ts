import { BadRequestException } from '@nestjs/common';
import type { RepeatRule } from './push-message.types';
import {
    addDays,
    DATE_RE,
    daysBetween,
    daysInMonth,
    localParts,
    TIME_RE,
    zonedToUtc,
} from './push-time';

/** A scalar from a JSON body as text ('' for anything else). */
function asText(v: unknown): string {
    return typeof v === 'string' || typeof v === 'number' ? String(v) : '';
}

/** How far ahead to look for a matching day before calling a rule dead. */
const SEARCH_DAYS = 800;

/** Does the local `date` belong to the repeat rule (ignoring start/end)? */
function dayMatches(rule: RepeatRule, date: string): boolean {
    switch (rule.frequency) {
        case 'daily':
            return true;
        case 'weekly': {
            const [y, m, d] = date.split('-').map(Number);
            const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
            return (rule.weekdays ?? []).includes(weekday);
        }
        case 'monthly': {
            const day = Number(date.slice(8, 10));
            const last = daysInMonth(date);
            const wanted = rule.month_day ?? 1;
            // -1 = the last day; 31 in a 30-day month also means the last day.
            const target = wanted === -1 || wanted > last ? last : wanted;
            return day === target;
        }
        case 'every_n_days': {
            const n = Math.max(1, rule.interval_days ?? 1);
            const since = daysBetween(rule.starts_on, date);
            return since >= 0 && since % n === 0;
        }
        default:
            return false;
    }
}

/**
 * The first occurrence of `rule` strictly after `after`, or null when the rule
 * has ended (end date passed, or `runsSoFar` reached `max_runs`).
 *
 * Missed occurrences are never replayed: the caller passes `after = now` once
 * a send is done, so a server that was down for three Fridays sends once, not
 * three times.
 */
export function nextOccurrence(
    rule: RepeatRule,
    tz: string,
    after: Date,
    runsSoFar = 0,
    skipDates: string[] = [],
): Date | null {
    if (rule.ends === 'after' && rule.max_runs != null) {
        if (runsSoFar >= rule.max_runs) return null;
    }
    const skip = new Set(skipDates);
    const today = localParts(after, tz).date;
    let date = today > rule.starts_on ? today : rule.starts_on;
    for (let i = 0; i < SEARCH_DAYS; i++, date = addDays(date, 1)) {
        if (rule.ends === 'on' && rule.ends_on && date > rule.ends_on) {
            return null;
        }
        if (skip.has(date) || !dayMatches(rule, date)) continue;
        const at = zonedToUtc(date, rule.time, tz);
        if (at.getTime() > after.getTime()) return at;
    }
    return null;
}

/** The next `count` occurrences, for the composer's "Next: …" line. */
export function upcomingOccurrences(
    rule: RepeatRule,
    tz: string,
    from: Date,
    count: number,
    runsSoFar = 0,
    skipDates: string[] = [],
): Date[] {
    const out: Date[] = [];
    let after = from;
    for (let i = 0; i < count; i++) {
        const next = nextOccurrence(rule, tz, after, runsSoFar + i, skipDates);
        if (!next) break;
        out.push(next);
        after = next;
    }
    return out;
}

/**
 * Check a repeat rule from the API and return it in canonical form (unknown
 * keys dropped, weekdays sorted and de-duplicated). Throws 400 with a message
 * the composer can show.
 */
export function normalizeRepeatRule(raw: unknown): RepeatRule {
    if (!raw || typeof raw !== 'object') {
        throw new BadRequestException('A repeating schedule is required');
    }
    const r = raw as Record<string, unknown>;
    const frequency = r.frequency;
    if (
        frequency !== 'daily' &&
        frequency !== 'weekly' &&
        frequency !== 'monthly' &&
        frequency !== 'every_n_days'
    ) {
        throw new BadRequestException(
            'Repeat must be daily, weekly, monthly or every N days',
        );
    }
    const time = asText(r.time);
    if (!TIME_RE.test(time)) {
        throw new BadRequestException('Pick a time of day (HH:mm)');
    }
    const startsOn = asText(r.starts_on);
    if (!DATE_RE.test(startsOn)) {
        throw new BadRequestException('Pick the date the repeat starts on');
    }
    const rule: RepeatRule = {
        frequency,
        time,
        starts_on: startsOn,
        ends: 'never',
    };
    if (frequency === 'weekly') {
        const days = Array.isArray(r.weekdays) ? r.weekdays : [];
        const weekdays = [
            ...new Set(
                days
                    .map(Number)
                    .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6),
            ),
        ].sort((a, b) => a - b);
        if (weekdays.length === 0) {
            throw new BadRequestException('Pick at least one day of the week');
        }
        rule.weekdays = weekdays;
    }
    if (frequency === 'monthly') {
        const day = Number(r.month_day);
        if (!(day === -1 || (Number.isInteger(day) && day >= 1 && day <= 31))) {
            throw new BadRequestException(
                'Pick a day of the month (1–31, or the last day)',
            );
        }
        rule.month_day = day;
    }
    if (frequency === 'every_n_days') {
        const n = Number(r.interval_days);
        if (!Number.isInteger(n) || n < 2 || n > 365) {
            throw new BadRequestException('Repeat every 2 to 365 days');
        }
        rule.interval_days = n;
    }
    const ends = r.ends ?? 'never';
    if (ends === 'on') {
        const endsOn = asText(r.ends_on);
        if (!DATE_RE.test(endsOn)) {
            throw new BadRequestException('Pick the date the repeat ends on');
        }
        if (endsOn < startsOn) {
            throw new BadRequestException(
                'The repeat cannot end before it starts',
            );
        }
        rule.ends = 'on';
        rule.ends_on = endsOn;
    } else if (ends === 'after') {
        const max = Number(r.max_runs);
        if (!Number.isInteger(max) || max < 1 || max > 10_000) {
            throw new BadRequestException('End after 1 to 10,000 sends');
        }
        rule.ends = 'after';
        rule.max_runs = max;
    } else if (ends !== 'never') {
        throw new BadRequestException(
            'A repeat ends never, on a date, or after N sends',
        );
    }
    return rule;
}
