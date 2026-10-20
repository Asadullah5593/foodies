import { isQuietTime, localParts, quietEndsAt, zonedToUtc } from './push-time';
import {
    nextOccurrence,
    normalizeRepeatRule,
    upcomingOccurrences,
} from './push-schedule';
import type { RepeatRule } from './push-message.types';
import { personalize, unknownPlaceholders } from './push-personalize';

const PK = 'Asia/Karachi';
const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe('push-time', () => {
    it('reads Pakistan wall-clock times as UTC instants (PKT = UTC+5)', () => {
        expect(iso(zonedToUtc('2026-10-24', '19:00', PK))).toBe(
            '2026-10-24T14:00:00.000Z',
        );
        expect(iso(zonedToUtc('2026-10-24', '02:30', PK))).toBe(
            '2026-10-23T21:30:00.000Z',
        );
    });

    it('handles a zone with daylight saving', () => {
        // 30 Mar 2026 is after the EU spring-forward (London = UTC+1).
        expect(iso(zonedToUtc('2026-03-30', '09:00', 'Europe/London'))).toBe(
            '2026-03-30T08:00:00.000Z',
        );
        expect(iso(zonedToUtc('2026-01-30', '09:00', 'Europe/London'))).toBe(
            '2026-01-30T09:00:00.000Z',
        );
    });

    it('gives the local date, time and weekday', () => {
        const p = localParts(new Date('2026-10-23T20:30:00Z'), PK);
        expect(p).toEqual({
            date: '2026-10-24',
            time: '01:30',
            weekday: 6,
            minutes: 90,
        });
    });

    it('knows quiet hours, including a window across midnight', () => {
        const at = (local: string) => zonedToUtc('2026-10-24', local, PK);
        expect(isQuietTime(at('03:00'), PK, '01:00', '10:00')).toBe(true);
        expect(isQuietTime(at('10:00'), PK, '01:00', '10:00')).toBe(false);
        expect(isQuietTime(at('00:59'), PK, '01:00', '10:00')).toBe(false);
        expect(isQuietTime(at('23:30'), PK, '22:00', '08:00')).toBe(true);
        expect(isQuietTime(at('07:59'), PK, '22:00', '08:00')).toBe(true);
        expect(isQuietTime(at('12:00'), PK, '22:00', '08:00')).toBe(false);
        expect(isQuietTime(at('12:00'), PK, '09:00', '09:00')).toBe(false);
    });

    it('says when the quiet window ends', () => {
        expect(
            iso(
                quietEndsAt(
                    zonedToUtc('2026-10-24', '03:00', PK),
                    PK,
                    '01:00',
                    '10:00',
                ),
            ),
        ).toBe(iso(zonedToUtc('2026-10-24', '10:00', PK)));
        expect(
            iso(
                quietEndsAt(
                    zonedToUtc('2026-10-24', '23:00', PK),
                    PK,
                    '22:00',
                    '08:00',
                ),
            ),
        ).toBe(iso(zonedToUtc('2026-10-25', '08:00', PK)));
        expect(
            iso(
                quietEndsAt(
                    zonedToUtc('2026-10-25', '02:00', PK),
                    PK,
                    '22:00',
                    '08:00',
                ),
            ),
        ).toBe(iso(zonedToUtc('2026-10-25', '08:00', PK)));
    });
});

