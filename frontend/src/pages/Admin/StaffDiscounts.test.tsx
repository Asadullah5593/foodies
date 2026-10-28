import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import StaffDiscounts from './StaffDiscounts';
import { StaffDiscount } from '../../types';

const getStaffDiscounts = vi.fn();
const createStaffDiscount = vi.fn();
const updateStaffDiscount = vi.fn();
vi.mock('../../services/api', () => ({
  adminService: {
    getStaffDiscounts: () => getStaffDiscounts(),
    createStaffDiscount: (d: unknown) => createStaffDiscount(d),
    updateStaffDiscount: (id: number, d: unknown) => updateStaffDiscount(id, d),
    deleteStaffDiscount: vi.fn(),
  },
}));
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: vi.fn((url: string) =>
      Promise.resolve({
        data:
          url === '/admin/branches'
            ? [
                { id: 10, name: 'Gulberg' },
                { id: 11, name: 'DHA' },
                { id: 12, name: 'Johar Town' },
              ]
            : [{ id: 23, name: 'Peperi Co' }],
      }),
    ),
  },
}));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: (m: string) => toastError(m) },
}));
vi.mock('../../hooks/useHasPermission', () => ({ useHasPermission: () => true }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { tenant_id: 6, allowed_brand_ids: null } }),
}));

const preset = (over: Partial<StaffDiscount>): StaffDiscount => ({
  id: 1,
  name: '10% – Long wait',
  discount_type: 'percentage',
  value: 10,
  max_discount_amount: null,
  eligibility_brand_ids: null,
  eligibility_branch_ids: [10],
  effective_brand_ids: null,
  manage_scope: 'full',
  sort_order: 0,
  is_active: true,
  ...over,
});

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <StaffDiscounts />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  createStaffDiscount.mockResolvedValue({});
  updateStaffDiscount.mockResolvedValue({});
});

describe('Staff Discounts — branches', () => {
  it('shows where each button appears, and flags one with no branch', async () => {
    getStaffDiscounts.mockResolvedValue([
      preset({ id: 1, eligibility_branch_ids: [10] }),
      preset({ id: 2, name: 'Staff meal', eligibility_branch_ids: [10, 11, 12] }),
      preset({ id: 3, name: 'Old preset', eligibility_branch_ids: null }),
    ]);
    renderPage();
    expect(await screen.findByText('Gulberg')).toBeInTheDocument();
    expect(screen.getByText('Gulberg, DHA +1 more')).toBeInTheDocument();
    expect(screen.getByText(/No branch picked — not shown at any till/)).toBeInTheDocument();
  });

  it('will not save a button without a branch, and sends the ones picked', async () => {
    getStaffDiscounts.mockResolvedValue([]);
    renderPage();
    fireEvent.click((await screen.findAllByRole('button', { name: /Add a button/ }))[0]);
    fireEvent.change(screen.getByPlaceholderText('10% – Long wait'), { target: { value: 'Long wait' } });
    fireEvent.change(screen.getByPlaceholderText('10'), { target: { value: '10' } });

    fireEvent.click(screen.getByRole('button', { name: 'Add button' }));
    expect(toastError).toHaveBeenCalledWith('Pick at least one branch');
    expect(createStaffDiscount).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Pick branches' }));
    fireEvent.click(await screen.findByRole('option', { name: /DHA/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Add button' }));
    await waitFor(() => expect(createStaffDiscount).toHaveBeenCalled());
    expect(createStaffDiscount.mock.calls[0][0]).toMatchObject({
      name: 'Long wait',
      eligibility_branch_ids: [11],
    });
  });

  it('keeps the saved branches when a button is edited', async () => {
    getStaffDiscounts.mockResolvedValue([preset({ id: 7, eligibility_branch_ids: [10, 12] })]);
    renderPage();
    fireEvent.click(await screen.findByTitle('Edit'));
    expect(screen.getByRole('button', { name: '2 selected' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(updateStaffDiscount).toHaveBeenCalled());
    expect(updateStaffDiscount.mock.calls[0]).toEqual([7, expect.objectContaining({ eligibility_branch_ids: [10, 12] })]);
  });
});
