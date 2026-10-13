import React from 'react';
import { render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider } from '../../contexts/ThemeContext';

/**
 * The Payments card names the tender an order is due to be paid by before any
 * money is recorded: an app order the rider collects cash for reads
 * "Cash on delivery (COD) · Unpaid" from the moment it arrives. Once a tender
 * is recorded the card lists it as before, and a till order with nothing
 * recorded still says so.
 */

vi.mock('../../hooks/useHasPermission', () => ({
  useHasPermission: () => false,
  useHasRestriction: () => false,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/CustomerInvoiceModal', () => ({ default: () => null }));
vi.mock('../../components/PaymentRequiredModal', () => ({
  usePaymentRequiredPrompt: () => ({ ask: () => false, modal: null }),
}));
vi.mock('../../utils/print', () => ({ printContent: vi.fn() }));

const baseOrder = {
  id: 43745,
  order_number: '003',
  order_type: 'delivery',
  status: 'preparing',
  source: 'consumer_app',
  customer_name: 'Abad ur rehman',
  subtotal: 1449,
  tax_amount: 231.84,
  total_amount: 1680.84,
  placed_at: '2026-10-12T09:15:00.000Z',
  brand: { id: 23, name: 'Wok & Go' },
  branch: { id: 10, name: 'Pine Avenue', code: 'PA' },
  items: [{ id: 1, name_snapshot: 'Chicken Teriyaki', quantity: 1, unit_price: 1449, subtotal: 1449, addons: [], modifiers: [] }],
  payments: [],
  pending_payment_method: null as string | null,
};
let currentOrder: Record<string, unknown> = baseOrder;

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (url: string) => Promise.resolve({ data: /\/ratings$/.test(url) ? { rider_rating: null, brand_ratings: [] } : currentOrder }),
    put: vi.fn(),
  },
}));

import OrderDetail from './OrderDetail';

const renderPage = () =>
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/admin/orders/43745']}>
          <Routes>
            <Route path="/admin/orders/:id" element={<OrderDetail />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  currentOrder = baseOrder;
});

describe('OrderDetail — the tender an order is due to be paid by', () => {
  it('names COD on an app order before the rider has collected', async () => {
    currentOrder = { ...baseOrder, pending_payment_method: 'cod' };
    renderPage();
    const block = await screen.findByTestId('pending-tender');
    expect(block).toHaveTextContent('Method: Cash on delivery (COD)');
    expect(block).toHaveTextContent('Unpaid');
    expect(block).toHaveTextContent('recorded here when the order is completed');
    expect(screen.queryByText('No payments recorded for this order.')).toBeNull();
  });

  it('lists the tender once it is recorded', async () => {
    currentOrder = { ...baseOrder, status: 'completed', payments: [{ id: 9, method: 'cod', amount: 1680.84, status: 'completed', paid_at: '2026-10-12T10:00:00.000Z' }] };
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #003' });
    expect(screen.queryByTestId('pending-tender')).toBeNull();
    expect(screen.getByText('cod')).toBeInTheDocument();
    expect(screen.getByText('Rs. 1680.84', { selector: 'span.font-semibold' })).toBeInTheDocument();
  });

  it('still says nothing is recorded for a till order', async () => {
    currentOrder = { ...baseOrder, source: 'pos' };
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #003' });
    expect(screen.queryByTestId('pending-tender')).toBeNull();
    expect(screen.getByText('No payments recorded for this order.')).toBeInTheDocument();
  });
});
