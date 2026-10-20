import { describe, expect, it } from 'vitest';
import {
  audienceSummary,
  describeRepeat,
  describeSchedule,
  momentLabel,
  percent,
  perCustomerText,
  ruleSummary,
  sampleText,
  time12,
} from './pushText';
import type { PushMeta } from '../../../types';

const now = new Date(2026, 9, 20, 12, 0);
const meta = {
  rules: [],
  options: {
    brands: [
      { id: 28, name: 'Wok & Go' },
      { id: 23, name: 'Peperi. Co' },
      { id: 25, name: 'Fireaway' },
    ],
    branches: [{ id: 4, name: 'Gulberg' }],
    categories: [],
    items: [],
    messages: [{ id: 9, label: 'Weekend deals', last_run_at: null }],
    order_types: [],
    sources: [],
    platforms: [],
  },
  personal_tokens: [
    { key: 'first_name', label: 'First name', example: 'Ali' },
    { key: 'app_points', label: 'Points', example: '450' },
  ],
} as unknown as PushMeta;

describe('push text', () => {
  it('writes times on a 12-hour clock', () => {
    expect(time12('19:00')).toBe('7:00 PM');
    expect(time12('00:30')).toBe('12:30 AM');
    expect(time12('12:05')).toBe('12:05 PM');
  });

  it('describes repeats in words', () => {
    const base = { time: '19:00', starts_on: '2026-10-20', ends: 'never' as const };
    expect(describeRepeat({ ...base, frequency: 'daily' }, now)).toBe('Every day at 7:00 PM');
    expect(describeRepeat({ ...base, frequency: 'weekly', weekdays: [5] }, now)).toBe('Every Friday at 7:00 PM');
    expect(describeRepeat({ ...base, frequency: 'weekly', weekdays: [1, 2, 3, 4, 5] }, now)).toBe(
      'Every weekday (Mon–Fri) at 7:00 PM',
    );
    expect(describeRepeat({ ...base, frequency: 'weekly', weekdays: [0, 6] }, now)).toBe(
      'Every weekend day (Sat–Sun) at 7:00 PM',
    );
    expect(describeRepeat({ ...base, frequency: 'weekly', weekdays: [5, 1, 3] }, now)).toBe(
      'Every Monday, Wednesday and Friday at 7:00 PM',
    );
    expect(describeRepeat({ ...base, frequency: 'monthly', month_day: 1 }, now)).toBe(
      'On the 1st of every month at 7:00 PM',
    );
    expect(describeRepeat({ ...base, frequency: 'monthly', month_day: -1 }, now)).toBe(
      'On the last day of every month at 7:00 PM',
    );
    expect(describeRepeat({ ...base, frequency: 'every_n_days', interval_days: 3 }, now)).toBe(
      'Every 3 days at 7:00 PM',
    );
    expect(
      describeRepeat(
        { ...base, frequency: 'weekly', weekdays: [5], starts_on: '2026-10-24', ends: 'on', ends_on: '2026-12-31' },
        now,
      ),
    ).toBe('Every Friday at 7:00 PM, from 24 Oct, until 31 Dec');
    expect(describeRepeat({ ...base, frequency: 'daily', ends: 'after', max_runs: 3 }, now)).toBe(
      'Every day at 7:00 PM, 3 times in all',
    );
  });

  it('describes a whole schedule', () => {
    expect(describeSchedule({ schedule_type: 'now', send_at: null, repeat: null })).toBe('Sent straight away');
  });

  it('labels a moment read on the business clock', () => {
    expect(momentLabel({ local_date: '2026-10-23', local_time: '19:00', weekday: 5 }, now)).toBe('Fri 23 Oct, 7:00 PM');
  });

  it('summarises rules and audiences', () => {
    expect(ruleSummary({ rule: 'ordered_from_brand', params: { brand_ids: [28], within_days: 30 } }, meta)).toBe(
      'Ordered from Wok & Go in the last 30 days',
    );
    expect(ruleSummary({ rule: 'ordered_from_brand', params: { brand_ids: [28, 23, 25] } }, meta)).toBe(
      'Ordered from Wok & Go, Peperi. Co or 1 more',
    );
    expect(ruleSummary({ rule: 'got_message', params: { message_id: 9, no_order_within_days: 3 } }, meta)).toBe(
      'Got “Weekend deals” and did not order within 3 days',
    );
    expect(ruleSummary({ rule: 'joined', params: { from_days: 0, to_days: 1 } }, meta)).toBe('Joined in the last 1 day');
    expect(ruleSummary({ rule: 'platform', params: { platform: 'ios' } }, meta)).toBe('iPhone users');
    expect(audienceSummary({ match: 'all', include: [], exclude: [] }, meta)).toBe('Everyone with the app');
    expect(
      audienceSummary(
        {
          match: 'any',
          include: [
            { rule: 'lapsed', params: { days: 30 } },
            { rule: 'app_points', params: { points: 500 } },
          ],
          exclude: [{ rule: 'never_ordered', params: {} }],
        },
        meta,
      ),
    ).toBe('No order in 30 days or 500+ app points — but not: Signed up, never ordered');
  });

  it('fills placeholders with examples for the preview', () => {
    expect(sampleText('Hi {first_name|there}, {app_points} pts {coupon}', meta.personal_tokens)).toBe(
      'Hi Ali, 450 pts {coupon}',
    );
  });

  it('formats percentages and per-customer rules', () => {
    expect(percent(1, 3)).toBe('33%');
    expect(percent(1, 40)).toBe('2.5%');
    expect(percent(0, 0)).toBe('0%');
    expect(perCustomerText('days', 7)).toBe('Each customer gets it at most once every 7 days');
  });
});
