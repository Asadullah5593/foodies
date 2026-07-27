import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import RiderSupervisor from './RiderSupervisor';

const getDeliveryOrders = vi.fn();
const getRiders = vi.fn();
const getFilterOptions = vi.fn();
vi.mock('../../../services/api/riderSupervisorService', () => ({
  riderSupervisorService: {
    getDeliveryOrders: (p: unknown) => getDeliveryOrders(p),
    getRiders: (p: unknown) => getRiders(p),
    getFilterOptions: () => getFilterOptions(),
  },
}));

const updateOrderStatus = vi.fn();
vi.mock('../../../services/api/adminService', () => ({
  adminService: {
    updateOrderStatus: (id: number, status: string) => updateOrderStatus(id, status),
  },
}));

/** Permissions the signed-in user holds; per-test overridable. */
let granted: string[] = [];
vi.mock('../../../hooks/useHasPermission', () => ({
  useHasPermission: (p: string) => granted.includes(p),
}));

// Two brands (so a brand filter shows) but one branch (branch filter hidden).
// Two riders ⇒ the rider filter shows. history_days null ⇒ unrestricted role.
const FILTER_OPTIONS = {
  brands: [
    { id: 25, name: 'Fireaway' },
    { id: 26, name: 'Wok & Go' },
  ],
  branches: [{ id: 10, name: 'Emporium' }],
  riders: [
    { id: 41, name: 'fireaway rider 1' },
    { id: 42, name: 'loranzo rider 2' },
  ],
  history_days: null as number | null,
};

const ORDERS_RESPONSE = {
  data: [
    {
      id: 1,
      order_id: 'FDS-TEST01',
      order_number: '007',
      status: 'preparing',
      delivery_status: 'accepted',
      placed_at: '2026-07-20T10:00:00.000Z',
      completed_at: null,
      cancelled_at: null,
      total_amount: 1450,
      delivery_fee: 120,
      delivery_tier: 'standard',
      delivery_address: '12 Test St',
      customer_name: 'Jane Doe',
      customer_phone: '03001234567',
      brand_id: 25,
      brand_name: 'Fireaway',
      branch_id: 10,
      branch_name: 'Emporium',
      rider_id: 41,
      rider_name: 'fireaway rider 1',
    },
  ],
  total: 1,
  page: 1,
  page_size: 25,
  status: 'all',
  counts: { active: 1, delivered: 0, cancelled: 0, all: 1 },
};

const RIDERS_RESPONSE = [
  {
    rider_user_id: 41,
    name: 'fireaway rider 1',
    phone: '03009998877',
    email: 'butt@example.com',
    base_salary: 10000,
    salary_type: 'hybrid',
    employment_status: 'active',
    status: 'active',
    is_checked_in: true,
    is_paused: false,
    pause_reason: null,
    branch_id: 10,
    branch_name: 'Emporium',
    brands: ['Fireaway'],
    last_heartbeat_at: '2026-07-24T09:00:00.000Z',
    last_check_in_at: '2026-07-24T08:00:00.000Z',
    last_check_out_at: null,
    attendance_status: 'checked_in',
  },
];

