import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Customers page's "Orders" button opens this page on one customer:
 * /admin/orders?customer_id=…&customer_label=…. That view is the whole order
 * history, so it must not inherit the list's usual "today only" default — and
 * it must be obvious whose orders are on screen and how to leave.
 */

let permissions: string[] = [];
let canOpenCustomers = false;
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
vi.mock('../../lib/pathPermissions', () => ({
  PATH_PERMISSIONS: {},
  canAccessPath: (_u: unknown, path: string) => path === '/admin/customers' && canOpenCustomers,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/AssignRiderModal', () => ({ default: () => null }));
vi.mock('../../components/CustomerInvoiceModal', () => ({ default: () => null }));

/** Every /admin/orders list request, as its query string. */
let listRequests: URLSearchParams[] = [];

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (url: string) => {
      const u = String(url);
      if (u.startsWith('/admin/orders?')) {
        listRequests.push(new URLSearchParams(u.split('?')[1]));
        return Promise.resolve({ data: { data: [], total: 0, status_counts: {} } });
      }
      return Promise.resolve({ data: [] });
    },
    put: vi.fn(),
  },
}));
vi.mock('../../services/api/adminService', () => ({
  adminService: { getOnDutyRiders: vi.fn().mockResolvedValue([]) },
}));

import Orders from './Orders';

const renderAt = (url: string) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Orders />
      </MemoryRouter>
    </QueryClientProvider>,
  );

const lastRequest = async (): Promise<URLSearchParams> => {
  await waitFor(() => expect(listRequests.length).toBeGreaterThan(0));
  return listRequests[listRequests.length - 1];
};

const HISTORY_URL = '/admin/orders?customer_id=412&customer_label=Abdullah+Arshad+%2803240201350%29';

describe("Orders — one customer's history", () => {
  beforeEach(() => {
    permissions = ['orders:view'];
    canOpenCustomers = false;
    listRequests = [];
  });

  it('asks the server for that customer only, across all dates', async () => {
    renderAt(HISTORY_URL);
    const req = await lastRequest();
    expect(req.get('customer_id')).toBe('412');
    expect(req.has('date_from')).toBe(false);
    expect(req.has('date_to')).toBe(false);
  });

  it('names whose history it is, and says the range is all time', async () => {
    renderAt(HISTORY_URL);
    const banner = await screen.findByTestId('customer-history-banner');
    expect(banner.textContent).toContain('Order history');
    expect(banner.textContent).toContain('Abdullah Arshad (03240201350)');
    expect(screen.getByText(/all time/)).toBeTruthy();
  });

  it('still names the customer when the link carried no label', async () => {
    renderAt('/admin/orders?customer_id=412');
    expect((await screen.findByTestId('customer-history-banner')).textContent).toContain('Customer #412');
  });

  it('lets the dates narrow the history', async () => {
    renderAt(`${HISTORY_URL}&date_from=2026-09-01&date_to=2026-09-30`);
    const req = await lastRequest();
    expect(req.get('customer_id')).toBe('412');
    expect(req.get('date_from')).toBe('2026-09-01');
    expect(req.get('date_to')).toBe('2026-09-30');
  });

  it('keeps the customer when the filters are cleared', async () => {
    renderAt(`${HISTORY_URL}&status=completed&date_from=2026-09-01&date_to=2026-09-30`);
    fireEvent.click(await screen.findByText('Clear'));
    await waitFor(() => {
      const req = listRequests[listRequests.length - 1];
      expect(req.has('status')).toBe(false);
      expect(req.has('date_from')).toBe(false);
    });
    expect(listRequests[listRequests.length - 1].get('customer_id')).toBe('412');
    expect(screen.getByTestId('customer-history-banner').textContent).toContain('Abdullah Arshad');
  });

  it('"Show all orders" leaves the history for the normal list of today', async () => {
    renderAt(HISTORY_URL);
    fireEvent.click(await screen.findByText('Show all orders'));
    await waitFor(() => expect(screen.queryByTestId('customer-history-banner')).toBeNull());
    await waitFor(() => {
      const req = listRequests[listRequests.length - 1];
      expect(req.has('customer_id')).toBe(false);
      expect(req.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(req.get('date_from')).toBe(req.get('date_to'));
    });
  });

  it('offers the way back to Customers only to someone who can open it', async () => {
    renderAt(HISTORY_URL);
    await screen.findByTestId('customer-history-banner');
    expect(screen.queryByText('Back to customers')).toBeNull();
  });

  it('links back to Customers for someone who can', async () => {
    canOpenCustomers = true;
    renderAt(HISTORY_URL);
    expect((await screen.findByText('Back to customers')).getAttribute('href')).toBe('/admin/customers');
  });
});

describe('Orders — the normal list is unchanged', () => {
  beforeEach(() => {
    permissions = ['orders:view'];
    canOpenCustomers = false;
    listRequests = [];
  });

  it('still opens on today, with no customer filter and no banner', async () => {
    renderAt('/admin/orders');
    const req = await lastRequest();
    expect(req.has('customer_id')).toBe(false);
    expect(req.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(req.get('date_from')).toBe(req.get('date_to'));
    // Wait for the page proper (past its first-load spinner) before looking.
    await screen.findByText('Clear');
    expect(screen.queryByTestId('customer-history-banner')).toBeNull();
  });

  it('ignores a customer_id that is not a positive whole number', async () => {
    for (const bad of ['abc', '0', '-4', '1.5', '12 OR 1=1']) {
      listRequests = [];
      const { unmount } = renderAt(`/admin/orders?customer_id=${encodeURIComponent(bad)}`);
      const req = await lastRequest();
      expect(req.has('customer_id')).toBe(false);
      // Not a history view, so the "today" default is back.
      expect(req.get('date_from')).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      await screen.findByText('Clear');
      expect(screen.queryByTestId('customer-history-banner')).toBeNull();
      unmount();
    }
  });
});
