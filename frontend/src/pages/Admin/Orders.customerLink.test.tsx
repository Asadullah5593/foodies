import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * On the Orders page a saved customer's name opens their order history — this page narrowed to
 * them. A table or walk-in order has no customer to open, so it stays plain text.
 * The page mounts both its desktop table and its phone cards (CSS shows one), so every name is
 * in the DOM twice; both copies must agree.
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

const order = (over: Record<string, unknown>) => ({
  id: 1, order_number: '022', status: 'accepted', order_type: 'dine_in', source: 'pos', total_amount: 1267.38,
  placed_at: new Date().toISOString(), items_count: 2, payments: [], branch: { id: 10, name: 'Pine Avenue' },
  brand: { id: 21, name: 'Fireaway' }, customer_id: null, customer_name: null, customer_phone: null, table_number: null,
  ...over,
});
const defaultRows = [
  order({ id: 1, order_number: '041', customer_id: 412, customer_name: 'Abdullah Arshad', customer_phone: '03240201350' }),
  order({ id: 2, order_number: '042', customer_id: 7, customer_name: 'Tahir', customer_phone: null }),
  order({ id: 3, order_number: '022', table_number: '1' }),
];
let rows: typeof defaultRows = defaultRows;
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (url: string) => {
      if (String(url).startsWith('/admin/orders?')) return Promise.resolve({ data: { data: rows, total: rows.length, status_counts: {} } });
      return Promise.resolve({ data: [] });
    },
    put: vi.fn(),
  },
}));
vi.mock('../../services/api/adminService', () => ({ adminService: { getOnDutyRiders: vi.fn().mockResolvedValue([]) } }));

import Orders from './Orders';

const renderPage = (url = '/admin/orders') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[url]}>
        <Orders />
      </MemoryRouter>
    </QueryClientProvider>,
  );

describe("Orders — a customer's name opens their history", () => {
  beforeEach(() => { permissions = ['orders:view']; rows = defaultRows; });

  it('links a saved customer to this page narrowed to them, named for the banner', async () => {
    renderPage();
    const links = await screen.findAllByRole('link', { name: 'Abdullah Arshad' });
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      const sp = new URL(link.getAttribute('href')!, 'http://x').searchParams;
      expect(sp.get('customer_id')).toBe('412');
      expect(sp.get('customer_label')).toBe('Abdullah Arshad (03240201350)');
      expect(link.getAttribute('title')).toMatch(/order history/);
    }
  });

  it('still links a customer with no phone on file', async () => {
    renderPage();
    const links = await screen.findAllByRole('link', { name: 'Tahir' });
    for (const link of links) {
      const sp = new URL(link.getAttribute('href')!, 'http://x').searchParams;
      expect(sp.get('customer_id')).toBe('7');
      expect(sp.get('customer_label')).toBe('Tahir');
    }
  });

  it("in one customer's history, leads with the record's name and says when an order was typed under another", async () => {
    rows = [
      order({ id: 1, order_number: '002', customer_id: 10, customer_name: 'John Doe', customer_phone: '03001234567' }),
      order({ id: 2, order_number: '001', customer_id: 10, customer_name: 'EPG Test', customer_phone: '03001234567', source: 'consumer_app' }),
    ];
    renderPage('/admin/orders?customer_id=10&customer_label=John+Doe+%2803001234567%29');
    const notes = await screen.findAllByTestId('ordered-as');
    expect(notes[0]).toHaveTextContent('ordered as EPG Test');
    // Both rows lead with the record's name; nothing links back to the view already open.
    expect(screen.getAllByText('John Doe').length).toBeGreaterThanOrEqual(2);
    expect(screen.queryByRole('link', { name: 'John Doe' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'EPG Test' })).toBeNull();
  });

  it('leaves a table order as plain text', async () => {
    renderPage();
    const cells = await screen.findAllByText('Table 1');
    expect(cells.length).toBeGreaterThan(0);
    for (const cell of cells) expect(cell.closest('a')).toBeNull();
    expect(screen.queryByRole('link', { name: 'Table 1' })).toBeNull();
  });
});
