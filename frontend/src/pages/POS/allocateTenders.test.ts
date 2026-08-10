import { describe, it, expect } from 'vitest';
import { allocateTenders } from './allocateTenders';

describe('allocateTenders', () => {
  it('tenders the server total for a single-method order, ignoring a stale client amount', () => {
    // The staff-discount race: screen quoted 3560.76, server billed 3204.68.
    const out = allocateTenders(
      [{ id: 1, total_amount: 3204.68 }],
      [{ method: 'card', amount: 3560.76 }],
    );
    expect(out).toEqual([{ orderId: 1, method: 'card', amount: 3204.68 }]);
  });

  it('rescales a cash+card split to the server total and sums exactly', () => {
    const out = allocateTenders(
      [{ id: 1, total_amount: 900 }],
      [
        { method: 'cash', amount: 400 },
        { method: 'card', amount: 600 },
      ],
    );
    const total = out.reduce((s, t) => s + t.amount, 0);
    expect(Math.round(total * 100) / 100).toBe(900);
    expect(out[0]).toEqual({ orderId: 1, method: 'cash', amount: 360 });
    expect(out[1]).toEqual({ orderId: 1, method: 'card', amount: 540 });
  });

  it('gives every order of a group tenders summing to its own total', () => {
    const orders = [
      { id: 1, total_amount: 333.33 },
      { id: 2, total_amount: 666.67 },
    ];
    const out = allocateTenders(orders, [
      { method: 'cash', amount: 500 },
      { method: 'card', amount: 500 },
    ]);
    for (const o of orders) {
      const sum = out
        .filter((t) => t.orderId === o.id)
        .reduce((s, t) => s + t.amount, 0);
      expect(Math.round(sum * 100) / 100).toBe(o.total_amount);
    }
  });

  it('skips zero-total orders and returns nothing without tenders or amounts', () => {
    expect(allocateTenders([{ id: 1, total_amount: 0 }], [{ method: 'cash', amount: 10 }])).toEqual([]);
    expect(allocateTenders([{ id: 1, total_amount: 10 }], [])).toEqual([]);
    expect(allocateTenders([{ id: 1, total_amount: 10 }], [{ method: 'cash', amount: 0 }])).toEqual([]);
  });
});