const renderPage = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ThemeProvider>
          <RiderSupervisor />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('RiderSupervisor page', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: a supervisor who may see status but not change it.
    granted = ['rider-supervisor:view', 'rider-supervisor:view-status'];
    getDeliveryOrders.mockResolvedValue(ORDERS_RESPONSE);
    getRiders.mockResolvedValue(RIDERS_RESPONSE);
    getFilterOptions.mockResolvedValue(FILTER_OPTIONS);
    updateOrderStatus.mockResolvedValue({});
  });

  it('renders the header and both tabs', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { name: 'Rider Supervisor' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delivery orders' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Riders' })).toBeInTheDocument();
  });

  it('shows delivery orders (last 30 days) with a scoped row', async () => {
    renderPage();
    // status filter pills come from the response counts
    expect(await screen.findByText('FDS-TEST01')).toBeInTheDocument();
    expect(screen.getByText('Jane Doe')).toBeInTheDocument();
    // Specifically the table cell — the name also appears in the rider filter.
    expect(
      screen.getByRole('cell', { name: 'fireaway rider 1' }),
    ).toBeInTheDocument();
    expect(screen.getByText('preparing')).toBeInTheDocument();
    // the query was asked for the 30-day delivery view, status 'all', first page
    expect(getDeliveryOrders).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'all', page: 1, page_size: 25 }),
    );
  });

  it('switches to the Riders tab and shows identity, status and base salary', async () => {
    renderPage();
    await screen.findByText('FDS-TEST01');
    fireEvent.click(screen.getByRole('button', { name: 'Riders' }));
    expect(await screen.findByText('butt@example.com')).toBeInTheDocument();
    expect(screen.getByText('03009998877')).toBeInTheDocument();
    // base salary is rendered read-only, currency-formatted
    expect(screen.getByText(/10,?000\.00/)).toBeInTheDocument();
    // brand column shows the rider's brand(s)
    expect(screen.getByText('Brand')).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: 'Fireaway' })).toBeInTheDocument();
    // active attendance surfaces as a status chip (also a filter pill)
    expect(screen.getAllByText('Active').length).toBeGreaterThan(0);
    expect(getRiders).toHaveBeenCalled();
  });

  it('offers a scoped brand filter (not a branch filter) and refetches on change', async () => {
    renderPage();
    await screen.findByText('FDS-TEST01');
    // two brands ⇒ a brand filter; one branch ⇒ no branch filter ("where applicable")
    const brandSelect = screen.getByLabelText('All brands') as HTMLSelectElement;
    expect(brandSelect).toBeInTheDocument();
    expect(screen.queryByLabelText('All branches')).toBeNull();
    fireEvent.change(brandSelect, { target: { value: '26' } });
    await waitFor(() =>
      expect(getDeliveryOrders).toHaveBeenCalledWith(
        expect.objectContaining({ brand_id: 26, status: 'all', page: 1 }),
      ),
    );
  });
  it('filters delivery orders by rider', async () => {
    renderPage();
    await screen.findByText('FDS-TEST01');
    const riderSelect = screen.getByLabelText('All riders') as HTMLSelectElement;
    fireEvent.change(riderSelect, { target: { value: '42' } });
    await waitFor(() =>
      expect(getDeliveryOrders).toHaveBeenCalledWith(
        expect.objectContaining({ rider_id: 42, status: 'all', page: 1 }),
      ),
    );
  });

  it('filters delivery orders by placement date range', async () => {
    renderPage();
    await screen.findByText('FDS-TEST01');
    fireEvent.change(screen.getByLabelText('Orders placed from'), {
      target: { value: '2026-07-01' },
    });
    fireEvent.change(screen.getByLabelText('Orders placed to'), {
      target: { value: '2026-07-20' },
    });
    await waitFor(() =>
      expect(getDeliveryOrders).toHaveBeenCalledWith(
        expect.objectContaining({ date_from: '2026-07-01', date_to: '2026-07-20' }),
      ),
    );
    // Clearing drops both params (back to the default window).
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    await waitFor(() => {
      const last = getDeliveryOrders.mock.calls.at(-1)?.[0];
      expect(last?.date_from).toBeUndefined();
      expect(last?.date_to).toBeUndefined();
    });
  });

  it('a restricted role cannot pick a date before its history window', async () => {
    getFilterOptions.mockResolvedValue({ ...FILTER_OPTIONS, history_days: 7 });
    renderPage();
    await screen.findByText('FDS-TEST01');
    const from = screen.getByLabelText('Orders placed from') as HTMLInputElement;
    // min = today - 6 days (7 calendar days inclusive of today)
    const expected = new Date();
    expected.setDate(expected.getDate() - 6);
    expect(from.min).toBe(expected.toISOString().slice(0, 10));
    // and the limit is surfaced to the user
    expect(screen.getByText('last 7 days')).toBeInTheDocument();
    expect(screen.getByText('(role limit)')).toBeInTheDocument();
  });

  it('filters the riders roster by rider, with no date filter on that tab', async () => {
    renderPage();
    await screen.findByText('FDS-TEST01');
    fireEvent.click(screen.getByRole('button', { name: 'Riders' }));
    await screen.findByText('butt@example.com');
    expect(screen.queryByLabelText('Orders placed from')).toBeNull();
    fireEvent.change(screen.getByLabelText('All riders'), { target: { value: '41' } });
    await waitFor(() =>
      expect(getRiders).toHaveBeenCalledWith(
        expect.objectContaining({ rider_id: 41 }),
      ),
    );
  });
  it('without rider-supervisor:view-status the Status column and pills are gone', async () => {
    granted = ['rider-supervisor:view'];
    // The server withholds the data too — status null, counts null.
    getDeliveryOrders.mockResolvedValue({
      ...ORDERS_RESPONSE,
      counts: null,
      can_view_status: false,
      data: [{ ...ORDERS_RESPONSE.data[0], status: null }],
    });
    renderPage();
    await screen.findByText('FDS-TEST01');
    expect(screen.queryByRole('columnheader', { name: 'Status' })).toBeNull();
    expect(screen.queryByText('preparing')).toBeNull();
    // status filter pills hidden as well (buckets would leak the same info)
    expect(screen.queryByRole('button', { name: /Delivered/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Cancelled/ })).toBeNull();
    // the rest of the row still renders
    expect(screen.getByRole('cell', { name: 'fireaway rider 1' })).toBeInTheDocument();
  });

  it('with the status permission but not orders:update-status it stays read-only', async () => {
    renderPage();
    await screen.findByText('FDS-TEST01');
    expect(screen.getByRole('columnheader', { name: 'Status' })).toBeInTheDocument();
    expect(screen.getByText('preparing')).toBeInTheDocument();
    expect(screen.queryByLabelText(/Update status for order/)).toBeNull();
  });

  it('orders:update-status turns the Status cell into a working dropdown', async () => {
    granted = [
      'rider-supervisor:view',
      'rider-supervisor:view-status',
      'orders:update-status',
    ];
    renderPage();
    await screen.findByText('FDS-TEST01');
    const select = screen.getByLabelText(
      'Update status for order FDS-TEST01',
    ) as HTMLSelectElement;
    expect(select.value).toBe('preparing');
    // same six options as the admin Order detail page
    expect([...select.options].map((o) => o.value)).toEqual([
      'placed',
      'accepted',
      'preparing',
      'ready',
      'completed',
      'cancelled',
    ]);
    fireEvent.change(select, { target: { value: 'completed' } });
    await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith(1, 'completed'));
  });

  it('cannot update status when the status column is hidden, even with orders:update-status', async () => {
    granted = ['rider-supervisor:view', 'orders:update-status'];
    getDeliveryOrders.mockResolvedValue({
      ...ORDERS_RESPONSE,
      counts: null,
      can_view_status: false,
      data: [{ ...ORDERS_RESPONSE.data[0], status: null }],
    });
    renderPage();
    await screen.findByText('FDS-TEST01');
    expect(screen.queryByLabelText(/Update status for order/)).toBeNull();
    expect(updateOrderStatus).not.toHaveBeenCalled();
  });
});
