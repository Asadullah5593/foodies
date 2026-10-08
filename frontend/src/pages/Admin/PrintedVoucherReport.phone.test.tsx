import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import PrintedVoucherReport from './PrintedVoucherReport';
import { PrintedVoucherReport as ReportData } from '../../types';

/** On a phone the report's three tables become card lists; every figure stays. */

const getPrintedVoucherReport = vi.fn();
const getPrintedVouchers = vi.fn();
vi.mock('../../services/api', () => ({
  adminService: {
    getPrintedVoucherReport: (p: unknown) => getPrintedVoucherReport(p),
    getPrintedVouchers: () => getPrintedVouchers(),
  },
}));
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (url: string) =>
      Promise.resolve({
        data: url.includes('branches')
          ? [{ id: 10, name: 'Pine Avenue' }, { id: 17, name: 'Johar Town' }]
          : [{ id: 23, name: 'Peperi Co' }, { id: 25, name: 'Fireaway' }],
      }),
  },
}));

const REPORT: ReportData = {
  date_from: '2026-10-05T00:00:00.000Z',
  date_to: '2026-10-05T23:59:59.999Z',
  totals: { redemptions: 3, papers: 4, discount: 2450, subtotal: 5247, total: 3244.52, average_discount: 612.5 },
  by_voucher: [
    { voucher_id: 1, voucher_name: 'Any Large Pizza', voucher_type: 'fixed_price', value: 999, brand_name: 'Fireaway', redemptions: 2, papers: 3, discount: 1900, total: 2317.68 },
    { voucher_id: null, voucher_name: 'Old Summer Voucher', voucher_type: null, value: null, brand_name: 'Peperi Co', redemptions: 1, papers: 1, discount: 550, total: 926.84 },
  ],
  by_day: [
    { day: '2026-10-05', branch_name: 'Pine Avenue', voucher_name: 'Any Large Pizza', redemptions: 2, papers: 3, discount: 1900 },
    { day: '2026-10-05', branch_name: 'Johar Town', voucher_name: 'Old Summer Voucher', redemptions: 1, papers: 1, discount: 550 },
  ],
  rows: [
    {
      id: 900, order_id: 'FDS-AAA', order_number: '004', placed_at: '2026-10-05T09:30:00.000Z', status: 'completed',
      order_type: 'dine_in', customer_name: 'Ali', customer_phone: '03001234567', subtotal: 1949, discount: 950,
      total: 1158.84, voucher_name: 'Any Large Pizza', papers: 1, branch_name: 'Pine Avenue', brand_name: 'Fireaway', applied_by: 'Cashier One',
    },
  ],
  rows_truncated: false,
};

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <PrintedVoucherReport />
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  setWidth(390);
  getPrintedVoucherReport.mockResolvedValue(REPORT);
  getPrintedVouchers.mockResolvedValue([{ id: 1, name: 'Any Large Pizza', brand_id: 25, voucher_type: 'fixed_price', value: 999, is_active: true }]);
});
afterEach(() => setWidth(1024));

describe('Printed Vouchers report on a phone', () => {
  it('shows the by-voucher figures as cards, with the total, and no table', async () => {
    renderPage();
    const list = await screen.findByTestId('pv-voucher-cards');
    expect(screen.queryByRole('table')).toBeNull();
    const pizza = within(list).getByText('Any Large Pizza').closest('li') as HTMLElement;
    const text = pizza.textContent ?? '';
    expect(text).toContain('Fireaway');
    expect(text).toContain('3 papers');
    expect(text).toContain('2 orders');
    expect(text).toMatch(/1,900/);
    expect(text).toMatch(/2,317/);
    const deleted = within(list).getByText('Old Summer Voucher').closest('li') as HTMLElement;
    expect(deleted.textContent).toContain('Deleted');
    expect(within(list).getByText(/^Total/).closest('li')!.textContent).toMatch(/4 papers · 3 orders/);
  });

  it('shows the day-and-branch counts and the redemptions as cards', async () => {
    renderPage();
    const days = await screen.findByTestId('pv-day-cards');
    expect(days.textContent).toContain('Pine Avenue');
    expect(days.textContent).toContain('Johar Town');
    expect(days.textContent).toContain('3 papers');
    const orders = screen.getByTestId('pv-order-cards');
    const link = within(orders).getByRole('link', { name: '#004' });
    expect(link).toHaveAttribute('href', '/admin/orders/900');
    const text = orders.textContent ?? '';
    for (const expected of ['FDS-AAA', 'Pine Avenue', 'Fireaway', 'Any Large Pizza', '1 paper', 'Ali', '03001234567', 'Cashier One', 'Subtotal', 'Charged']) {
      expect(text).toContain(expected);
    }
    expect(text).toMatch(/1,949/);
    expect(text).toMatch(/−.*950/);
  });
});
