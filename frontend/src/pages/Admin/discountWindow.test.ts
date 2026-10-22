import { describe, expect, it } from 'vitest';
import {
  formatClockTime,
  offerTimezone,
  windowEndToApi,
  windowEndToForm,
  windowProblem,
  windowSummary,
} from './discountWindow';

const PK = 'Asia/Karachi';
const none = { date: '', time: '' };

describe('windowEndToApi', () => {
  it('sends a date without a time as the plain date (whole day, as before)', () => {
    expect(windowEndToApi({ date: '2026-10-23', time: '' }, 'from', PK)).toBe('2026-10-23');
    expect(windowEndToApi({ date: '2026-10-26', time: '' }, 'until', PK)).toBe('2026-10-26');
  });

  it('sends nothing as null so a removed date is cleared', () => {
    expect(windowEndToApi(none, 'until', PK)).toBeNull();
  });

  it('sends a date with a time as the exact moment in Pakistan time', () => {
    // Mon 26 Oct, 2:00 AM in Pakistan = Sun 25 Oct, 21:00 UTC.
    expect(windowEndToApi({ date: '2026-10-26', time: '02:00' }, 'until', PK)).toBe(
      '2026-10-25T21:00:00.000Z',
    );
    expect(windowEndToApi({ date: '2026-10-23', time: '18:30' }, 'from', PK)).toBe(
      '2026-10-23T13:30:00.000Z',
    );
  });

  it('keeps 5:00 AM (= midnight UTC) a moment instead of a whole day', () => {
    expect(windowEndToApi({ date: '2026-10-26', time: '05:00' }, 'until', PK)).toBe(
      '2026-10-25T23:59:59.999Z',
    );
    expect(windowEndToApi({ date: '2026-10-26', time: '05:00' }, 'from', PK)).toBe(
      '2026-10-26T00:00:00.001Z',
    );
  });
});

describe('windowEndToForm', () => {
  it('shows a picked whole day as its date with no time', () => {
    expect(windowEndToForm('2026-10-26T00:00:00.000Z', PK)).toEqual({ date: '2026-10-26', time: '' });
  });

  it('shows an exact moment as the Pakistan date and time (not the UTC date)', () => {
    expect(windowEndToForm('2026-10-25T21:00:00.000Z', PK)).toEqual({ date: '2026-10-26', time: '02:00' });
  });

  it('reads the 5:00 AM moments back as 5:00 AM', () => {
    expect(windowEndToForm('2026-10-25T23:59:59.999Z', PK)).toEqual({ date: '2026-10-26', time: '05:00' });
    expect(windowEndToForm('2026-10-26T00:00:00.001Z', PK)).toEqual({ date: '2026-10-26', time: '05:00' });
  });

  it('round-trips every time typed', () => {
    for (const time of ['00:00', '02:00', '04:59', '05:00', '05:01', '12:00', '23:59']) {
      for (const side of ['from', 'until'] as const) {
        const sent = windowEndToApi({ date: '2026-10-26', time }, side, PK)!;
        expect(windowEndToForm(sent, PK)).toEqual({ date: '2026-10-26', time });
      }
    }
  });

  it('leaves the form empty for no value', () => {
    expect(windowEndToForm(null, PK)).toEqual(none);
    expect(windowEndToForm('not a date', PK)).toEqual(none);
  });
});

