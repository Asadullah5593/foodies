import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * A delivery marked completed before anyone was assigned still has no rider on
 * record, so it is flagged like any other order needing one and can be given
 * one. A cancelled order needs no one and is never flagged.
 *
 * Kept in step with the server's "Needs rider" view (needs-rider.spec.ts): the
 * tile counts by the server's rule, the red edge is drawn by the page's, and
 * the two disagreeing is how a tile says 14 over a list that flags 12.
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
vi.mock('../../lib/pathPermissions', () => ({
  PATH_PERMISSIONS: {},
  canAccessPath: () => false,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/AssignRiderModal', () => ({ default: () => null }));
vi.mock('../../components/CustomerInvoiceModal', () => ({ default: () => null }));

type Row = Record<string, unknown>;

/** /admin/orders serves raw entities: camelCase, with the branch nested. */
const delivery = (over: Row = {}): Row => ({
  id: 37,
  orderNumber: '001',
  orderType: 'delivery',
  status: 'completed',
  source: 'pos',
  totalAmount: 904,
  placedAt: new Date('2026-09-20T11:02:00Z').toISOString(),
  customerName: 'Asad',
  riderId: null,
  rider: null,
  deliveryStatus: null,
  brand: { id: 23, name: 'Peperi. Co' },
  branch: { id: 10, name: 'Emporium', code: 'EMP' },
  payments: [],
  ...over,
});

let rows: Row[] = [];

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

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <Orders />
      </MemoryRouter>
    </QueryClientProvider>,
  );

/**
 * The table row for an order. Both layouts are in the DOM (one hidden) and the
 * table comes first, so the first match is the table's.
 */
const tableRow = async (orderNumber: string): Promise<HTMLElement> => {
  await waitFor(() => expect(screen.getAllByText(`#${orderNumber}`).length).toBeGreaterThan(0));
  return screen.getAllByText(`#${orderNumber}`)[0].closest('.grid') as HTMLElement;
};

/** The flag every order needing a rider carries: a red edge down its left side. */
const isFlagged = (row: HTMLElement) => row.className.includes('border-l-red-600');

describe('Orders — a delivery with no rider', () => {
  beforeEach(() => {
    permissions = ['orders:view', 'orders:assign-rider'];
  });

  it('is flagged, and can be given a rider, even once completed', async () => {
    rows = [delivery({ status: 'completed' })];
    renderPage();
    const row = await tableRow('001');
    expect(isFlagged(row)).toBe(true);
    expect(screen.getAllByTitle('Assign rider').length).toBeGreaterThan(0);
  });

  it('is flagged while the kitchen is still working it, as before', async () => {
    rows = [delivery({ status: 'preparing' })];
    renderPage();
    expect(isFlagged(await tableRow('001'))).toBe(true);
  });

  it('is not flagged once cancelled — it needs no one', async () => {
    rows = [delivery({ status: 'cancelled' })];
    renderPage();
    expect(isFlagged(await tableRow('001'))).toBe(false);
  });

  it('is not flagged once it has a rider', async () => {
    rows = [
      delivery({
        status: 'completed',
        riderId: 9,
        rider: { id: 9, name: 'rider ahmad' },
        deliveryStatus: 'delivered',
      }),
    ];
    renderPage();
    const row = await tableRow('001');
    expect(isFlagged(row)).toBe(false);
    expect(screen.queryByTitle('Assign rider')).not.toBeInTheDocument();
  });

  it('never flags an order that is not a delivery', async () => {
    rows = [delivery({ orderType: 'takeaway', status: 'completed' })];
    renderPage();
    expect(isFlagged(await tableRow('001'))).toBe(false);
  });
});
