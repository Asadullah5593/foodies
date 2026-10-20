import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import RepeatCustomers from './RepeatCustomers';
import { RepeatCustomersReport } from '../../types';
import { defaultRange } from './dashboard/dateRanges';

const getRepeatCustomers = vi.fn();
vi.mock('../../services/api', () => ({
  adminService: {
    getRepeatCustomers: (p: unknown) => getRepeatCustomers(p),
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
let permissions: string[] = ['reports:view', 'orders:view'];
vi.mock('../../hooks/useHasPermission', () => ({
  useHasPermission: (need: string | string[]) => {
    const list = Array.isArray(need) ? need : [need];
    return list.some((p) => permissions.includes(p));
  },
}));
const pageViews = vi.fn();
vi.mock('../../hooks/useSensitivePageView', () => ({
  useSensitivePageView: (subject: string) => pageViews(subject),
}));
const recordBeacon = vi.fn();
vi.mock('../../utils/activityBeacon', () => ({
  recordBeacon: (e: unknown) => recordBeacon(e),
}));

const REPORT: RepeatCustomersReport = {
  date_from: '2026-07-01',
  date_to: '2026-07-31',
  total_customers: 3,
  total_spend: 10650,
  // The server sends most days first.
  rows: [
    { customer_id: 10, name: 'John Doe', phone: '03001234567', days: 6, spend: 5540 },
    { customer_id: 17, name: 'Amir Khan', phone: '03406477263', days: 3, spend: 2650 },
    { customer_id: 63, name: null, phone: '03001112222', days: 2, spend: 2460 },
  ],
};

/** Shows where a customer link landed, so the test can read its query string. */
const OrdersProbe: React.FC = () => {
  const location = useLocation();
  return <div data-testid="orders-page">{location.search}</div>;
};

const renderPage = (entry = '/admin/reports/repeat-customers') => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/admin/reports/repeat-customers" element={<RepeatCustomers />} />
          <Route path="/admin/orders" element={<OrdersProbe />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

const bodyRows = () => within(screen.getAllByRole('rowgroup')[1]).getAllByRole('row');
const firstCells = () => bodyRows().map((r) => within(r).getAllByRole('cell')[0].textContent);

describe('Repeat Customers report', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    permissions = ['reports:view', 'orders:view'];
    getRepeatCustomers.mockResolvedValue(REPORT);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('opens on the last 30 days and lists most days first, with spend', async () => {
    renderPage();
    expect(await screen.findByText('John Doe')).toBeInTheDocument();
    const { from, to } = defaultRange();
    expect(getRepeatCustomers).toHaveBeenCalledWith({ date_from: from, date_to: to, branch_id: null, brand_id: null });
    expect(pageViews).toHaveBeenCalledWith('repeat-customers');

    const tile = (label: string) => screen.getByText(label, { selector: 'div' }).parentElement as HTMLElement;
    expect(within(tile('Repeat customers')).getByText('3')).toBeInTheDocument();
    expect(within(tile('Their spend')).getByText('Rs. 10,650.00')).toBeInTheDocument();

    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Customer',
      'Days ordered ▾',
      'Spend',
    ]);
    const first = within(bodyRows()[0]).getAllByRole('cell');
    expect(first[0]).toHaveTextContent('John Doe03001234567');
    expect(first[1]).toHaveTextContent('6');
    expect(first[2]).toHaveTextContent('Rs. 5,540.00');
  });

  it('shows the phone as the name when the customer has none', async () => {
    renderPage();
    await screen.findByText('John Doe');
    const last = within(bodyRows()[2]).getAllByRole('cell')[0];
    // Once, as the name — not repeated underneath.
    expect(last.textContent).toBe('03001112222');
  });

  it('opens that customer\'s orders for the same range, branch and brand', async () => {
    renderPage(
      '/admin/reports/repeat-customers?date_from=2026-07-01&date_to=2026-07-31&branch_id=10&brand_id=25',
    );
    await screen.findByText('John Doe');
    expect(getRepeatCustomers).toHaveBeenCalledWith({
      date_from: '2026-07-01',
      date_to: '2026-07-31',
      branch_id: 10,
      brand_id: 25,
    });

    fireEvent.click(screen.getByRole('link', { name: 'John Doe' }));
    const sp = new URLSearchParams(screen.getByTestId('orders-page').textContent ?? '');
    expect(sp.get('customer_id')).toBe('10');
    expect(sp.get('customer_label')).toBe('John Doe (03001234567)');
    expect(sp.get('date_from')).toBe('2026-07-01');
    expect(sp.get('date_to')).toBe('2026-07-31');
    expect(sp.get('branch_id')).toBe('10');
    expect(sp.get('brand_id')).toBe('25');
  });

  it('keeps the name as plain text for someone who cannot open Orders', async () => {
    permissions = ['reports:view'];
    renderPage();
    await screen.findByText('John Doe');
    expect(screen.queryByRole('link', { name: 'John Doe' })).toBeNull();
  });

  it('searches by name or by phone, and the tiles follow the search', async () => {
    renderPage();
    await screen.findByText('John Doe');
    const box = screen.getByPlaceholderText('Name or phone');

    fireEvent.change(box, { target: { value: 'amir' } });
    expect(firstCells()).toEqual(['Amir Khan03406477263']);
    const tile = (label: string) => screen.getByText(label, { selector: 'div' }).parentElement as HTMLElement;
    expect(within(tile('Repeat customers')).getByText('1')).toBeInTheDocument();
    expect(within(tile('Their spend')).getByText('Rs. 2,650.00')).toBeInTheDocument();

    // Typed the way people say numbers.
    fireEvent.change(box, { target: { value: '0300 111-2222' } });
    expect(firstCells()).toEqual(['03001112222']);

    fireEvent.change(box, { target: { value: 'nobody' } });
    expect(screen.getByText('No repeat customer matches this search')).toBeInTheDocument();
  });

  it('sorts by spend and by name from the column headers', async () => {
    renderPage();
    await screen.findByText('John Doe');

    fireEvent.click(screen.getByRole('button', { name: 'Spend' }));
    expect(firstCells()).toEqual(['John Doe03001234567', 'Amir Khan03406477263', '03001112222']);
    fireEvent.click(screen.getByRole('button', { name: 'Spend ▾' }));
    expect(firstCells()).toEqual(['03001112222', 'Amir Khan03406477263', 'John Doe03001234567']);

    fireEvent.click(screen.getByRole('button', { name: 'Customer' }));
    expect(firstCells()).toEqual(['03001112222', 'Amir Khan03406477263', 'John Doe03001234567']);
  });

  it('says so when nobody came back on another day', async () => {
    getRepeatCustomers.mockResolvedValue({ ...REPORT, total_customers: 0, total_spend: 0, rows: [] });
    renderPage();
    expect(await screen.findByText('No customer ordered on more than one day in this range')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export CSV' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Print' })).toBeDisabled();
  });

  it('pages through long lists 25 at a time', async () => {
    getRepeatCustomers.mockResolvedValue({
      ...REPORT,
      rows: Array.from({ length: 30 }, (_, i) => ({
        customer_id: i + 1,
        name: `Customer ${String(i + 1).padStart(2, '0')}`,
        phone: `0300000${String(i + 1).padStart(4, '0')}`,
        days: 40 - i,
        spend: 1000,
      })),
    });
    renderPage();
    await screen.findByText('Customer 01');
    expect(bodyRows()).toHaveLength(25);
    expect(screen.getByText('Showing 1–25 of 30')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(bodyRows()).toHaveLength(5);
    expect(screen.getByText('Customer 26')).toBeInTheDocument();
  });

  it('exports the listed customers to CSV and records the export', async () => {
    const created: HTMLAnchorElement[] = [];
    const realCreate = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tag: string) => {
      const el = realCreate(tag);
      if (tag === 'a') {
        (el as HTMLAnchorElement).click = vi.fn();
        created.push(el as HTMLAnchorElement);
      }
      return el;
    });
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

    renderPage('/admin/reports/repeat-customers?date_from=2026-07-01&date_to=2026-07-31');
    await screen.findByText('John Doe');
    fireEvent.click(screen.getByRole('button', { name: 'Export CSV' }));

    expect(csv.split('\n')).toEqual([
      'Customer,Phone,Days ordered,Spend',
      'John Doe,03001234567,6,5540.00',
      'Amir Khan,03406477263,3,2650.00',
      '03001112222,03001112222,2,2460.00',
    ]);
    // The page's own <Link>s are anchors too; the download is the one with a file name.
    const download = created.filter((a) => a.download);
    expect(download).toHaveLength(1);
    expect(download[0].download).toBe('repeat-customers_2026-07-01_to_2026-07-31.csv');
    expect(download[0].click).toHaveBeenCalled();
    expect(recordBeacon).toHaveBeenCalledWith({ action: 'client.export', subject: 'repeat-customers' });
  });

  it('prints every listed customer, not just the page, and records the print', async () => {
    const print = vi.fn();
    vi.stubGlobal('print', print);
    renderPage('/admin/reports/repeat-customers?date_from=2026-07-01&date_to=2026-07-31&brand_id=25');
    await screen.findByText('John Doe');
    // The brand list has loaded, so the paper can name the brand.
    await screen.findByText(/All branches · Fireaway/);
    expect(document.getElementById('rc-print-root')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    await waitFor(() => expect(document.getElementById('rc-print-root')).not.toBeNull());
    const paper = within(document.getElementById('rc-print-root') as HTMLElement);
    expect(paper.getByText(/All branches · Fireaway/)).toBeInTheDocument();
    expect(paper.getAllByRole('row', { hidden: true })).toHaveLength(1 + 3 + 1);
    expect(paper.queryByRole('button', { hidden: true })).toBeNull();
    expect(recordBeacon).toHaveBeenCalledWith({ action: 'client.print', subject: 'repeat-customers' });
    await waitFor(() => expect(print).toHaveBeenCalled());

    fireEvent(window, new Event('afterprint'));
    await waitFor(() => expect(document.getElementById('rc-print-root')).toBeNull());
  });
});
