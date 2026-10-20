import React from 'react';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * Phone order cards (design "Orders Mobile 2a"): three lines per order with every other fact and
 * the actions one tap away. The status moves one step either way from the open card, and the
 * pill opens a sheet with every status. Tablets and desktop keep their cards and grid.
 */

let permissions: string[] = [];
let pathAccess = false;
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
vi.mock('../../lib/pathPermissions', () => ({ PATH_PERMISSIONS: {}, canAccessPath: () => pathAccess }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/AssignRiderModal', () => ({ default: () => null }));
vi.mock('../../components/CustomerInvoiceModal', () => ({ default: () => null }));

/** /admin/orders serves raw entities: camelCase, with the branch nested. */
const voucherOrder = {
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
};
const deliveryOrder = (status: string) => ({
  id: 2,
  orderNumber: '040',
  orderType: 'delivery',
  status,
  source: 'consumer_app',
  totalAmount: 1273.68,
  placedAt: new Date().toISOString(),
  customerName: 'Abdul Daim',
  brand: { id: 22, name: 'Peperi Co' },
  branch: { id: 11, name: 'Pine Avenue', code: 'PA' },
  payments: [],
});
let rows: Array<Record<string, unknown>> = [];

const putMock = vi.fn();
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (url: string) =>
      Promise.resolve(
        String(url).includes('/admin/orders')
          ? { data: { data: rows, total: rows.length, status_counts: {} } }
          : { data: [] },
      ),
    put: (...args: unknown[]) => putMock(...args),
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

const openCard = async (orderNumber: string) => {
  fireEvent.click(await screen.findByRole('button', { name: `Show details for order #${orderNumber}` }));
};

beforeEach(() => {
  permissions = ['orders:view'];
  pathAccess = false;
  rows = [voucherOrder];
  putMock.mockReset();
  putMock.mockResolvedValue({ data: {} });
  setWidth(390);
});
afterEach(() => setWidth(1024));

describe('Orders cards on a phone', () => {
  it('show three lines per order and keep the details one tap away', async () => {
    renderPage();
    const card = await screen.findByTestId('order-phone-card');
    // Line 1: the whole order number (it wraps, never cut short), brand and total.
    expect(card).toHaveTextContent('#BR-23-551BD57C-20260317-0003');
    expect(card).toHaveTextContent('Fireaway');
    expect(card).toHaveTextContent('Rs. 1620.52');
    // Line 2 and 3: who, then status, how it was paid and the kind of discount.
    expect(card).toHaveTextContent('shazib');
    expect(card).toHaveTextContent('Accepted');
    expect(card).toHaveTextContent('Cash · Paid');
    expect(card).toHaveTextContent('· Voucher');
    expect(screen.queryByTestId('card-discount')).toBeNull();

    await openCard('BR-23-551BD57C-20260317-0003');
    const discount = screen.getByTestId('card-discount');
    expect(discount).toHaveTextContent('−Rs. 1200.00');
    expect(discount).toHaveTextContent('Voucher: Cookie and Cream, Any Coffee ×2');
    expect(card).toHaveTextContent('Johar Town · 0 items · POS · by POS');
    expect(within(card).getByRole('button', { name: 'Invoice' })).toBeInTheDocument();
    expect(within(card).getByRole('link', { name: 'View' })).toHaveAttribute('href', '/admin/orders/1');
  });

  it('open and close when the card itself is tapped', async () => {
    renderPage();
    const card = await screen.findByTestId('order-phone-card');
    fireEvent.click(within(card).getByText('Fireaway'));
    expect(screen.getByTestId('card-discount')).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: /Hide details for order/ })).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(within(card).getByText('Fireaway'));
    expect(screen.queryByTestId('card-discount')).toBeNull();
  });

  it('move the status forward one step', async () => {
    permissions = ['orders:view', 'orders:update-status'];
    renderPage();
    await openCard('BR-23-551BD57C-20260317-0003');
    const forward = screen.getByRole('button', { name: 'Move order #BR-23-551BD57C-20260317-0003 to Preparing' });
    expect(forward).toHaveTextContent('Preparing →');
    fireEvent.click(forward);
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/admin/orders/1/status', { status: 'preparing' }));
  });

  it('move the status back one step', async () => {
    permissions = ['orders:view', 'orders:update-status'];
    renderPage();
    await openCard('BR-23-551BD57C-20260317-0003');
    const back = screen.getByRole('button', { name: 'Move order #BR-23-551BD57C-20260317-0003 back to Placed' });
    expect(back).toHaveTextContent('← Placed');
    fireEvent.click(back);
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/admin/orders/1/status', { status: 'placed' }));
  });

  it('change to any status from the sheet the pill opens', async () => {
    permissions = ['orders:view', 'orders:update-status'];
    renderPage();
    const card = await screen.findByTestId('order-phone-card');
    fireEvent.click(within(card).getByRole('button', { name: 'Kitchen status for order #BR-23-551BD57C-20260317-0003' }));
    const sheet = screen.getByRole('dialog', { name: /Kitchen status/ });
    const options = within(sheet).getAllByRole('button').map((b) => b.textContent);
    expect(options).toEqual(['Placed', 'AcceptedCurrent', 'Preparing', 'Ready', 'Completed', 'Cancelled', 'Cancel']);
    // The pill sits on the card's head but opens the sheet, not the details.
    expect(screen.queryByTestId('card-discount')).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: 'Ready' }));
    await waitFor(() => expect(putMock).toHaveBeenCalledWith('/admin/orders/1/status', { status: 'ready' }));
  });

  it('leave Cancelled out of the sheet for a no-cancel account', async () => {
    permissions = ['orders:view', 'orders:update-status:no-cancel'];
    renderPage();
    const card = await screen.findByTestId('order-phone-card');
    fireEvent.click(within(card).getByRole('button', { name: /Kitchen status for order/ }));
    const sheet = screen.getByRole('dialog', { name: /Kitchen status/ });
    expect(within(sheet).queryByRole('button', { name: 'Cancelled' })).toBeNull();
    expect(within(sheet).getByRole('button', { name: 'Completed' })).toBeInTheDocument();
  });

  it('offer no status change without the permission', async () => {
    renderPage();
    await openCard('BR-23-551BD57C-20260317-0003');
    const card = screen.getByTestId('order-phone-card');
    expect(within(card).queryByRole('button', { name: /Kitchen status for order/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Move order/ })).toBeNull();
  });

  it('stop a delivery at Ready going forward and show its rider and rider actions', async () => {
    permissions = ['orders:view', 'orders:update-status', 'orders:assign-rider'];
    rows = [deliveryOrder('ready')];
    renderPage();
    const card = await screen.findByTestId('order-phone-card');
    expect(card).toHaveTextContent('Unassigned');
    await openCard('040');
    expect(screen.getByRole('button', { name: 'Move order #040 back to Preparing' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move order #040 to Completed' })).toBeNull();
    expect(within(card).getByRole('button', { name: 'Assign rider' })).toBeInTheDocument();
    expect(within(card).getByRole('button', { name: 'Retry auto-assign' })).toBeInTheDocument();
  });

  it('only step back from Completed, and not at all from Cancelled', async () => {
    permissions = ['orders:view', 'orders:update-status'];
    rows = [{ ...voucherOrder, status: 'completed' }, { ...deliveryOrder('cancelled'), id: 3, orderNumber: '041' }];
    renderPage();
    await openCard('BR-23-551BD57C-20260317-0003');
    expect(screen.getByRole('button', { name: /back to Ready/ })).toBeInTheDocument();
    await openCard('041');
    const cancelled = screen.getAllByTestId('order-phone-card').find((c) => c.textContent?.includes('#041'))!;
    expect(within(cancelled).queryByRole('button', { name: /Move order/ })).toBeNull();
  });

  it('turn the rider banner and the auto-assign pill into chips beside the filters', async () => {
    pathAccess = true;
    renderPage();
    await screen.findByTestId('order-phone-card');
    expect(screen.getByRole('button', { name: 'Auto-assign on' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '0 riders on duty' })).toBeInTheDocument();
    expect(screen.queryByText('Automatic rider assignment')).toBeNull();
    expect(screen.getByRole('button', { name: 'Filters' })).toBeInTheDocument();
  });
});

describe('Orders cards on desktop', () => {
  beforeEach(() => setWidth(1024));

  it('keep the discount under the total, with no phone card', async () => {
    renderPage();
    await screen.findAllByRole('link', { name: '#BR-23-551BD57C-20260317-0003' });
    expect(screen.queryByTestId('card-discount')).toBeNull();
    expect(screen.queryByTestId('order-phone-card')).toBeNull();
  });

  it('keep the rider banner', async () => {
    pathAccess = true;
    renderPage();
    expect(await screen.findByText('Automatic rider assignment')).toBeInTheDocument();
  });
});
