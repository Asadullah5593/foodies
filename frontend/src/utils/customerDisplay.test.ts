import { describe, it, expect } from 'vitest';
import { formatPhone, formatPoints, formatRs, nameInitials } from './customerDisplay';

describe('customerDisplay', () => {
  it('writes money with grouped thousands and two decimals', () => {
    expect(formatRs(31240)).toBe('Rs. 31,240.00');
    expect(formatRs(7014.36)).toBe('Rs. 7,014.36');
    expect(formatRs(0)).toBe('Rs. 0.00');
    expect(formatRs(null)).toBe('Rs. 0.00');
  });

  it('groups thousands in a points balance', () => {
    expect(formatPoints(12522)).toBe('12,522');
    expect(formatPoints(949)).toBe('949');
    expect(formatPoints(undefined)).toBe('0');
  });

  it('spaces a Pakistani mobile number and leaves anything else alone', () => {
    expect(formatPhone('03001234567')).toBe('0300 1234567');
    expect(formatPhone(' 03001234567 ')).toBe('0300 1234567');
    expect(formatPhone('+923001234567')).toBe('+923001234567');
    expect(formatPhone(null)).toBe('');
  });

  it('takes initials from the first two words of a name', () => {
    expect(nameInitials('John Doe')).toBe('JD');
    expect(nameInitials('syed waqar ahmed')).toBe('SW');
    expect(nameInitials('hussain')).toBe('H');
    expect(nameInitials('John Doe', 1)).toBe('J');
  });

  it('has something to show for a customer with no name', () => {
    for (const name of [null, undefined, '', '   ', '&&']) expect(nameInitials(name)).toBe('?');
  });
});
