import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Phone order cards keep every fact and grow instead of truncating: the discount and the
 * voucher names that made it get their own full-width row (beside the total they pushed the
 * order number off the card), and the order number is never cut short. Desktop cards keep
 * the discount under the total.
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

/** /admin/orders serves raw entities: camelCase, with the branch nested. */
const rows = [
  {
    id: 1,
    orderNumber: 'BR-23-551BD57C-20260317-0003',
    orderType: 'takeaway',
    status: 'accepted',
    source: 'pos',
    totalAmount: 1620.52,
    discountAmount: 1200,
    voucherDiscountAmount: 1200,
    voucherName: 'Cookie and Cream, Any Coffee ×2',
    placedAt: new Date().toISOString(),
    customerName: 'shazib',
    brand: { id: 21, name: 'Fireaway' },
    branch: { id: 10, name: 'Johar Town', code: 'JT' },
    payments: [{ paymentMethod: 'cash', status: 'completed', amount: 1620.52 }],
  },
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

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

beforeEach(() => {
  permissions = ['orders:view'];
});
afterEach(() => setWidth(1024));

describe('Orders cards on a phone', () => {
  it('give the discount and its vouchers a full-width row and keep the whole order number', async () => {
    setWidth(390);
    renderPage();
    const row = await screen.findByTestId('card-discount');
    expect(row).toHaveTextContent('−Rs. 1200.00');
    expect(row).toHaveTextContent('Voucher: Cookie and Cream, Any Coffee ×2');
    // The order number is all there, and allowed to wrap rather than be cut short.
    const links = screen.getAllByRole('link', { name: '#BR-23-551BD57C-20260317-0003' });
    expect(links.some((l) => l.className.includes('max-lg:whitespace-normal'))).toBe(true);
  });
});

describe('Orders cards on desktop', () => {
  it('keep the discount under the total, with no separate row', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: '#BR-23-551BD57C-20260317-0003' });
    expect(screen.queryByTestId('card-discount')).toBeNull();
  });
});
