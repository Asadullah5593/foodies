import { describe, it, expect } from 'vitest';
import { daysAgoLabel, daysSince, formatDay, localDayKey } from './dateDisplay';

describe('dateDisplay', () => {
  const now = new Date(2026, 9, 1, 12, 0, 0); // 1 Oct 2026, local

  it('formats a day as "28 Sep 2026"', () => {
    expect(formatDay(new Date(2026, 8, 28, 20, 33))).toBe('28 Sep 2026');
  });

  it('shows a dash for a missing or broken date', () => {
    for (const v of [null, undefined, '', 'not a date']) expect(formatDay(v)).toBe('—');
  });

  it('keys a date by its local calendar day', () => {
    expect(localDayKey(new Date(2026, 8, 5, 23, 59))).toBe('2026-09-05');
    expect(localDayKey(null)).toBe('');
  });

  it('counts whole calendar days, not 24-hour blocks', () => {
    // 11pm yesterday is "1 day ago" at noon today, not 0.
    expect(daysSince(new Date(2026, 8, 30, 23, 0), now)).toBe(1);
    expect(daysSince(new Date(2026, 9, 1, 0, 5), now)).toBe(0);
    expect(daysSince(new Date(2026, 8, 1, 12, 0), now)).toBe(30);
    expect(daysSince(null, now)).toBeNull();
  });

  it('says today, yesterday, or how many days ago', () => {
    expect(daysAgoLabel(new Date(2026, 9, 1, 9, 0), now)).toBe('today');
    expect(daysAgoLabel(new Date(2026, 8, 30, 9, 0), now)).toBe('yesterday');
    expect(daysAgoLabel(new Date(2026, 8, 28, 9, 0), now)).toBe('3 days ago');
    expect(daysAgoLabel(null, now)).toBe('');
  });
});
