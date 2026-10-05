import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PrintedVouchers from './PrintedVouchers';
import { PrintedVoucher, PrintedVoucherFormOptions } from '../../types';

const getPrintedVouchers = vi.fn();
const getPrintedVoucherFormOptions = vi.fn();
const createPrintedVoucher = vi.fn();
const updatePrintedVoucher = vi.fn();
const deletePrintedVoucher = vi.fn();
vi.mock('../../services/api', () => ({
  adminService: {
    getPrintedVouchers: () => getPrintedVouchers(),
    getPrintedVoucherFormOptions: (id: number) => getPrintedVoucherFormOptions(id),
    createPrintedVoucher: (d: unknown) => createPrintedVoucher(d),
    updatePrintedVoucher: (id: number, d: unknown) => updatePrintedVoucher(id, d),
    deletePrintedVoucher: (id: number) => deletePrintedVoucher(id),
  },
}));
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: vi.fn().mockResolvedValue({
      data: [
        { id: 23, name: 'Peperi Co' },
        { id: 25, name: 'Fireaway' },
      ],
    }),
  },
}));
const confirmDialog = vi.fn();
vi.mock('../../utils/sweetAlert', () => ({ confirmDialog: (o: unknown) => confirmDialog(o) }));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: (m: string) => toastError(m) },
}));

let granted: string[] = [];
vi.mock('../../hooks/useHasPermission', () => ({
  useHasPermission: (p: string) => granted.includes(p),
}));

const voucher = (over: Partial<PrintedVoucher>): PrintedVoucher => ({
  id: 1,
  name: 'Any Large Pizza',
  brand_id: 25,
  brand_name: 'Fireaway',
  voucher_type: 'fixed_price',
  value: 999,
  max_discount_amount: null,
  category_ids: [501, 502],
  category_names: ['Classic', 'Signature'],
  product_ids: [],
  product_names: [],
  included_modifier_ids: [],
  included_modifier_names: [],
  eligibility_branch_ids: [],
  branch_names: [],
  order_types: ['pickup', 'dine_in'],
  valid_from: null,
  valid_until: '2099-11-30',
  sort_order: 0,
  is_active: true,
  ...over,
});

const MEAL = voucher({
  id: 2,
  name: 'Classic Smashed Burger Meal',
  brand_id: 23,
  brand_name: 'Peperi Co',
  value: 799,
  category_ids: [],
  category_names: [],
  product_ids: [300],
  product_names: ['Smashed Classic'],
  included_modifier_ids: [9001],
  included_modifier_names: ['Add Fries & Drink'],
});

