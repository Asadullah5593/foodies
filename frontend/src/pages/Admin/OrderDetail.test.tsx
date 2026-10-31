import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { deliveryOrder, dineInOrder, ratingsFixture, noRatings } from './OrderDetail.fixture';

/**
 * The redesigned order page on a desktop: the design sets the look, and every fact the old page
 * showed is still on it — for a delivery order from the app, a dine-in till order, a voucher
 * order and a failed delivery.
 */

let permissions: string[] = [];
let canOpenCustomers = true;
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
vi.mock('../../lib/pathPermissions', () => ({
  PATH_PERMISSIONS: {},
  canAccessPath: (_u: unknown, path: string) => path === '/admin/customers' && canOpenCustomers,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../components/CustomerInvoiceModal', () => ({ default: () => null }));
vi.mock('../../components/PaymentRequiredModal', () => ({
  usePaymentRequiredPrompt: () => ({ ask: () => false, modal: null }),
}));
const printContent = vi.fn();
vi.mock('../../utils/print', () => ({ printContent: (...args: unknown[]) => printContent(...args) }));

let currentOrder: Record<string, unknown> = deliveryOrder;
let currentRatings: Record<string, unknown> = ratingsFixture;
const put = vi.fn().mockResolvedValue({ data: {} });
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: (url: string) => {
      if (/\/ratings$/.test(url)) return Promise.resolve({ data: currentRatings });
      return Promise.resolve({ data: currentOrder });
    },
    put: (...args: unknown[]) => put(...args),
  },
}));

import OrderDetail from './OrderDetail';

const renderPage = (id = 259) =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[`/admin/orders/${id}`]}>
        <Routes>
          <Route path="/admin/orders/:id" element={<OrderDetail />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  );

const card = (id: string) => screen.getByTestId(id);

beforeEach(() => {
  permissions = ['orders:view', 'orders:update-status'];
  canOpenCustomers = true;
  currentOrder = deliveryOrder;
  currentRatings = ratingsFixture;
  put.mockClear();
  printContent.mockClear();
});

