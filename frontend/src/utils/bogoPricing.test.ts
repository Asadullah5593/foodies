import { describe, test, expect } from 'vitest';
import { bogoUnitDiscounts, priceBogoComponents, bogoDealTotal } from './bogoPricing';

describe('bogoPricing (client mirror)', () => {
  test('cheaper of two is halved', () => {
    expect(bogoUnitDiscounts([1800, 1200], 1, 1, 50)).toEqual([0, 600]);
    expect(bogoUnitDiscounts([1200, 1800], 1, 1, 50)).toEqual([600, 0]);
  });

  test('equal prices discount exactly one', () => {
    expect(bogoUnitDiscounts([1500, 1500], 1, 1, 50)).toEqual([0, 750]);
  });

  test('priceBogoComponents returns full + half-cheaper', () => {
    expect(priceBogoComponents([1800, 1200], 1, 1, 50)).toEqual([1800, 600]);
  });

  test('bogoDealTotal sums full + half-cheaper', () => {
    expect(bogoDealTotal([1749, 1949], 1, 1, 50)).toBe(round2Sum(1949, 1749 / 2));
    expect(bogoDealTotal([1500, 1500], 1, 1, 50)).toBe(2250);
  });

  test('pct 0 → no discount', () => {
    expect(bogoDealTotal([1800, 1200], 1, 1, 0)).toBe(3000);
  });
});

function round2Sum(a: number, b: number): number {
  return Math.round((a + b) * 100) / 100;
}
