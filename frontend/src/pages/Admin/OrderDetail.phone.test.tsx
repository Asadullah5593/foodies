import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { deliveryOrder, ratingsFixture } from './OrderDetail.fixture';

/**
 * The order page on a phone: one column, the status pill opens a bottom sheet instead of a
 * dropdown, an "Update status" button is pinned to the bottom edge, and the progress strip is
 * display-only (its five targets are too small to change an order by accident).
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
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));
vi.mock('../../lib/pathPermissions', () => ({ PATH_PERMISSIONS: {}, canAccessPath: () => true }));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/CustomerInvoiceModal', () => ({ default: () => null }));
vi.mock('../../components/PaymentRequiredModal', () => ({
  usePaymentRequiredPrompt: () => ({ ask: () => false, modal: null }),
}));
vi.mock('../../utils/print', () => ({ printContent: vi.fn() }));

const put = vi.fn().mockResolvedValue({ data: {} });
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (url: string) => Promise.resolve({ data: /\/ratings$/.test(url) ? ratingsFixture : deliveryOrder }),
    put: (...args: unknown[]) => put(...args),
  },
}));

import OrderDetail from './OrderDetail';

const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/admin/orders/259']}>
        <Routes>
          <Route path="/admin/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

beforeEach(() => {
  permissions = ['orders:view', 'orders:update-status'];
  put.mockClear();
  setWidth(390);
});
afterEach(() => setWidth(1024));

describe('OrderDetail on a phone', () => {
  it('changes the status from a bottom sheet opened by the pill or the pinned button', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    expect(screen.queryByLabelText('Update status', { selector: 'select' })).toBeNull();
    expect(screen.queryByRole('button', { name: /^Set status to/ })).toBeNull();

    const pinned = screen.getByRole('button', { name: 'Update status · Accepted' });
    expect(pinned).toHaveAttribute('aria-haspopup', 'dialog');

    fireEvent.click(screen.getByTestId('status-pill'));
    const sheet = await screen.findByRole('dialog', { name: /Order #040 · status/ });
    const rows = within(sheet).getAllByRole('button').map((b) => b.textContent);
    expect(rows).toEqual(['Placed', 'AcceptedCurrent', 'Preparing', 'Ready', 'Completed', 'Cancelled', 'Cancel']);
    expect(within(sheet).getByRole('button', { name: /^Accepted/ })).toHaveAttribute('aria-current', 'true');

    fireEvent.click(within(sheet).getByRole('button', { name: 'Preparing' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/admin/orders/259/status', { status: 'preparing' }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: /status/ })).toBeNull());

    fireEvent.click(pinned);
    expect(await screen.findByRole('dialog', { name: /Order #040 · status/ })).toBeInTheDocument();
  });

  it('shows the quantity beside the price since the Qty column is gone', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const lines = screen.getAllByTestId('item-line');
    const pepsi = lines.find((l) => l.textContent?.includes('Pepsi 500ml'))!;
    expect(pepsi).toHaveTextContent('2 × Rs. 100.00');
    expect(pepsi).toHaveTextContent('Rs. 200.00');
  });

  it('without the permission there is no pinned button and the pill is plain', async () => {
    permissions = ['orders:view'];
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    expect(screen.queryByRole('button', { name: /^Update status/ })).toBeNull();
    expect(screen.getByTestId('status-pill').tagName).toBe('SPAN');
  });
});