describe('OrderDetail — a delivery order from the app', () => {
  it('heads with the number, type, source, brand, branch, time and who took it', async () => {
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'Order #040' })).toBeInTheDocument();
    expect(screen.getByTestId('type-badge')).toHaveTextContent('Delivery');
    expect(screen.getByTestId('source-badge')).toHaveTextContent('Consumer app');
    const meta = screen.getByTestId('order-meta').textContent ?? '';
    expect(meta).toContain('Peperi Co');
    expect(meta).toContain('Pine Avenue');
    expect(meta).toMatch(/Placed 09 Oct 2026, \d{1,2}:\d{2}/);
    expect(meta).toContain('by Admin');
    expect(screen.getByTestId('order-note')).toHaveTextContent('Ring the bell twice');
  });

  it('the status pill is the status control, and the progress strip marks where the order is', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    expect(screen.getByTestId('status-pill')).toHaveTextContent('Accepted');
    const select = screen.getByLabelText('Update status') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).toEqual(['placed', 'accepted', 'preparing', 'ready', 'completed', 'cancelled']);
    fireEvent.change(select, { target: { value: 'preparing' } });
    await waitFor(() => expect(put).toHaveBeenCalledWith('/admin/orders/259/status', { status: 'preparing' }));

    const strip = screen.getByTestId('stepper');
    const steps = within(strip).getAllByRole('button');
    expect(steps.map((b) => b.textContent)).toEqual(['Placed', 'Accepted', 'Preparing', 'Ready', 'Completed']);
    expect(steps[1]).toHaveAttribute('aria-current', 'step');
    fireEvent.click(within(strip).getByRole('button', { name: 'Set status to Ready' }));
    await waitFor(() => expect(put).toHaveBeenCalledWith('/admin/orders/259/status', { status: 'ready' }));
  });

  it('a no-cancel account gets the flow without Cancelled', async () => {
    permissions = ['orders:view', 'orders:update-status:no-cancel'];
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const select = screen.getByLabelText('Update status') as HTMLSelectElement;
    expect(Array.from(select.options).map((o) => o.value)).not.toContain('cancelled');
  });

  it('without the permission the pill is plain text and the strip is not clickable', async () => {
    permissions = ['orders:view'];
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    expect(screen.getByTestId('status-pill')).toHaveTextContent('Accepted');
    expect(screen.queryByLabelText('Update status')).toBeNull();
    expect(screen.queryByRole('button', { name: /^Set status to/ })).toBeNull();
  });

  it('lists the items with their options as chips, removals in red, a free nested pick as Included, and the deal grouped', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const items = card('items-card');
    expect(items).toHaveTextContent('3 items · 4 qty');
    const lines = within(items).getAllByTestId('item-line');
    expect(lines).toHaveLength(3);

    const wrap = lines[0];
    expect(wrap).toHaveTextContent('Krunchy Chicken Wrap');
    // Both the desktop "each" span and the phone "qty ×" span are in the DOM; CSS shows one.
    expect(wrap).toHaveTextContent('Rs. 699.00 each');
    expect(wrap).toHaveTextContent('· Large · extras Rs. 250.00');
    expect(wrap).toHaveTextContent('Rs. 949.00');
    expect(wrap).toHaveTextContent('Note: Extra crispy');
    const chips = within(wrap).getAllByTestId('option-chip');
    const byLabel = Object.fromEntries(chips.map((c) => [c.textContent, c.dataset.tone]));
    expect(byLabel['Extra Cheese ×2 +Rs. 100.00']).toBe('plain');
    expect(byLabel['Meal +Rs. 150.00']).toBe('plain');
    expect(byLabel['↳ Milkshake · Included']).toBe('included');
    expect(byLabel['No Onion']).toBe('removal');
    expect(byLabel['No Tomato']).toBe('removal');
    expect(within(wrap).getByText('Add-ons')).toBeInTheDocument();
    expect(within(wrap).getByText('Make it a meal?')).toBeInTheDocument();
    expect(within(wrap).getByText('Remove a filling')).toBeInTheDocument();

    const deal = within(items).getByTestId('deal-group');
    expect(deal).toHaveTextContent('Deal');
    expect(deal).toHaveTextContent('Family Deal');
    expect(deal).toHaveTextContent('Rs. 599.00');
    // Slots keep their menu order inside the deal.
    const dealLines = within(deal).getAllByTestId('item-line').map((l) => l.textContent ?? '');
    expect(dealLines[0]).toContain('Snap Chick');
    expect(dealLines[1]).toContain('Pepsi 500ml');
    expect(items).toHaveTextContent('Options with no extra charge are shown without a price.');
  });

  it('shows the customer with a phone link and a way to their profile, and where to deliver', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const customer = card('customer-card');
    expect(customer).toHaveTextContent('Abdul Daim');
    expect(within(customer).getByRole('link', { name: '0344 4030046' })).toHaveAttribute('href', 'tel:03444030046');
    expect(within(customer).getByRole('link', { name: 'View profile' })).toHaveAttribute('href', '/admin/customers/10');
    expect(customer).toHaveTextContent('Deliver to');
    expect(customer).toHaveTextContent('505 5th Ave SE, NFC Society, Lahore');
    expect(customer).toHaveTextContent('ETA 30–45 min');
  });

  it('hides the profile link when the viewer cannot open Customers', async () => {
    canOpenCustomers = false;
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    expect(screen.queryByRole('link', { name: 'View profile' })).toBeNull();
  });

  it("shows the rider's trip: who, picked up, delivered, trip time", async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const delivery = card('delivery-card');
    expect(delivery).toHaveTextContent('Delivered');
    expect(delivery).toHaveTextContent('Ahmad Rider');
    expect(delivery).toHaveTextContent(/Picked up09 Oct 2026, \d{1,2}:\d{2}/);
    expect(delivery).toHaveTextContent('Trip time23 min');
  });

  it('totals keep the coupon discount, service charge, delivery fee, points and the grand total', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const totals = card('totals-card');
    const text = totals.textContent ?? '';
    expect(text).toContain('SubtotalRs. 1098.00');
    expect(text).toContain('Discount');
    expect(text).toContain('SAVE100');
    expect(text).toContain('-Rs. 100.00');
    expect(text).toContain('TaxRs. 175.68');
    expect(text).toContain('Service chargeRs. 25.00');
    expect(text).toContain('Delivery feeRs. 150.00');
    expect(text).toContain('Points earned+50');
    expect(text).toContain('Points redeemed−20');
    expect(within(totals).getByTestId('grand-total')).toHaveTextContent('Rs. 1348.68');
  });

  it('a settled order reads Paid with its tender', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const payment = card('payment-card');
    expect(within(payment).getByTestId('payment-pill')).toHaveTextContent('Paid');
    expect(payment).toHaveTextContent('Cash');
    expect(payment).toHaveTextContent('completed');
    expect(payment).toHaveTextContent('Rs. 1348.68');
    expect(payment).not.toHaveTextContent('Amount due');
  });

  it('shows both ratings with their comments and the public average, and explains itself on request', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const ratings = card('ratings-card');
    expect(ratings).toHaveTextContent('Delivery rider');
    expect(ratings).toHaveTextContent('4/5');
    expect(ratings).toHaveTextContent('Quick and polite');
    expect(ratings).toHaveTextContent('Brand / food');
    expect(ratings).toHaveTextContent('Peperi Co');
    expect(ratings).toHaveTextContent('4.3 / 5');
    expect(ratings).toHaveTextContent('12 ratings (all orders)');
    expect(ratings).not.toHaveTextContent('Stars only');
    fireEvent.click(within(ratings).getByRole('button', { name: "What's shown?" }));
    expect(ratings).toHaveTextContent('Stars only — no customer names or phones.');
  });

  it('Print sends the receipt to the printer', async () => {
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(printContent).toHaveBeenCalledTimes(1);
    expect(String(printContent.mock.calls[0][0])).toContain('Order #040');
  });
});