const PEPERI_OPTIONS: PrintedVoucherFormOptions = {
  categories: [{ id: 600, name: 'Beef Smashed Special', is_active: true }],
  products: [
    { id: 300, name: 'Smashed Classic', base_price: 999, is_active: true, category_id: 600, category_name: 'Beef Smashed Special', modifier_group_ids: [10] },
  ],
  modifier_options: [{ id: 9001, name: 'Add Fries & Drink', price: 350, group_id: 10, group_name: 'Make it a Meal?' }],
  branches: [{ id: 10, name: 'Pine Avenue', is_active: true }],
};

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PrintedVouchers />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Printed Vouchers page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    granted = ['printed-vouchers:view', 'printed-vouchers:create', 'printed-vouchers:edit', 'printed-vouchers:delete'];
    getPrintedVouchers.mockResolvedValue([voucher({}), MEAL, voucher({ id: 3, name: '30% off', voucher_type: 'percentage', value: 30, valid_until: '2020-01-01' })]);
    getPrintedVoucherFormOptions.mockResolvedValue(PEPERI_OPTIONS);
    createPrintedVoucher.mockResolvedValue({});
    updatePrintedVoucher.mockResolvedValue({});
    deletePrintedVoucher.mockResolvedValue({});
  });

  it('lists the vouchers by brand with what each one applies to', async () => {
    renderPage();
    const pizza = await screen.findByTestId('voucher-1');
    expect(within(pizza).getByText('Rs 999')).toBeInTheDocument();
    expect(within(pizza).getByText('Classic, Signature')).toBeInTheDocument();
    expect(within(pizza).getByText(/Takeaway, Dine-in · Until 30 Nov 2099/)).toBeInTheDocument();
    expect(within(pizza).getByText('Active')).toBeInTheDocument();

    const meal = screen.getByTestId('voucher-2');
    expect(within(meal).getByText('Rs 799')).toBeInTheDocument();
    expect(within(meal).getByText('Smashed Classic')).toBeInTheDocument();
    expect(within(meal).getByText('Add Fries & Drink')).toBeInTheDocument();

    // One heading per brand.
    expect(screen.getByRole('heading', { name: /Fireaway · 2/ })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /Peperi Co · 1/ })).toBeInTheDocument();
  });

  it('flags a voucher that is past its last day', async () => {
    renderPage();
    const old = await screen.findByTestId('voucher-3');
    expect(within(old).getByText('30% off', { selector: 'span' })).toBeInTheDocument();
    expect(within(old).getByText('Expired')).toBeInTheDocument();
  });

  it('refuses to save a fixed price with nothing to apply it to', async () => {
    renderPage();
    await screen.findByTestId('voucher-1');
    fireEvent.click(screen.getByRole('button', { name: /Add a voucher/ }));
    fireEvent.change(screen.getByLabelText(/Voucher name/), { target: { value: 'Full Peri Peri Chicken' } });
    fireEvent.change(screen.getByLabelText(/Brand/), { target: { value: '23' } });
    fireEvent.change(screen.getByLabelText(/Voucher price/), { target: { value: '1499' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add voucher' }));
    expect(toastError).toHaveBeenCalledWith('Choose the categories or products this voucher price applies to');
    expect(createPrintedVoucher).not.toHaveBeenCalled();
  });

  it('creates a percentage voucher for the whole menu of the chosen brand', async () => {
    renderPage();
    await screen.findByTestId('voucher-1');
    fireEvent.click(screen.getByRole('button', { name: /Add a voucher/ }));
    fireEvent.change(screen.getByLabelText(/Voucher name/), { target: { value: '30% off' } });
    fireEvent.change(screen.getByLabelText(/Brand/), { target: { value: '23' } });
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'percentage' } });
    fireEvent.change(screen.getByLabelText(/Percent off/), { target: { value: '30' } });
    fireEvent.change(screen.getByLabelText('Valid until'), { target: { value: '2026-11-30' } });
    // Not valid for delivery: untick it.
    fireEvent.click(screen.getByRole('button', { name: 'Delivery' }));
    fireEvent.click(screen.getByRole('button', { name: 'Add voucher' }));

    await waitFor(() => expect(createPrintedVoucher).toHaveBeenCalledTimes(1));
    expect(createPrintedVoucher).toHaveBeenCalledWith(
      expect.objectContaining({
        name: '30% off',
        brand_id: 23,
        voucher_type: 'percentage',
        value: 30,
        category_ids: [],
        product_ids: [],
        included_modifier_ids: [],
        order_types: ['pickup', 'dine_in'],
        valid_until: '2026-11-30',
        is_active: true,
      }),
    );
    // The form asked for that brand's lists, and no other.
    expect(getPrintedVoucherFormOptions).toHaveBeenCalledWith(23);
  });

  it('keeps a meal voucher\'s "price includes" option when it is edited', async () => {
    renderPage();
    const meal = await screen.findByTestId('voucher-2');
    fireEvent.click(within(meal).getByRole('button', { name: 'Edit Classic Smashed Burger Meal' }));
    // The saved option is matched to the brand's lists once they load.
    await screen.findByText(/Price also includes/);
    fireEvent.change(screen.getByLabelText(/Voucher price/), { target: { value: '849' } });
    await waitFor(() => expect(getPrintedVoucherFormOptions).toHaveBeenCalledWith(23));
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));

    await waitFor(() => expect(updatePrintedVoucher).toHaveBeenCalledTimes(1));
    expect(updatePrintedVoucher).toHaveBeenCalledWith(
      2,
      expect.objectContaining({ value: 849, product_ids: [300], included_modifier_ids: [9001] }),
    );
  });

  it('deletes only after confirming, and says the history is kept', async () => {
    confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    renderPage();
    const pizza = await screen.findByTestId('voucher-1');
    fireEvent.click(within(pizza).getByRole('button', { name: 'Delete Any Large Pizza' }));
    await waitFor(() => expect(confirmDialog).toHaveBeenCalledTimes(1));
    expect(confirmDialog.mock.calls[0][0].text).toMatch(/keep their record/);
    expect(deletePrintedVoucher).not.toHaveBeenCalled();

    fireEvent.click(within(pizza).getByRole('button', { name: 'Delete Any Large Pizza' }));
    await waitFor(() => expect(deletePrintedVoucher).toHaveBeenCalledWith(1));
  });

  it('is read-only without the create, edit and delete permissions', async () => {
    granted = ['printed-vouchers:view'];
    renderPage();
    const pizza = await screen.findByTestId('voucher-1');
    expect(screen.queryByRole('button', { name: /Add a voucher/ })).toBeNull();
    expect(within(pizza).queryByRole('button', { name: /Edit/ })).toBeNull();
    expect(within(pizza).queryByRole('button', { name: /Delete/ })).toBeNull();
  });
});
