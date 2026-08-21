import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Two regressions this file pins:
 *
 * 1. The kitchen-status pill was always a menu button, so an order-taking
 *    tablet holding only orders:view was offered a control the server refuses
 *    (403 on PUT /admin/orders/:id/status). Without orders:update-status it
 *    must be inert text.
 *
 * 2. The layout is chosen from the table container's measured width. The page
 *    renders a full-screen loader during the first fetch, so the table does not
 *    exist on the first render — the measurement has to survive that and run
 *    when the table actually mounts, or every user is stuck on the fallback
 *    card layout. A callback ref does; a useLayoutEffect on a useRef did not.
 */

let permissions: string[] = [];
vi.mock('../../hooks/useHasPermission', () => ({
  useHasPermission: (need: string | string[]) => {
    const list = Array.isArray(need) ? need : [need];
    return list.some((p) => permissions.includes(p));
  },
  // A restriction applies only when literally assigned — no super-admin bypass.
  useHasRestriction: (need: string) => permissions.includes(need),
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, allowed_brand_ids: null, permissions } }),
}));
vi.mock('../../lib/pathPermissions', () => ({
  PATH_PERMISSIONS: {},
  canAccessPath: () => false,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/AssignRiderModal', () => ({ default: () => null }));
vi.mock('../../components/CustomerInvoiceModal', () => ({ default: () => null }));

/** Flipped by the discount-column tests; the fetch mock reads it per call. */
let discounted = true;

const order = {
  id: 1,
  order_number: '003',
  order_type: 'dine_in',
  status: 'accepted',
  source: 'pos',
  items_count: 1,
  total_amount: 2339,
  placed_at: new Date('2026-07-30T11:02:00Z').toISOString(),
  customer_name: 'Ali Raza',
  brand_name: 'Fireaway',
  payments: [{ payment_method: 'card', amount: 2339 }],
};

/** Captured so the filter tests can assert on the URLs the page requested. */
const apiGet = vi.fn().mockImplementation((url: string) => {
  if (String(url).includes('/admin/orders')) {
    // /admin/orders serves raw entities, so the split arrives camelCase.
    const split = discounted
      ? {
          discountAmount: '340.00',
          cardDiscountAmount: '250.00',
          staffDiscountAmount: '90.00',
          promoDiscountAmount: '0.00',
          orderDiscountAmount: '0.00',
          couponDiscountAmount: '0.00',
        }
      : {};
    return Promise.resolve({ data: { data: [{ ...order, ...split }], total: 1 } });
  }
  return Promise.resolve({ data: [] });
});

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (...args: unknown[]) => apiGet(...args),
    put: vi.fn(),
  },
}));

/** Every /admin/orders URL requested so far. */
const ordersUrls = (): string[] =>
  apiGet.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/admin/orders'));
vi.mock('../../services/api/adminService', () => ({
  adminService: { getBranches: vi.fn().mockResolvedValue([]), getBrands: vi.fn().mockResolvedValue([]) },
}));

import Orders from './Orders';

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <Orders />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

describe('Orders — orders:update-status:no-cancel', () => {
  beforeEach(() => { permissions = []; discounted = true; });

  const openStatusMenu = async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    const pill = screen.getAllByRole('button', { name: /Kitchen status for order #003/i })[0];
    fireEvent.click(pill);
    await waitFor(() => expect(screen.getByText('Kitchen status')).toBeInTheDocument());
  };

  it('grants the status flow on its own — the pill is still a button', async () => {
    permissions = ['orders:view', 'orders:update-status:no-cancel'];
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    expect(
      screen.getAllByRole('button', { name: /Kitchen status for order #003/i }).length,
    ).toBeGreaterThan(0);
  });

  it('offers every status EXCEPT Cancelled', async () => {
    permissions = ['orders:view', 'orders:update-status:no-cancel'];
    await openStatusMenu();
    const menu = screen.getByText('Kitchen status').parentElement as HTMLElement;
    for (const label of ['Placed', 'Accepted', 'Preparing', 'Ready', 'Completed']) {
      expect(within(menu).getByRole('menuitem', { name: new RegExp(label) })).toBeInTheDocument();
    }
    expect(within(menu).queryByRole('menuitem', { name: /Cancelled/ })).toBeNull();
  });

  it('still offers Cancelled to an ordinary status-updater', async () => {
    permissions = ['orders:view', 'orders:update-status'];
    await openStatusMenu();
    const menu = screen.getByText('Kitchen status').parentElement as HTMLElement;
    expect(within(menu).getByRole('menuitem', { name: /Cancelled/ })).toBeInTheDocument();
  });

  it('the restriction wins when BOTH permissions are held', async () => {
    permissions = ['orders:view', 'orders:update-status', 'orders:update-status:no-cancel'];
    await openStatusMenu();
    const menu = screen.getByText('Kitchen status').parentElement as HTMLElement;
    expect(within(menu).queryByRole('menuitem', { name: /Cancelled/ })).toBeNull();
    expect(within(menu).getByRole('menuitem', { name: /Ready/ })).toBeInTheDocument();
  });
});

describe('Orders — orders:view:no-totals', () => {
  beforeEach(() => { permissions = []; discounted = true; });

  it('hides the footer Page value', async () => {
    permissions = ['orders:view', 'orders:view:no-totals'];
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    expect(screen.queryByText('Page value')).toBeNull();
    // The counts stay — only the money goes.
    expect(screen.getByText(/on this page/)).toBeInTheDocument();
  });

  it('shows it to everyone else', async () => {
    permissions = ['orders:view'];
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    expect(screen.getByText('Page value')).toBeInTheDocument();
  });
});
