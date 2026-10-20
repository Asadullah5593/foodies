import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThemeProvider } from '../../../contexts/ThemeContext';
import RiderSupervisor from './RiderSupervisor';

/** On a phone both supervisor tables become card lists carrying every column. */

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
  adminService: { updateOrderStatus: (id: number, status: string) => updateOrderStatus(id, status) },
}));
let granted: string[] = [];
vi.mock('../../../hooks/useHasPermission', () => ({
  useHasPermission: (p: string) => granted.includes(p),
}));

const FILTER_OPTIONS = {
  brands: [{ id: 25, name: 'Fireaway' }, { id: 26, name: 'Wok & Go' }],
  branches: [{ id: 10, name: 'Emporium' }],
  riders: [{ id: 41, name: 'fireaway rider 1' }, { id: 42, name: 'loranzo rider 2' }],
  history_days: null as number | null,
};
const ORDERS_RESPONSE = {
  data: [
    {
      id: 1, order_id: 'FDS-TEST01', order_number: '007', status: 'preparing', delivery_status: 'accepted',
      picked_up_at: '2026-07-20T10:20:00.000Z', delivered_at: '2026-07-20T10:50:00.000Z', trip_duration_seconds: 1800,
      placed_at: '2026-07-20T10:00:00.000Z', completed_at: null, cancelled_at: null, total_amount: 1450, delivery_fee: 120,
      delivery_tier: 'standard', delivery_address: '12 Test St', customer_name: 'Jane Doe', customer_phone: '03001234567',
      brand_id: 25, brand_name: 'Fireaway', branch_id: 10, branch_name: 'Emporium', rider_id: 41, rider_name: 'fireaway rider 1',
    },
  ],
  total: 1, page: 1, page_size: 25, status: 'all', counts: { active: 1, delivered: 0, cancelled: 0, all: 1 },
};
const RIDERS_RESPONSE = [
  {
    rider_user_id: 41, name: 'fireaway rider 1', phone: '03009998877', email: 'butt@example.com', base_salary: 10000,
    salary_type: 'hybrid', employment_status: 'active', status: 'on_break', is_checked_in: true, is_paused: true,
    pause_reason: 'Prayer', branch_id: 10, branch_name: 'Emporium', brands: ['Fireaway'],
    last_heartbeat_at: '2026-07-24T09:00:00.000Z', last_check_in_at: '2026-07-24T08:00:00.000Z', last_check_out_at: null,
    attendance_status: 'checked_in',
  },
];

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <ThemeProvider>
          <RiderSupervisor />
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  setWidth(390);
  granted = ['rider-supervisor:view', 'rider-supervisor:view-status', 'orders:update-status'];
  getDeliveryOrders.mockResolvedValue(ORDERS_RESPONSE);
  getRiders.mockResolvedValue(RIDERS_RESPONSE);
  getFilterOptions.mockResolvedValue(FILTER_OPTIONS);
  updateOrderStatus.mockResolvedValue({});
});
afterEach(() => setWidth(1024));

describe('Rider supervisor on a phone', () => {
  it('lists delivery orders as cards with every column, and the status can still be changed', async () => {
    renderPage();
    const list = await screen.findByTestId('supervisor-order-cards');
    expect(screen.queryByRole('table')).toBeNull();
    const card = within(list).getByText('FDS-TEST01').closest('li') as HTMLElement;
    const text = card.textContent ?? '';
    for (const expected of ['#007', 'fireaway rider 1', 'Fireaway · Emporium', 'Jane Doe', '03001234567', 'accepted', 'Picked up', 'Delivered', 'Trip time', '30 min']) {
      expect(text).toContain(expected);
    }
    expect(text).toMatch(/1,450/);
    // A searchable dropdown below lg: open it from the card, pick the option from the portalled list.
    fireEvent.click(within(card).getByRole('button', { name: /^Update status for order FDS-TEST01/ }));
    fireEvent.mouseDown(screen.getByRole('option', { name: 'Ready' }));
    await waitFor(() => expect(updateOrderStatus).toHaveBeenCalledWith(1, 'ready'));
  });

  it('shows the status as a pill when the account may not change it', async () => {
    granted = ['rider-supervisor:view', 'rider-supervisor:view-status'];
    renderPage();
    const list = await screen.findByTestId('supervisor-order-cards');
    expect(within(list).queryByRole('combobox')).toBeNull();
    expect(within(list).getByText('preparing')).toBeInTheDocument();
  });

  it('lists riders as cards with status, pause reason, brand, branch, salary and check-ins', async () => {
    renderPage();
    await screen.findByTestId('supervisor-order-cards');
    fireEvent.click(screen.getByRole('button', { name: /^Riders/ }));
    const list = await screen.findByTestId('supervisor-rider-cards');
    expect(screen.queryByRole('table')).toBeNull();
    const text = list.textContent ?? '';
    for (const expected of ['fireaway rider 1', '03009998877', 'butt@example.com', 'On break', 'Prayer', 'Fireaway', 'Emporium', 'Base salary', 'Last check-in', 'Last check-out']) {
      expect(text).toContain(expected);
    }
    expect(text).toMatch(/10,000/);
  });
});
