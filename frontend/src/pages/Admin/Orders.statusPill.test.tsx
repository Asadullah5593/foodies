import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
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

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: vi.fn().mockImplementation((url: string) => {
      if (String(url).includes('/admin/orders')) {
        return Promise.resolve({ data: { data: [order], total: 1 } });
      }
      return Promise.resolve({ data: [] });
    }),
    put: vi.fn(),
  },
}));
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