describe('OrderDetail — other kinds of order', () => {
  it('a dine-in till order shows its table, no delivery card, and that nothing is paid yet', async () => {
    currentOrder = dineInOrder;
    currentRatings = noRatings;
    renderPage(267);
    await screen.findByRole('heading', { level: 1, name: 'Order #001' });
    expect(screen.getByTestId('type-badge')).toHaveTextContent('Dine in');
    expect(screen.getByTestId('source-badge')).toHaveTextContent('POS');
    expect(screen.getByTestId('order-meta')).toHaveTextContent('by Cashier One');
    expect(screen.queryByTestId('order-note')).toBeNull();

    const customer = card('customer-card');
    expect(customer).toHaveTextContent('Dine-in guest');
    expect(customer).toHaveTextContent('Table7');
    expect(screen.queryByRole('link', { name: 'View profile' })).toBeNull();
    expect(screen.queryByTestId('delivery-card')).toBeNull();

    const payment = card('payment-card');
    expect(within(payment).getByTestId('payment-pill')).toHaveTextContent('Unpaid');
    expect(payment).toHaveTextContent('Amount dueRs. 580.00');
    expect(payment).toHaveTextContent('No payments recorded for this order yet.');

    const ratings = card('ratings-card');
    expect(ratings).not.toHaveTextContent('Delivery rider');
    expect(ratings).toHaveTextContent('Not rated yet');

    const totals = card('totals-card').textContent ?? '';
    expect(totals).not.toContain('Discount');
    expect(totals).not.toContain('Service charge');
    expect(totals).not.toContain('Points');
  });

  it('an app order the rider collects cash for names COD before any payment is recorded', async () => {
    currentOrder = { ...deliveryOrder, status: 'preparing', payments: [], pending_payment_method: 'cod' };
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const payment = card('payment-card');
    expect(within(payment).getByTestId('payment-pill')).toHaveTextContent('Unpaid');
    expect(payment).toHaveTextContent('Amount dueRs. 1348.68');
    expect(within(payment).getByTestId('pending-tender')).toHaveTextContent('MethodCash on delivery (COD)');
    expect(payment).toHaveTextContent('recorded here when the order is completed');
    expect(payment).toHaveTextContent('No payments recorded for this order yet.');
  });

  it('a failed delivery shows the rider’s reason', async () => {
    currentOrder = { ...deliveryOrder, delivery_status: 'delivery_failed', delivery_failed_reason: 'Customer unreachable', delivered_at: null, trip_duration_seconds: null };
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const delivery = card('delivery-card');
    expect(delivery).toHaveTextContent('Delivery Failed');
    expect(delivery).toHaveTextContent('Reason: Customer unreachable');
    expect(delivery).toHaveTextContent('Trip time—');
  });

  it('printed vouchers take the discount line and list each kind', async () => {
    currentOrder = {
      ...deliveryOrder,
      discount_code: null,
      discount_amount: 400,
      voucher_name: 'Any Large Pizza ×2, Free Drink',
      voucher_discount_amount: 400,
      vouchers: [
        { name: 'Any Large Pizza', quantity: 2, discount_amount: 300 },
        { name: 'Free Drink', quantity: 1, discount_amount: 100 },
      ],
    };
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const totals = card('totals-card').textContent ?? '';
    expect(totals).toContain('Voucher');
    expect(totals).toContain('Any Large Pizza ×2, Free Drink');
    expect(totals).toContain('-Rs. 400.00');
    expect(totals).toContain('Any Large Pizza ×2-Rs. 300.00');
    expect(totals).toContain('Free Drink-Rs. 100.00');
  });

  it('the tax line shows the GST rate, not the amount it was charged on, on screen and in print', async () => {
    currentOrder = { ...deliveryOrder, tax_base: 1098, tax_rate: 0.16 };
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const totals = card('totals-card').textContent ?? '';
    expect(totals).toContain('Tax (16%)Rs. 175.68');
    expect(totals).not.toContain('on Rs.');
    fireEvent.click(screen.getByRole('button', { name: 'Print' }));
    expect(String(printContent.mock.calls[0][0])).toContain('Tax (16%): Rs. 175.68');
  });

  it('the tax line is plain "Tax" when the order has no rate', async () => {
    currentOrder = { ...deliveryOrder, tax_rate: null };
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    expect(card('totals-card').textContent ?? '').not.toContain('Tax (');
  });

  it('a completed order ticks every step', async () => {
    currentOrder = { ...deliveryOrder, status: 'completed' };
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    const strip = screen.getByTestId('stepper');
    expect(within(strip).queryByRole('button', { current: 'step' })).toBeNull();
    expect(within(strip).getAllByRole('button').every((b) => b.querySelector('svg'))).toBe(true);
  });

  it('a cancelled order shows the pill in red and no progress', async () => {
    currentOrder = { ...deliveryOrder, status: 'cancelled' };
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'Order #040' });
    expect(screen.getByTestId('status-pill')).toHaveTextContent('Cancelled');
    expect(within(screen.getByTestId('stepper')).queryByRole('button', { current: 'step' })).toBeNull();
  });
});