describe('nextOccurrence', () => {
    const base: RepeatRule = {
        frequency: 'daily',
        time: '19:00',
        starts_on: '2026-10-20',
        ends: 'never',
    };
    const at = (date: string, time: string) => zonedToUtc(date, time, PK);

    it('daily: later today, or tomorrow once today has passed', () => {
        expect(iso(nextOccurrence(base, PK, at('2026-10-21', '12:00')))).toBe(
            iso(at('2026-10-21', '19:00')),
        );
        expect(iso(nextOccurrence(base, PK, at('2026-10-21', '19:00')))).toBe(
            iso(at('2026-10-22', '19:00')),
        );
    });

    it('never starts before starts_on', () => {
        expect(iso(nextOccurrence(base, PK, at('2026-10-01', '08:00')))).toBe(
            iso(at('2026-10-20', '19:00')),
        );
    });

    it('weekly: only the chosen days (Friday = 5)', () => {
        const rule: RepeatRule = {
            ...base,
            frequency: 'weekly',
            weekdays: [5],
        };
        // Tue 20 Oct 2026 → Fri 23 Oct.
        expect(iso(nextOccurrence(rule, PK, at('2026-10-20', '20:00')))).toBe(
            iso(at('2026-10-23', '19:00')),
        );
        expect(
            upcomingOccurrences(rule, PK, at('2026-10-20', '20:00'), 3).map(
                iso,
            ),
        ).toEqual(
            ['2026-10-23', '2026-10-30', '2026-11-06'].map((d) =>
                iso(at(d, '19:00')),
            ),
        );
    });

    it('monthly: day 31 falls back to the last day of a short month; -1 is the last day', () => {
        const d31: RepeatRule = {
            ...base,
            frequency: 'monthly',
            month_day: 31,
        };
        expect(iso(nextOccurrence(d31, PK, at('2026-11-01', '00:00')))).toBe(
            iso(at('2026-11-30', '19:00')),
        );
        const last: RepeatRule = {
            ...base,
            frequency: 'monthly',
            month_day: -1,
        };
        expect(iso(nextOccurrence(last, PK, at('2027-02-01', '00:00')))).toBe(
            iso(at('2027-02-28', '19:00')),
        );
    });

    it('every N days counts from the start date', () => {
        const rule: RepeatRule = {
            ...base,
            frequency: 'every_n_days',
            interval_days: 3,
        };
        expect(
            upcomingOccurrences(rule, PK, at('2026-10-20', '00:00'), 3).map(
                iso,
            ),
        ).toEqual(
            ['2026-10-20', '2026-10-23', '2026-10-26'].map((d) =>
                iso(at(d, '19:00')),
            ),
        );
    });

    it('stops at the end date (inclusive) and after max sends', () => {
        const until: RepeatRule = {
            ...base,
            ends: 'on',
            ends_on: '2026-10-21',
        };
        expect(iso(nextOccurrence(until, PK, at('2026-10-21', '10:00')))).toBe(
            iso(at('2026-10-21', '19:00')),
        );
        expect(nextOccurrence(until, PK, at('2026-10-21', '20:00'))).toBeNull();
        const after2: RepeatRule = { ...base, ends: 'after', max_runs: 2 };
        expect(
            nextOccurrence(after2, PK, at('2026-10-21', '10:00'), 2),
        ).toBeNull();
        expect(
            upcomingOccurrences(after2, PK, at('2026-10-20', '00:00'), 5)
                .length,
        ).toBe(2);
    });

    it('skips the skipped dates', () => {
        expect(
            iso(
                nextOccurrence(base, PK, at('2026-10-21', '12:00'), 0, [
                    '2026-10-21',
                ]),
            ),
        ).toBe(iso(at('2026-10-22', '19:00')));
    });

    it('a server that was down sends once, not once per missed day', () => {
        // Asked "what is next after now" on 25 Oct at noon, a daily rule last
        // sent on the 21st gives the 25th — not the 22nd.
        expect(iso(nextOccurrence(base, PK, at('2026-10-25', '12:00')))).toBe(
            iso(at('2026-10-25', '19:00')),
        );
    });
});

describe('normalizeRepeatRule', () => {
    it('sorts and de-duplicates weekdays and drops unknown keys', () => {
        expect(
            normalizeRepeatRule({
                frequency: 'weekly',
                weekdays: [5, 1, 5, 9],
                time: '18:30',
                starts_on: '2026-10-20',
                ends: 'never',
                junk: true,
            }),
        ).toEqual({
            frequency: 'weekly',
            weekdays: [1, 5],
            time: '18:30',
            starts_on: '2026-10-20',
            ends: 'never',
        });
    });

    it('refuses an incomplete rule with a readable reason', () => {
        expect(() =>
            normalizeRepeatRule({
                frequency: 'weekly',
                time: '18:30',
                starts_on: '2026-10-20',
            }),
        ).toThrow('Pick at least one day of the week');
        expect(() =>
            normalizeRepeatRule({
                frequency: 'daily',
                time: '25:00',
                starts_on: '2026-10-20',
            }),
        ).toThrow('Pick a time of day');
        expect(() =>
            normalizeRepeatRule({
                frequency: 'daily',
                time: '10:00',
                starts_on: '2026-10-20',
                ends: 'on',
                ends_on: '2026-10-01',
            }),
        ).toThrow('cannot end before it starts');
    });
});

describe('personalize', () => {
    const ali = { name: 'Ali Raza', app_points: 1450, last_brand: 'Wok & Go' };

    it('fills the placeholders', () => {
        expect(
            personalize(
                'Hi {first_name}, you have {app_points} points. Craving {last_brand}?',
                ali,
            ),
        ).toBe('Hi Ali, you have 1,450 points. Craving Wok & Go?');
    });

    it('uses the fallback, or drops an empty placeholder cleanly', () => {
        expect(personalize('Hi {first_name|there}!', { name: null })).toBe(
            'Hi there!',
        );
        expect(personalize('Hi {first_name}, tonight only', { name: '' })).toBe(
            'Hi, tonight only',
        );
    });

    it('leaves unknown placeholders alone and reports them', () => {
        expect(personalize('Use {coupon}', ali)).toBe('Use {coupon}');
        expect(unknownPlaceholders('Use {coupon} {first_name}')).toEqual([
            'coupon',
        ]);
    });
});
