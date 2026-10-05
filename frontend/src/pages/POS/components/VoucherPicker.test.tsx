import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VoucherPicker from './VoucherPicker';
import { TillVoucher } from '../../../types';

const vouchers: TillVoucher[] = [
  { id: 1, name: 'Any Large Pizza', voucher_type: 'fixed_price', value: 999 },
  { id: 2, name: '30% off', voucher_type: 'percentage', value: 30 },
];

describe('VoucherPicker', () => {
  it('shows a button per voucher with what it is worth', () => {
    render(<VoucherPicker vouchers={vouchers} selectedId={null} onSelect={vi.fn()} />);
    expect(screen.getByRole('button', { name: 'Any Large Pizza — Rs 999' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '30% off — 30% off' })).toBeTruthy();
  });

  it('renders nothing when no voucher can be used on this order', () => {
    // No permission, another brand's cart, a delivery order, or none set up.
    const { container } = render(<VoucherPicker vouchers={[]} selectedId={null} onSelect={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('selects one voucher at a time and clears it on a second tap', () => {
    const onSelect = vi.fn();
    const { rerender } = render(<VoucherPicker vouchers={vouchers} selectedId={null} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole('button', { name: /Any Large Pizza/ }));
    expect(onSelect).toHaveBeenCalledWith(1);

    rerender(<VoucherPicker vouchers={vouchers} selectedId={1} onSelect={onSelect} />);
    expect(screen.getByRole('button', { name: /Any Large Pizza/ }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: /30% off —/ }).getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(screen.getByRole('button', { name: /Any Large Pizza/ }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it('says what the voucher took off and that other discounts are off', () => {
    render(<VoucherPicker vouchers={vouchers} selectedId={1} onSelect={vi.fn()} applied appliedAmount={950} />);
    expect(screen.getByText(/Any Large Pizza: −Rs\. 950\.00/)).toBeTruthy();
    expect(screen.getByText(/Other discounts are switched off/)).toBeTruthy();
  });

  it('tells the cashier why a selected voucher is not applied', () => {
    render(
      <VoucherPicker
        vouchers={vouchers}
        selectedId={1}
        onSelect={vi.fn()}
        error="Any Large Pizza: Nothing in this cart qualifies for this voucher."
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Nothing in this cart qualifies');
    expect(alert.textContent).toContain('Fix the cart or clear the voucher');
  });

  it('has no Clear button and no message until a voucher is picked', () => {
    render(<VoucherPicker vouchers={vouchers} selectedId={null} onSelect={vi.fn()} error="stale" />);
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
