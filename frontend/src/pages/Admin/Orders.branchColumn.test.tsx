import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Every order says which branch it belongs to — an owner reading "All
 * branches" had no way to tell two branches' orders apart.
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

describe('Orders — branch column', () => {
  beforeEach(() => {
    permissions = ['orders:view'];
    rows = [delivery()];
  });

  it('heads a column with Branch, between the order and its customer', async () => {
    renderPage();
    await tableRow('001');
    const heads = Array.from(screen.getByText('Branch').parentElement!.children).map(
      (el) => el.textContent,
    );
    expect(heads.slice(2, 5)).toEqual(['Order', 'Branch', 'Customer']);
  });

  it('gives the head and every row the same number of cells', async () => {
    // A head without its cell (or the reverse) shifts every column after it
    // under the wrong heading — the table still renders, just wrongly.
    renderPage();
    const row = await tableRow('001');
    const head = screen.getByText('Branch').parentElement!;
    expect(row.children).toHaveLength(head.children.length);
    expect(head.children).toHaveLength(15);
  });

  it('names the branch each order belongs to', async () => {
    rows = [
      delivery(),
      delivery({ id: 38, orderNumber: '002', branch: { id: 12, name: 'Johar Town', code: 'JT' } }),
    ];
    renderPage();
    const first = await tableRow('001');
    const second = await tableRow('002');
    expect(first.children[3].textContent).toBe('Emporium');
    expect(second.children[3].textContent).toBe('Johar Town');
  });

  it('keeps a long name readable on hover when the column cuts it short', async () => {
    rows = [delivery({ branch: { id: 20, name: 'Retrograde Branch 1', code: 'RB1' } })];
    renderPage();
    const row = await tableRow('001');
    expect(row.children[3]).toHaveAttribute('title', 'Retrograde Branch 1');
  });

  it('reads a dash for an order that carries no branch', async () => {
    rows = [delivery({ branch: null })];
    renderPage();
    const row = await tableRow('001');
    expect(row.children[3].textContent).toBe('—');
  });

  it('shows the branch on the stacked cards too', async () => {
    renderPage();
    await tableRow('001');
    // Once in the table, once on the card.
    expect(screen.getAllByText(/Emporium/).length).toBe(2);
  });
});
