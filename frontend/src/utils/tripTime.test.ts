import { describe, it, expect } from 'vitest';
import { formatTripDuration } from './tripTime';

describe('formatTripDuration', () => {
  it('reads as minutes for an ordinary trip', () => {
    expect(formatTripDuration(23 * 60)).toBe('23 min');
    expect(formatTripDuration(23 * 60 + 29)).toBe('23 min');
    expect(formatTripDuration(23 * 60 + 31)).toBe('24 min');
  });

  it('switches to hours and minutes from an hour up', () => {
    expect(formatTripDuration(60 * 60)).toBe('1 h 00 min');
    expect(formatTripDuration(65 * 60)).toBe('1 h 05 min');
    // 59 min 40 s rounds up to the hour rather than printing "60 min".
    expect(formatTripDuration(59 * 60 + 40)).toBe('1 h 00 min');
  });

  it('does not print "0 min" for a trip under a minute', () => {
    expect(formatTripDuration(0)).toBe('<1 min');
    expect(formatTripDuration(59)).toBe('<1 min');
  });

  it('shows a dash when the trip was not recorded', () => {
    expect(formatTripDuration(null)).toBe('—');
    expect(formatTripDuration(undefined)).toBe('—');
    expect(formatTripDuration(-5)).toBe('—');
    expect(formatTripDuration(Number.NaN)).toBe('—');
  });
});
