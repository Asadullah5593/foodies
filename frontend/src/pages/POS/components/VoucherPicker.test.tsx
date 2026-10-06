import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import VoucherPicker from './VoucherPicker';
import { TillVoucher } from '../../../types';

const vouchers: TillVoucher[] = [
  { id: 1, name: 'Any Large Pizza', voucher_type: 'fixed_price', value: 999 },
  { id: 3, name: 'Any Classic Box', voucher_type: 'fixed_price', value: 999 },
  { id: 2, name: '30% off', voucher_type: 'percentage', value: 30 },
];
const pizza = () => screen.getByRole('button', { name: 'Any Large Pizza — Rs 999' });
const thirty = () => screen.getByRole('button', { name: '30% off — 30% off' });

describe('VoucherPicker', () => {
  it('shows a button per voucher with what it is worth', () => {
    render(<VoucherPicker vouchers={vouchers} picks={[]} onChange={vi.fn()} />);
    expect(pizza()).toBeTruthy();
    expect(thirty()).toBeTruthy();
  });

  it('renders nothing when no voucher can be used on this order', () => {
    // No permission, another brand's cart, a delivery order, or none set up.
    const { container } = render(<VoucherPicker vouchers={[]} picks={[]} onChange={vi.fn()} />);
    expect(container.firstChild).toBeNull();
  });

  it('adds a paper per tap, so three taps are three pizza vouchers', () => {
    const onChange = vi.fn();
    const { rerender } = render(<VoucherPicker vouchers={vouchers} picks={[]} onChange={onChange} />);
    fireEvent.click(pizza());
    expect(onChange).toHaveBeenLastCalledWith([{ id: 1, quantity: 1 }]);

    rerender(<VoucherPicker vouchers={vouchers} picks={[{ id: 1, quantity: 2 }]} onChange={onChange} />);
    expect(pizza().getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByText('×2')).toBeTruthy();
    fireEvent.click(pizza());
    expect(onChange).toHaveBeenLastCalledWith([{ id: 1, quantity: 3 }]);
  });

  it('takes one paper off with the minus, and everything off with Clear', () => {
    const onChange = vi.fn();
    render(<VoucherPicker vouchers={vouchers} picks={[{ id: 1, quantity: 2 }, { id: 3, quantity: 1 }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Any Large Pizza' }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: 1, quantity: 1 }, { id: 3, quantity: 1 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove one Any Classic Box' }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: 1, quantity: 2 }]);
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('lets fixed-price vouchers combine', () => {
    const onChange = vi.fn();
    render(<VoucherPicker vouchers={vouchers} picks={[{ id: 1, quantity: 1 }]} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Any Classic Box — Rs 999' }));
    expect(onChange).toHaveBeenLastCalledWith([{ id: 1, quantity: 1 }, { id: 3, quantity: 1 }]);
  });

  it('keeps the percentage voucher on its own, in both directions', () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <VoucherPicker vouchers={vouchers} picks={[{ id: 1, quantity: 2 }]} onChange={onChange} />,
    );
    // 30% off replaces the pizza vouchers…
    fireEvent.click(thirty());
    expect(onChange).toHaveBeenLastCalledWith([{ id: 2, quantity: 1 }]);
    // …a pizza voucher replaces 30% off…
    rerender(<VoucherPicker vouchers={vouchers} picks={[{ id: 2, quantity: 1 }]} onChange={onChange} />);
    fireEvent.click(pizza());
    expect(onChange).toHaveBeenLastCalledWith([{ id: 1, quantity: 1 }]);
    // …and a second tap on 30% off takes it off.
    fireEvent.click(thirty());
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it('says what one voucher took off and that other discounts are off', () => {
    render(
      <VoucherPicker vouchers={vouchers} picks={[{ id: 1, quantity: 1 }]} onChange={vi.fn()} applied appliedAmount={950} />,
    );
    expect(screen.getByText(/Any Large Pizza: −Rs\. 950\.00/)).toBeTruthy();
    expect(screen.getByText(/Other discounts are switched off/)).toBeTruthy();
  });

  it('lists each voucher and the total when several are on', () => {
    render(
      <VoucherPicker
        vouchers={vouchers}
        picks={[{ id: 1, quantity: 3 }, { id: 3, quantity: 1 }]}
        onChange={vi.fn()}
        applied
        appliedAmount={3000}
        breakdown={[
          { voucher_id: 1, quantity: 3, discount_amount: 2200 },
          { voucher_id: 3, quantity: 1, discount_amount: 800 },
        ]}
      />,
    );
    expect(screen.getByText(/Any Large Pizza ×3: −Rs\. 2200\.00/)).toBeTruthy();
    expect(screen.getByText(/Any Classic Box: −Rs\. 800\.00/)).toBeTruthy();
    expect(screen.getByText(/Vouchers: −Rs\. 3000\.00\. Other discounts are switched off/)).toBeTruthy();
  });

  it('tells the cashier why the vouchers are not applied', () => {
    render(
      <VoucherPicker
        vouchers={vouchers}
        picks={[{ id: 1, quantity: 3 }]}
        onChange={vi.fn()}
        error="Any Large Pizza: Only 2 items in the cart qualify, but 3 vouchers were applied. Remove one or add the item."
      />,
    );
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Only 2 items in the cart qualify');
    expect(alert.textContent).toContain('Fix the cart or clear the voucher');
  });

  it('has no Clear button and no message until a voucher is picked', () => {
    render(<VoucherPicker vouchers={vouchers} picks={[]} onChange={vi.fn()} error="stale" />);
    expect(screen.queryByRole('button', { name: 'Clear' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
