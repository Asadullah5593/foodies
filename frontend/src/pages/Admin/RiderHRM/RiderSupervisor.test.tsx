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

// Two brands (so a brand filter shows) but one branch (branch filter hidden).
const FILTER_OPTIONS = {
  brands: [
    { id: 25, name: 'Fireaway' },
    { id: 26, name: 'Wok & Go' },
  ],
  branches: [{ id: 10, name: 'Emporium' }],
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
    getDeliveryOrders.mockResolvedValue(ORDERS_RESPONSE);
    getRiders.mockResolvedValue(RIDERS_RESPONSE);
    getFilterOptions.mockResolvedValue(FILTER_OPTIONS);
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
    expect(screen.getByText('fireaway rider 1')).toBeInTheDocument();
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
});
