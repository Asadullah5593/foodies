import { describe, expect, it } from 'vitest';
import { bucketTrend, pickTrendBucket } from './charts';
import type { OrderSeriesResponse } from './types';

type Order = OrderSeriesResponse['orders'][number];
const order = (placed_at: string, total_amount: number, brand_id: number | null, status = 'completed'): Order => ({
  order_number: '001',
  placed_at,
  total_amount,
  status,
  order_type: 'delivery',
  brand_id,
  brand_name: brand_id == null ? null : `Brand ${brand_id}`,
});

describe('pickTrendBucket (phone trend chart)', () => {
  it('uses days up to a month, weeks up to six months, months beyond', () => {
    expect(pickTrendBucket('2026-10-02', '2026-10-08')).toBe('day');
    expect(pickTrendBucket('2026-09-08', '2026-10-08')).toBe('day'); // 31 days
    expect(pickTrendBucket('2026-09-07', '2026-10-08')).toBe('week'); // 32 days
    expect(pickTrendBucket('2026-06-09', '2026-10-08')).toBe('week'); // 122 days
    expect(pickTrendBucket('2026-01-01', '2026-07-02')).toBe('week'); // 183 days
    expect(pickTrendBucket('2026-01-01', '2026-07-03')).toBe('month'); // 184 days
  });

  it('falls back to days without a range', () => {
    expect(pickTrendBucket(undefined, undefined)).toBe('day');
  });
});

describe('bucketTrend', () => {
  const keys = ['brand_1', 'brand_2'];

  it('sums completed revenue per day and brand, and fills empty days with zero', () => {
    const rows = bucketTrend(
      [
        order('2026-10-02T10:00:00', 100, 1),
        order('2026-10-02T18:00:00', 50, 1),
        order('2026-10-02T12:00:00', 70, 2),
        order('2026-10-04T12:00:00', 30, 2),
        order('2026-10-04T13:00:00', 999, 1, 'cancelled'),
      ],
      'day',
      keys,
      { from: '2026-10-01', to: '2026-10-05' },
    );
    expect(rows.map((r) => r.label)).toEqual(['1 Oct', '2 Oct', '3 Oct', '4 Oct', '5 Oct']);
    expect(rows[1]).toMatchObject({ brand_1: 150, brand_2: 70, orders: 3, completed: 3 });
    expect(rows[2]).toMatchObject({ brand_1: 0, brand_2: 0, orders: 0 });
    // the cancelled order counts as an order but adds no revenue
    expect(rows[3]).toMatchObject({ brand_1: 0, brand_2: 30, orders: 2, completed: 1 });
  });

  it('groups weeks from Monday and months from the 1st', () => {
    const weekly = bucketTrend([order('2026-10-08T09:00:00', 10, 1)], 'week', keys, { from: '2026-10-05', to: '2026-10-11' });
    expect(weekly).toHaveLength(1);
    expect(weekly[0]).toMatchObject({ label: '5 Oct', title: 'Week of 5 Oct', brand_1: 10 });
    const monthly = bucketTrend([order('2026-08-20T09:00:00', 10, 2)], 'month', keys, { from: '2026-07-15', to: '2026-09-02' });
    expect(monthly.map((r) => r.label)).toEqual(['Jul', 'Aug', 'Sep']);
    expect(monthly[1]).toMatchObject({ title: 'August 2026', brand_2: 10 });
  });

  it('starts at the oldest order when the list was capped', () => {
    const rows = bucketTrend([order('2026-10-03T09:00:00', 10, 1), order('2026-10-05T09:00:00', 20, 1)], 'day', keys, {
      from: '2026-09-01',
      to: '2026-10-05',
      truncated: true,
    });
    expect(rows[0].label).toBe('3 Oct');
    expect(rows).toHaveLength(3);
  });

  it('returns nothing for no orders', () => {
    expect(bucketTrend([], 'day', keys, { from: '2026-10-01', to: '2026-10-05' })).toEqual([]);
  });
});
