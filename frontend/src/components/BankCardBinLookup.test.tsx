import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const lookupBankCardBin = vi.fn();
vi.mock('../services/api/adminService', () => ({
  adminService: {
    lookupBankCardBin: (...a: unknown[]) => lookupBankCardBin(...a),
  },
}));

import BankCardBinLookup from './BankCardBinLookup';

const match = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'Premium Debit',
  bank: 'HBL',
  network: 'visa',
  matched_prefix: '455670',
  has_offer: true,
  is_active: true,
  discount_type: 'percentage',
  discount_value: 10,
  min_order_amount: 1000,
  max_discount_amount: 500,
  valid_from: null,
  valid_until: null,
  valid_time_start: null,
  valid_time_end: null,
  valid_days_of_week: [],
  available_now: true,
  ...over,
});

beforeEach(() => vi.clearAllMocks());

const type = (digits: string) =>
  fireEvent.change(screen.getByLabelText('Card BIN'), { target: { value: digits } });
const check = () => fireEvent.click(screen.getByRole('button', { name: 'Check' }));

describe('BankCardBinLookup', () => {
  it('requires at least 4 digits and strips non-digits', () => {
    render(<BankCardBinLookup />);
    type('45a');
    expect(screen.getByRole('button', { name: 'Check' })).toBeDisabled();
    expect(lookupBankCardBin).not.toHaveBeenCalled();
    type('4556');
    expect(screen.getByRole('button', { name: 'Check' })).toBeEnabled();
  });

  it('reports an available discount with its terms, passing the branch for time windows', async () => {
    lookupBankCardBin.mockResolvedValue({ bin: '455670', matches: [match()] });
    render(<BankCardBinLookup branchId={7} />);
    type('455670');
    check();
    expect(await screen.findByText('DISCOUNT AVAILABLE')).toBeInTheDocument();
    expect(screen.getByText('HBL — Premium Debit')).toBeInTheDocument();
    expect(screen.getByText(/10% off \(up to .*500.*, min order .*1,?000.*\)/)).toBeInTheDocument();
    expect(lookupBankCardBin).toHaveBeenCalledWith('455670', 7);
  });

  it('says clearly when the matched card has NO discount', async () => {
    lookupBankCardBin.mockResolvedValue({
      bin: '455670',
      matches: [match({ has_offer: false, discount_value: null, available_now: false })],
    });
    render(<BankCardBinLookup />);
    type('455670');
    check();
    expect(await screen.findByText('NO DISCOUNT')).toBeInTheDocument();
  });

  it('flags a discount that exists but is outside its window right now', async () => {
    lookupBankCardBin.mockResolvedValue({
      bin: '455670',
      matches: [match({ available_now: false, valid_time_start: '12:00:00', valid_time_end: '15:00:00' })],
    });
    render(<BankCardBinLookup branchId={7} />);
    type('455670');
    check();
    expect(await screen.findByText('HAS DISCOUNT — NOT AVAILABLE NOW')).toBeInTheDocument();
    expect(screen.getByText(/12:00–15:00/)).toBeInTheDocument();
  });

  it('answers "no discount" when nothing matches the BIN', async () => {
    lookupBankCardBin.mockResolvedValue({ bin: '999999', matches: [] });
    render(<BankCardBinLookup />);
    type('999999');
    check();
    expect(await screen.findByText(/No card matches BIN 999999/)).toBeInTheDocument();
    expect(screen.getByText('no discount')).toBeInTheDocument();
  });
});