describe('windowProblem', () => {
  const base = { from: none, until: none, dailyStart: '', dailyEnd: '' };

  it('accepts Fri 12 AM to Mon 2 AM (the Special 50% off weekend)', () => {
    expect(
      windowProblem(
        { ...base, from: { date: '2026-10-23', time: '' }, until: { date: '2026-10-26', time: '02:00' } },
        PK,
      ),
    ).toBeNull();
  });

  it('accepts one whole day', () => {
    expect(
      windowProblem({ ...base, from: { date: '2026-10-23', time: '' }, until: { date: '2026-10-23', time: '' } }, PK),
    ).toBeNull();
  });

  it('refuses an end before the start', () => {
    expect(
      windowProblem({ ...base, from: { date: '2026-10-26', time: '' }, until: { date: '2026-10-25', time: '' } }, PK),
    ).toMatch(/ends before it starts/);
    expect(
      windowProblem(
        { ...base, from: { date: '2026-10-23', time: '18:00' }, until: { date: '2026-10-23', time: '12:00' } },
        PK,
      ),
    ).toMatch(/ends before it starts/);
  });

  it('refuses daily hours that cross midnight, which would never apply', () => {
    expect(windowProblem({ ...base, dailyStart: '22:00', dailyEnd: '02:00' }, PK)).toMatch(/past midnight/);
    expect(windowProblem({ ...base, dailyStart: '22:00:00', dailyEnd: '02:00' }, PK)).toMatch(/past midnight/);
  });

  it('accepts daily hours within one day, and the same time loaded with seconds', () => {
    expect(windowProblem({ ...base, dailyStart: '18:00', dailyEnd: '23:00' }, PK)).toBeNull();
    expect(windowProblem({ ...base, dailyStart: '02:00:00', dailyEnd: '02:00' }, PK)).toBeNull();
  });
});

describe('windowSummary', () => {
  it('says the weekend window in plain words', () => {
    expect(
      windowSummary(
        {
          from: { date: '2026-10-23', time: '' },
          until: { date: '2026-10-26', time: '02:00' },
          dailyStart: '',
          dailyEnd: '',
          days: [],
        },
        PK,
      ),
    ).toBe('Runs from the start of Fri 23 Oct 2026 until 2:00 AM on Mon 26 Oct 2026 (Pakistan time).');
  });

  it('makes the old mistake visible: daily hours ending 2 AM mean 12–2 AM every day', () => {
    expect(
      windowSummary(
        {
          from: { date: '2026-10-23', time: '' },
          until: { date: '2026-10-26', time: '' },
          dailyStart: '',
          dailyEnd: '02:00:00',
          days: [5, 6, 0, 1],
        },
        PK,
      ),
    ).toBe(
      'Runs from the start of Fri 23 Oct 2026 until the end of Mon 26 Oct 2026 (Pakistan time). ' +
        'Only between 12:00 AM and 2:00 AM each day. Only on Sun, Mon, Fri, Sat.',
    );
  });

  it('handles an open start or end, and nothing at all', () => {
    const w = { dailyStart: '', dailyEnd: '', days: [] as number[] };
    expect(windowSummary({ ...w, from: none, until: { date: '2026-11-30', time: '' } }, PK)).toBe(
      'Runs until the end of Mon 30 Nov 2026 (Pakistan time).',
    );
    expect(windowSummary({ ...w, from: { date: '2026-10-23', time: '18:00' }, until: none }, PK)).toBe(
      'Runs from 6:00 PM on Fri 23 Oct 2026 with no end date (Pakistan time).',
    );
    expect(windowSummary({ ...w, from: none, until: none }, PK)).toBeNull();
    expect(windowSummary({ ...w, from: none, until: none, days: [0, 1, 2, 3, 4, 5, 6] }, PK)).toBeNull();
  });
});

describe('offerTimezone', () => {
  const branches = [
    { id: 1, timezone: 'Asia/Karachi' },
    { id: 2, timezone: 'Asia/Karachi' },
    { id: 3, timezone: 'Asia/Dubai' },
  ];

  it('uses the most common timezone of all branches when none are picked', () => {
    expect(offerTimezone(branches, [])).toBe('Asia/Karachi');
  });

  it('uses the picked branches', () => {
    expect(offerTimezone(branches, [3])).toBe('Asia/Dubai');
  });

  it('falls back to Pakistan time', () => {
    expect(offerTimezone(undefined, [])).toBe('Asia/Karachi');
    expect(offerTimezone([{ id: 1, timezone: null }], [])).toBe('Asia/Karachi');
  });
});

describe('formatClockTime', () => {
  it('formats 24-hour times as 12-hour', () => {
    expect(formatClockTime('00:00')).toBe('12:00 AM');
    expect(formatClockTime('02:00:00')).toBe('2:00 AM');
    expect(formatClockTime('12:30')).toBe('12:30 PM');
    expect(formatClockTime('23:59')).toBe('11:59 PM');
  });
});
