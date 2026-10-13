import React from 'react';
import { render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Payment column names the tender an order is due to be paid by before any
 * money is recorded: a consumer-app order the rider collects cash for reads
 * "COD · Unpaid" from the moment it arrives, not only once completion records
 * the cash. A tendered order keeps showing what was actually paid, and a till
 * order with nothing recorded still shows nothing.
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

type Row = Record<string, unknown>;

/** /admin/orders serves raw entities: camelCase, with the branch nested. */
const order = (over: Row = {}): Row => ({
  id: 1,
  orderNumber: '003',
  orderType: 'delivery',
  status: 'preparing',
  source: 'consumer_app',
  totalAmount: 1680.84,
  placedAt: new Date().toISOString(),
  customerName: 'Abad ur rehman',
  riderId: 5,
  rider: { id: 5, name: 'Azam Yousaf' },
  deliveryStatus: 'picked_up',
  brand: { id: 23, name: 'Wok & Go' },
  branch: { id: 10, name: 'Pine Avenue', code: 'PA' },
  payments: [],
  pending_payment_method: null,
  ...over,
});

const rows: Row[] = [
  order({ id: 1, orderNumber: '003', pending_payment_method: 'cod' }),
  order({ id: 2, orderNumber: '190', status: 'completed', totalAmount: 1456.92, payments: [{ paymentMethod: 'card', status: 'completed', amount: 1456.92 }] }),
  order({ id: 3, orderNumber: '014', status: 'completed', totalAmount: 4811.68, payments: [{ paymentMethod: 'cod', status: 'completed', amount: 4811.68 }] }),
  order({ id: 4, orderNumber: '055', source: 'pos', orderType: 'takeaway', riderId: null, rider: null, deliveryStatus: null }),
];

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
  adminService: { getOnDutyRiders: vi.fn().mockResolvedValue([]), getRiders: vi.fn().mockResolvedValue([]) },
}));

import Orders from './Orders';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/orders']}>
        <Orders />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/**
 * Every copy of an order's row: the page mounts both its grid rows and its cards (CSS shows one),
 * and both roots carry a left-edge `border-l-` class. The copies must agree.
 */
/** The card copy writes the method as "· COD"; the grid copy as "COD". */
const method = (label: string) => new RegExp(`^(· )?${label}$`);
const rowsOf = async (num: string) => {
  const links = await screen.findAllByRole('link', { name: `#${num}` });
  const roots = links.map((l) => l.closest('[class*="border-l-"]') as HTMLElement);
  expect(roots.length).toBeGreaterThanOrEqual(1);
  return roots;
};

beforeEach(() => {
  permissions = ['orders:view'];
});

describe('Orders — the tender an order is due to be paid by', () => {
  it('reads COD · Unpaid for an app order before the rider has collected', async () => {
    renderPage();
    for (const row of await rowsOf('003')) {
      expect(within(row).getByText(method('COD'))).toBeInTheDocument();
      expect(within(row).getByText('Unpaid')).toBeInTheDocument();
    }
  });

  it('keeps showing what was actually paid once there is a tender', async () => {
    renderPage();
    for (const row of await rowsOf('190')) {
      expect(within(row).getByText(method('Card'))).toBeInTheDocument();
      expect(within(row).getByText('Paid')).toBeInTheDocument();
    }
    for (const row of await rowsOf('014')) {
      expect(within(row).getByText(method('COD'))).toBeInTheDocument();
      expect(within(row).getByText('Paid')).toBeInTheDocument();
    }
  });

  it('shows nothing for a till order with nothing recorded', async () => {
    renderPage();
    for (const row of await rowsOf('055')) {
      // The discount column prints a dash too, so at least one dash and no method name.
      expect(within(row).getAllByText(method('—')).length).toBeGreaterThan(0);
      expect(within(row).getByText('Unpaid')).toBeInTheDocument();
      expect(within(row).queryByText(method('COD'))).toBeNull();
    }
  });
});
