import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import PrintedVoucherReport from './PrintedVoucherReport';
import { PrintedVoucherReport as ReportData } from '../../types';

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
          ? [
              { id: 10, name: 'Pine Avenue' },
              { id: 17, name: 'Johar Town' },
            ]
          : [
              { id: 23, name: 'Peperi Co' },
              { id: 25, name: 'Fireaway' },
            ],
      }),
  },
}));

const REPORT: ReportData = {
  date_from: '2026-10-05T00:00:00.000Z',
  date_to: '2026-10-05T23:59:59.999Z',
  // Four papers on three orders: two pizza vouchers sat on one order.
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

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <PrintedVoucherReport />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Printed Vouchers report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getPrintedVoucherReport.mockResolvedValue(REPORT);
    getPrintedVouchers.mockResolvedValue([
      { id: 1, name: 'Any Large Pizza', brand_id: 25, voucher_type: 'fixed_price', value: 999, is_active: true },
    ]);
  });

  it('opens on today and shows what was redeemed', async () => {
    renderPage();
    expect(await screen.findByText('Vouchers collected')).toBeInTheDocument();
    const today = new Date().toISOString().split('T')[0];
    expect(getPrintedVoucherReport).toHaveBeenCalledWith(
      expect.objectContaining({ date_from: today, date_to: today, branch_id: null, brand_id: null, voucher_id: null }),
    );
    // Summary tiles.
    // "Discount given" is also a table heading; the tile's label is the div.
    const tile = (label: string) => screen.getByText(label, { selector: 'div' }).parentElement as HTMLElement;
    expect(within(tile('Vouchers collected')).getByText('4')).toBeInTheDocument();
    expect(within(tile('Vouchers collected')).getByText('Paper vouchers, on 3 orders')).toBeInTheDocument();
    expect(within(tile('Discount given')).getByText('Rs. 2,450.00')).toBeInTheDocument();
    expect(within(tile('Average per voucher')).getByText('Rs. 612.50')).toBeInTheDocument();
    expect(within(tile('Charged on these orders')).getByText('Rs. 3,244.52')).toBeInTheDocument();
  });

  it('counts by voucher, keeping a deleted voucher under the name it had', async () => {
    renderPage();
    const byVoucher = (await screen.findByRole('heading', { name: 'By voucher' })).closest('section') as HTMLElement;
    const pizza = within(byVoucher).getByText('Any Large Pizza').closest('tr') as HTMLElement;
    expect(within(pizza).getByText('Rs 999')).toBeInTheDocument();
    expect(within(pizza).getByText('2')).toBeInTheDocument();
    expect(within(pizza).getByText('Rs. 1,900.00')).toBeInTheDocument();

    const old = within(byVoucher).getByText('Old Summer Voucher').closest('tr') as HTMLElement;
    expect(within(old).getByText('Deleted')).toBeInTheDocument();
    // The footer adds up to the tiles.
    const total = within(byVoucher).getByText('Total').closest('tr') as HTMLElement;
    expect(within(total).getByText('3')).toBeInTheDocument();
    expect(within(total).getByText('Rs. 2,450.00')).toBeInTheDocument();
  });

  it('breaks the count down by day and branch, for matching the paper vouchers', async () => {
    renderPage();
    const byDay = (await screen.findByRole('heading', { name: /By day and branch/ })).closest('section') as HTMLElement;
    const row = within(byDay).getByText('Pine Avenue').closest('tr') as HTMLElement;
    expect(within(row).getByText('5 Oct 2026')).toBeInTheDocument();
    expect(within(row).getByText('Any Large Pizza')).toBeInTheDocument();
    expect(within(row).getByText('2')).toBeInTheDocument();
  });

  it('lists each redemption with the order, the customer and who applied it', async () => {
    renderPage();
    const list = (await screen.findByRole('heading', { name: /Redemptions/ })).closest('section') as HTMLElement;
    const link = within(list).getByRole('link', { name: '#004' });
    expect(link.getAttribute('href')).toBe('/admin/orders/900');
    const row = link.closest('tr') as HTMLElement;
    expect(within(row).getByText('Ali')).toBeInTheDocument();
    expect(within(row).getByText('Cashier One')).toBeInTheDocument();
    expect(within(row).getByText('−Rs. 950.00')).toBeInTheDocument();
    expect(within(row).getByText('Dine in')).toBeInTheDocument();
  });

  it('refetches for a new date range', async () => {
    renderPage();
    await screen.findByText('Vouchers collected');
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-10-01' } });
    await waitFor(() =>
      expect(getPrintedVoucherReport).toHaveBeenLastCalledWith(expect.objectContaining({ date_from: '2026-10-01' })),
    );
  });

  it('says so when nothing was redeemed, and has nothing to export', async () => {
    getPrintedVoucherReport.mockResolvedValue({
      ...REPORT,
      totals: { redemptions: 0, papers: 0, discount: 0, subtotal: 0, total: 0, average_discount: 0 },
      by_voucher: [],
      by_day: [],
      rows: [],
    });
    renderPage();
    expect(await screen.findByText('No vouchers were redeemed in this range')).toBeInTheDocument();
    expect((screen.getByRole('button', { name: 'Export CSV' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Print' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('exports the redemptions as CSV', async () => {
    let csv = '';
    vi.stubGlobal(
      'Blob',
      class {
        constructor(parts: string[]) {
          csv = parts.join('');
        }
      },
    );
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:x', revokeObjectURL: vi.fn() });
    const realCreate = document.createElement.bind(document);
    const anchors: HTMLAnchorElement[] = [];
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = vi.fn();
        anchors.push(el as HTMLAnchorElement);
      }
      return el;
    });

    renderPage();
    await screen.findByRole('link', { name: '#004' });
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    const [header, first] = csv.split('\n');
    expect(header).toBe(
      'Placed at,Order ID,Order number,Branch,Brand,Voucher,Order type,Customer,Phone,Subtotal,Papers,Voucher discount,Total charged,Applied by,Status',
    );
    expect(first).toContain('FDS-AAA,004,Pine Avenue,Fireaway,Any Large Pizza,Dine in,Ali,03001234567,1949,1,950,1158.84,Cashier One,completed');
    // The page also renders ordinary links; the download is the anchor that names a file.
    const download = anchors.find((a) => a.download);
    expect(download?.download).toMatch(/^printed-vouchers_\d{4}-\d{2}-\d{2}_to_\d{4}-\d{2}-\d{2}\.csv$/);
    expect(download?.click).toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
