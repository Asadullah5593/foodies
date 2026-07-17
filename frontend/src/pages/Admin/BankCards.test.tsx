import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';

const getBankCards = vi.fn();
const createBankCard = vi.fn();
const updateBankCard = vi.fn();
vi.mock('../../services/api/adminService', () => ({
  adminService: {
    getBankCards: (...a: unknown[]) => getBankCards(...a),
    createBankCard: (...a: unknown[]) => createBankCard(...a),
    updateBankCard: (...a: unknown[]) => updateBankCard(...a),
    deleteBankCard: vi.fn(),
    lookupBankCardBin: vi.fn(),
  },
}));
vi.mock('../../utils/apiClient', () => ({
  default: { get: vi.fn().mockResolvedValue({ data: [{ id: 1, name: 'Fireaway' }] }) },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: true, allowed_brand_ids: null } }),
}));

import BankCards from './BankCards';

const card = (over: Record<string, unknown> = {}) => ({
  id: 1,
  name: 'HBL Premium',
  bank: 'HBL',
  network: 'VISA',
  bin_prefixes: ['401234'],
  eligibility_brand_ids: [],
  effective_brand_ids: null,
  manage_scope: 'full',
  discount_type: 'percentage',
  discount_value: 25,
  is_active: true,
  ...over,
});

beforeEach(() => {
  vi.clearAllMocks();
  getBankCards.mockResolvedValue([card()]);
  createBankCard.mockResolvedValue({});
  updateBankCard.mockResolvedValue({});
});

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <BankCards />
    </QueryClientProvider>,
  );
};

/** The form lives in a modal: nothing until it's opened. */
const cardNameField = () => screen.queryByPlaceholderText('HBL Premium Debit');

describe('Bank Cards page', () => {
  it('keeps the form in a modal until a card is added', async () => {
    renderPage();
    expect(await screen.findByText('HBL Premium')).toBeInTheDocument();
    expect(cardNameField()).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Add a card/ }));
    expect(await screen.findByText('Add a card', { selector: 'div' })).toBeInTheDocument();
    expect(cardNameField()).toBeInTheDocument();
  });

  it('shows what the customer gets on the card face', async () => {
    getBankCards.mockResolvedValue([
      card(),
      card({ id: 2, name: 'UBL Flat', discount_type: 'flat', discount_value: 200 }),
      card({ id: 3, name: 'No Offer', discount_type: null, discount_value: null }),
    ]);
    renderPage();
    expect(await screen.findByText('25% off')).toBeInTheDocument();
    expect(screen.getByText('Rs. 200 off')).toBeInTheDocument();
    // A record-only card advertises nothing.
    expect(screen.queryByText(/0% off/)).not.toBeInTheDocument();
  });

  it('creates a card from the modal and closes it', async () => {
    renderPage();
    await screen.findByText('HBL Premium');
    fireEvent.click(screen.getByRole('button', { name: /Add a card/ }));
    fireEvent.change(await screen.findByPlaceholderText('HBL Premium Debit'), {
      target: { value: 'Meezan Platinum' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Add card' }));

    await waitFor(() => expect(createBankCard).toHaveBeenCalled());
    expect(createBankCard.mock.calls[0][0]).toMatchObject({ name: 'Meezan Platinum' });
    await waitFor(() => expect(cardNameField()).not.toBeInTheDocument());
  });

  it('opens the modal prefilled when editing an existing card', async () => {
    renderPage();
    await screen.findByText('HBL Premium');
    fireEvent.click(screen.getByTitle('Edit'));

    const name = await screen.findByPlaceholderText('HBL Premium Debit');
    expect(name).toHaveValue('HBL Premium');
    expect(screen.getByPlaceholderText('401234, 5321')).toHaveValue('401234');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateBankCard).toHaveBeenCalledWith(1, expect.objectContaining({ name: 'HBL Premium' })));
  });

  it('does not save a nameless card', async () => {
    renderPage();
    await screen.findByText('HBL Premium');
    fireEvent.click(screen.getByRole('button', { name: /Add a card/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add card' }));
    await waitFor(() => expect(createBankCard).not.toHaveBeenCalled());
  });

  it('reopens a clean form after editing, so the next add is not prefilled', async () => {
    renderPage();
    await screen.findByText('HBL Premium');
    fireEvent.click(screen.getByTitle('Edit'));
    expect(await screen.findByPlaceholderText('HBL Premium Debit')).toHaveValue('HBL Premium');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(cardNameField()).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole('button', { name: /Add a card/ }));
    expect(await screen.findByPlaceholderText('HBL Premium Debit')).toHaveValue('');
  });

  it('opens the same blank form from the "Add another card" tile', async () => {
    renderPage();
    await screen.findByText('HBL Premium');
    fireEvent.click(screen.getByRole('button', { name: /Add another card/ }));
    expect(await screen.findByPlaceholderText('HBL Premium Debit')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Add card' })).toBeInTheDocument();
  });
});
