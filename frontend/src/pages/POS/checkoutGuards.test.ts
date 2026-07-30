import { describe, it, expect } from 'vitest';
import { canPlaceOrder } from './checkoutGuards';

const input = (over: Partial<Parameters<typeof canPlaceOrder>[0]> = {}) => ({
  orderTotal: 500,
  itemCount: 1,
  discountAmount: 0,
  loyaltyDiscount: 0,
  ...over,
});

describe('canPlaceOrder', () => {
  it('allows an ordinary positive total', () => {
    expect(canPlaceOrder(input())).toBe(true);
  });

  it('allows a zero total when a discount covered the bill', () => {
    // The 100% staff-discount case — this is what the old `total <= 0` guard
    // blocked, making the comp button unusable.
    expect(
      canPlaceOrder(input({ orderTotal: 0, discountAmount: 300 })),
    ).toBe(true);
  });

  it('allows a zero total when loyalty covered the bill', () => {
    expect(
      canPlaceOrder(input({ orderTotal: 0, loyaltyDiscount: 300 })),
    ).toBe(true);
  });

  it('refuses a zero total on an undiscounted cart', () => {
    // No discount explains the zero, so the quote is missing or mispriced —
    // placing it would give the food away by accident.
    expect(canPlaceOrder(input({ orderTotal: 0 }))).toBe(false);
  });

  it('refuses a zero total with an empty cart', () => {
    expect(
      canPlaceOrder(input({ orderTotal: 0, itemCount: 0, discountAmount: 300 })),
    ).toBe(false);
  });

  it('always refuses a negative total', () => {
    expect(
      canPlaceOrder(input({ orderTotal: -1, discountAmount: 500 })),
    ).toBe(false);
  });

  it('refuses a non-numeric total rather than treating it as free', () => {
    expect(canPlaceOrder(input({ orderTotal: NaN }))).toBe(false);
  });
});
