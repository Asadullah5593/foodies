import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * The full Orders list reads a customer the way one customer's history does: the saved
 * customer's own name leads, and an order typed under another name says "ordered as …".
 * And every order shows the day it was placed beside the time — in the list and in a history.
 */

let permissions: string[] = [];
vi.mock('../../hooks/useHasPermission', () => ({
  useHasPermission: (need: string | string[]) => {
    const list = Array.isArray(need) ? need : [need];
    return list.some((p) => permissions.includes(p));
  },
  useHasRestriction: (need: string) => permissions.includes(need),
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, allowed_brand_ids: null, permissions } }),
}));
vi.mock('../../lib/pathPermissions', () => ({ PATH_PERMISSIONS: {}, canAccessPath: () => false }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/AssignRiderModal', () => ({ default: () => null }));
vi.mock('../../components/CustomerInvoiceModal', () => ({ default: () => null }));

const thisYear = new Date().getFullYear();
const order = (over: Record<string, unknown>) => ({
  orderType: 'dine_in',
  status: 'completed',
  source: 'pos',
  totalAmount: 1861.38,
  brand: { id: 22, name: 'Peperi Co' },
  branch: { id: 11, name: 'Pine Avenue', code: 'PA' },
  payments: [{ paymentMethod: 'card', status: 'completed', amount: 1861.38 }],
  ...over,
});
let rows: Array<Record<string, unknown>> = [];

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (url: string) =>
      Promise.resolve(
        String(url).includes('/admin/orders')
          ? { data: { data: rows, total: rows.length, status_counts: {} } }
          : { data: [] },
      ),
    put: vi.fn(),
  },
}));
vi.mock('../../services/api/adminService', () => ({
  adminService: { getOnDutyRiders: vi.fn().mockResolvedValue([]) },
}));

import Orders from './Orders';

const renderAt = (url = '/admin/orders') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Orders />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

beforeEach(() => {
  permissions = ['orders:view'];
  setWidth(1024);
});
afterEach(() => setWidth(1024));

describe('Orders — the saved customer and the name typed on the order', () => {
  it('leads with the saved name and says what the order was typed as', async () => {
    rows = [order({ id: 1, orderNumber: '148', customerId: 155, customerName: 'Majid ali', customerPhone: '03092541679', customer_record_name: 'Jahanzeb' })];
    renderAt();
    const links = await screen.findAllByRole('link', { name: 'Jahanzeb' });
    // The link opens the history under the saved name.
    expect(links[0].getAttribute('href')).toContain('customer_id=155');
    expect(links[0].getAttribute('href')).toContain('customer_label=Jahanzeb');
    const hints = screen.getAllByTestId('ordered-as');
    expect(hints[0]).toHaveTextContent('ordered as Majid ali');
    expect(hints[0]).toHaveAttribute('title', 'Placed with this customer\'s phone under the name "Majid ali"');
  });

  it('adds nothing when the typed name is the saved one', async () => {
    rows = [order({ id: 2, orderNumber: '017', customerId: 155, customerName: 'jahanzeb', customer_record_name: 'Jahanzeb' })];
    renderAt();
    await screen.findAllByRole('link', { name: 'Jahanzeb' });
    expect(screen.queryByTestId('ordered-as')).toBeNull();
  });

  it('falls back to the typed name when the saved customer has none', async () => {
    rows = [order({ id: 3, orderNumber: '005', customerId: 9, customerName: 'Sana Iqbal', customer_record_name: null })];
    renderAt();
    expect(await screen.findAllByRole('link', { name: 'Sana Iqbal' })).not.toHaveLength(0);
    expect(screen.queryByTestId('ordered-as')).toBeNull();
  });
});

describe('Orders — the day an order was placed', () => {
  it('shows the day with the time, and the year only when it is not this one', async () => {
    rows = [
      order({ id: 4, orderNumber: '004', customerName: 'Walk-in A', placedAt: new Date(thisYear, 9, 20, 21, 8).toISOString() }),
      order({ id: 5, orderNumber: '003', customerName: 'Walk-in B', placedAt: new Date(thisYear - 1, 8, 3, 13, 28).toISOString() }),
    ];
    renderAt('/admin/orders?date_from=2020-01-01&date_to=2030-12-31');
    // Grid: the day on its own line above the time; cards: "day, time" on one line.
    expect((await screen.findAllByText('20 Oct')).length).toBeGreaterThan(0);
    expect(screen.getAllByText(`3 Sep ${thisYear - 1}`).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/^20 Oct, 9:08\s?PM$/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(new RegExp(`^3 Sep ${thisYear - 1}, 1:28\\s?PM$`, 'i')).length).toBeGreaterThan(0);
  });

  it('counts a day or more in whole days, and anything newer in hours and minutes', async () => {
    const ago = (min: number) => new Date(Date.now() - min * 60000).toISOString();
    rows = [
      order({ id: 7, orderNumber: '010', customerName: 'Old', placedAt: ago(3 * 24 * 60 + 125) }),
      order({ id: 8, orderNumber: '011', customerName: 'Recent', placedAt: ago(125) }),
    ];
    renderAt('/admin/orders?date_from=2020-01-01&date_to=2030-12-31');
    expect((await screen.findAllByText('3d ago')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('2h 5m ago').length).toBeGreaterThan(0);
  });

  it('carries into one customer’s history and onto phone cards', async () => {
    setWidth(390);
    rows = [order({ id: 6, orderNumber: '001', customerId: 155, customerName: 'Jahanzeb', placedAt: new Date(thisYear, 9, 20, 21, 8).toISOString() })];
    renderAt('/admin/orders?customer_id=155&customer_label=Jahanzeb+%2803092541679%29');
    const card = await screen.findByTestId('order-phone-card');
    expect(within(card).getByText(/20 Oct, 9:08\s?PM/i)).toBeInTheDocument();
  });
});
