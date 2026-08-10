import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
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

describe('Orders — kitchen status pill', () => {
  beforeEach(() => {
    permissions = [];
    discounted = true;
  });

  it('is inert text for a tablet that may only view orders', async () => {
    permissions = ['orders:create', 'orders:view'];
    renderPage();
    // Both layouts are in the DOM (one hidden), so every match is doubled.
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    // The status is still readable — the client asked for that explicitly.
    expect(screen.getAllByLabelText(/Kitchen status for order #003: Accepted/i).length).toBeGreaterThan(0);
    // ...but there is nothing to click.
    expect(screen.queryAllByRole('button', { name: /Kitchen status for order #003$/i })).toHaveLength(0);
  });

  it('is a menu button once the user may change status', async () => {
    permissions = ['orders:view', 'orders:update-status'];
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    expect(
      screen.getAllByRole('button', { name: /Kitchen status for order #003/i }).length,
    ).toBeGreaterThan(0);
    // And no inert read-only pill in its place.
    expect(screen.queryAllByLabelText(/Kitchen status for order #003: Accepted/i)).toHaveLength(0);
  });
});

describe('Orders — discount column', () => {
  beforeEach(() => {
    permissions = ['orders:view'];
  });

  it('shows the total given away and which kinds produced it', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    // Both layouts render, so every match is doubled.
    expect(screen.getAllByText('−Rs. 340.00').length).toBeGreaterThan(0);
    // A bank-card offer plus a till give-away: the column names both, because
    // "who paid for this discount" is the question the number alone can't answer.
    expect(screen.getAllByText('Card, Staff').length).toBeGreaterThan(0);
  });

  it('reads a dash when nothing was discounted', async () => {
    discounted = false;
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    expect(screen.queryByText(/^−Rs\./)).not.toBeInTheDocument();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });
});

describe('Orders — discount filter', () => {
  beforeEach(() => {
    permissions = ['orders:view', 'orders:filter:discount'];
    discounted = true;
    // Requested URLs accumulate across tests otherwise, and the previous
    // test's `discount=coupon` would satisfy the "asks for nothing" case.
    apiGet.mockClear();
  });

  it('sends the chosen discount filter to the server', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));

    fireEvent.change(screen.getByLabelText('Discount'), { target: { value: 'coupon' } });
    await waitFor(() => expect(ordersUrls().some((u) => u.includes('discount=coupon'))).toBe(true));
  });

  it('asks for nothing when the filter is left on All', async () => {
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    // An empty value must not become `discount=` — the server whitelists, but a
    // stray param would still churn the query key on every render.
    expect(ordersUrls().every((u) => !u.includes('discount='))).toBe(true);
  });

  it('is hidden from a role that may not filter by discount', async () => {
    permissions = ['orders:view'];
    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    expect(screen.queryByLabelText('Discount')).not.toBeInTheDocument();
  });
});

describe('Orders — layout measurement survives the loading gate', () => {
  beforeEach(() => {
    permissions = ['orders:view'];
  });

  it('measures the table once it mounts after the loader', async () => {
    // jsdom reports 0-width elements, so the assertion is that the container is
    // reached and measured at all — the old effect-on-useRef never got here,
    // which left `layout` null forever and forced cards on every screen.
    const observed: Element[] = [];
    const original = global.ResizeObserver;
    global.ResizeObserver = class {
      constructor(private cb: ResizeObserverCallback) {}
      observe(el: Element) {
        observed.push(el);
      }
      unobserve() {}
      disconnect() {}
    } as unknown as typeof ResizeObserver;

    renderPage();
    await waitFor(() => expect(screen.getAllByText('Accepted').length).toBeGreaterThan(0));
    expect(observed.length).toBeGreaterThan(0);

    global.ResizeObserver = original;
  });
});
