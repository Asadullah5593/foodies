import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider } from '../contexts/ThemeContext';

const getOrderGroupMainInvoice = vi.fn();
const getOrderInvoice = vi.fn();

vi.mock('../services/api', () => ({
  orderService: {
    getOrderGroupMainInvoice: (...a: unknown[]) => getOrderGroupMainInvoice(...a),
    getOrderInvoice: (...a: unknown[]) => getOrderInvoice(...a),
  },
}));
vi.mock('../utils/print', () => ({
  printContent: vi.fn(),
}));
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

import CustomerInvoiceModal from './CustomerInvoiceModal';
import { printContent } from '../utils/print';

const groupInvoice = (autoPrint: boolean) => ({
  order_group_id: 'g-1',
  gross_total: 500,
  auto_print_invoices: autoPrint,
  currency: 'PKR',
  template: { id: 1, layout: 'thermal_classic', config: {} },
  orders: [
    {
      order_id: 11,
      order_number: 'A-11',
      items: [{ name_snapshot: 'Pizza', quantity: 1, unit_price: 500, subtotal: 500 }],
      subtotal: 500,
      discount_amount: 0,
      tax_amount: 0,
      service_charge: 0,
      delivery_fee: 0,
      total_amount: 500,
    },
  ],
});

/** The kitchen refetch returns a DIFFERENT template (58mm) so the print proves purpose=kitchen was honored. */
const kitchenInvoice = {
  order_id: 11,
  order_number: 'A-11',
  items: [{ name: 'Pizza', quantity: 1, unit_price: 500, subtotal: 500 }],
  subtotal: 500,
  total_amount: 500,
  template: { id: 2, layout: 'thermal_58mm', config: {} },
};

beforeEach(() => {
  vi.clearAllMocks();
  getOrderInvoice.mockResolvedValue(kitchenInvoice);
});

const renderModal = (props: { autoPrintOnOpen?: boolean }) => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <CustomerInvoiceModal isOpen onClose={() => {}} orderGroupId="g-1" {...props} />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

describe('CustomerInvoiceModal — kitchen (KOT) printing', () => {
  it('Print KOT refetches each order with purpose=kitchen and prints with the kitchen template', async () => {
    getOrderGroupMainInvoice.mockResolvedValue(groupInvoice(false));
    renderModal({});
    fireEvent.click(await screen.findByRole('button', { name: 'Print KOT' }));
    await waitFor(() => expect(printContent).toHaveBeenCalled());
    expect(getOrderInvoice).toHaveBeenCalledWith(11, 'kitchen');
    const [html, title, css] = vi.mocked(printContent).mock.calls[0];
    expect(title).toBe('KOT A-11');
    expect(html).toContain('Pizza');
    // The kitchen-default template (58mm) drove the print, not the customer one (80mm).
    expect(css).toContain('58mm');
  });

  it('auto-prints customer + kitchen invoices on placement when the business setting is on', async () => {
    getOrderGroupMainInvoice.mockResolvedValue(groupInvoice(true));
    renderModal({ autoPrintOnOpen: true });
    await waitFor(() => expect(printContent).toHaveBeenCalledTimes(2));
    const titles = vi.mocked(printContent).mock.calls.map((c) => c[1]);
    expect(titles).toContain('Customer invoice');
    expect(titles).toContain('KOT A-11');
  });

  it('does not auto-print when the business setting is off', async () => {
    getOrderGroupMainInvoice.mockResolvedValue(groupInvoice(false));
    renderModal({ autoPrintOnOpen: true });
    await screen.findByText(/Order #A-11/);
    expect(printContent).not.toHaveBeenCalled();
  });

  it('does not auto-print for viewers of past orders (no autoPrintOnOpen), even with the setting on', async () => {
    getOrderGroupMainInvoice.mockResolvedValue(groupInvoice(true));
    renderModal({});
    await screen.findByText(/Order #A-11/);
    expect(printContent).not.toHaveBeenCalled();
  });
});
