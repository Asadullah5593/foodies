import { describe, it, expect } from 'vitest';
import { prettyDay, rupees, voucherFace, voucherOrderTypesText, voucherValidityText } from './voucherText';

describe('voucher text', () => {
  it('prints a voucher as it reads on paper', () => {
    expect(voucherFace({ voucher_type: 'fixed_price', value: 999 })).toBe('Rs 999');
    expect(voucherFace({ voucher_type: 'fixed_price', value: 1499 })).toBe('Rs 1,499');
    expect(voucherFace({ voucher_type: 'percentage', value: 30 })).toBe('30% off');
  });

  it('shows paisa only when there are any', () => {
    expect(rupees(799)).toBe('Rs 799');
    expect(rupees(349.5)).toBe('Rs 349.50');
  });

  it('lists the order types, calling pickup what the till calls it', () => {
    expect(voucherOrderTypesText(['pickup', 'dine_in'])).toBe('Takeaway, Dine-in');
    expect(voucherOrderTypesText(null)).toBe('All order types');
    expect(voucherOrderTypesText([])).toBe('All order types');
  });

  it('reads a calendar day without shifting it across a timezone', () => {
    expect(prettyDay('2026-11-30')).toBe('30 Nov 2026');
    expect(prettyDay('2026-01-01')).toBe('1 Jan 2026');
    expect(prettyDay(null)).toBe('');
  });

  it('describes the validity window', () => {
    expect(voucherValidityText(null, '2026-11-30')).toBe('Until 30 Nov 2026');
    expect(voucherValidityText('2026-10-01', '2026-11-30')).toBe('1 Oct 2026 – 30 Nov 2026');
    expect(voucherValidityText('2026-10-01', null)).toBe('From 1 Oct 2026');
    expect(voucherValidityText(null, null)).toBe('No end date');
  });
});
