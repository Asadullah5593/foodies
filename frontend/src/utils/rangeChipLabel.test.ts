import { describe, expect, it } from 'vitest';
import { rangeChipLabel } from './rangeChipLabel';

const NOW = new Date(2026, 9, 8);

describe('rangeChipLabel', () => {
  it('formats a range in the current year without the year', () => {
    expect(rangeChipLabel('2026-06-09', '2026-10-08', NOW)).toBe('9 Jun – 8 Oct');
  });
  it('collapses a single day', () => {
    expect(rangeChipLabel('2026-10-08', '2026-10-08', NOW)).toBe('8 Oct');
  });
  it('adds years when the range is not in the current year or spans two', () => {
    expect(rangeChipLabel('2025-12-20', '2026-01-05', NOW)).toBe('20 Dec 2025 – 5 Jan 2026');
    expect(rangeChipLabel('2025-03-01', '2025-03-31', NOW)).toBe('1 Mar 2025 – 31 Mar 2025');
  });
  it('handles open ends', () => {
    expect(rangeChipLabel('2026-06-09', '', NOW)).toBe('From 9 Jun');
    expect(rangeChipLabel('', '2026-10-08', NOW)).toBe('Up to 8 Oct');
    expect(rangeChipLabel('', '', NOW)).toBe('All dates');
  });
});
