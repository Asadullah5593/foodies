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

describe('CustomerInvoiceModal — deal components show their own picks', () => {
  const comboGroup = {
    order_group_id: 'g-2',
    gross_total: 1079,
    currency: 'PKR',
    template: { id: 1, layout: 'thermal_classic', config: {} },
    orders: [
      {
        order_id: 12,
        order_number: 'A-12',
        items: [
          {
            name_snapshot: '1/4 Peri Peri Chicken',
            deal_id: 7,
            deal_slot_index: 0,
            deal_name: '1/4 Peri Peri Chicken with 1 Classic Side',
            quantity: 1,
            unit_price: 1079,
            subtotal: 1079,
            notes: 'extra crispy',
            addons: [{ name: 'Garlic Mayo', quantity: 1, unit_price: 0, subtotal: 0 }],
            modifiers: [{ name: 'Hot Peri Peri', group: 'Choose your Flavour', unit_price: 0 }],
          },
        ],
        subtotal: 1079,
        discount_amount: 0,
        tax_amount: 0,
        service_charge: 0,
        delivery_fee: 0,
        total_amount: 1079,
      },
    ],
  };

  it('renders the flavour chosen on a deal component, not just the component', async () => {
    getOrderGroupMainInvoice.mockResolvedValue(comboGroup);
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <CustomerInvoiceModal isOpen onClose={() => {}} orderGroupId="g-2" />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await screen.findByText('1/4 Peri Peri Chicken with 1 Classic Side');
    expect(screen.getByText(/Choose your Flavour: Hot Peri Peri/)).toBeInTheDocument();
    expect(screen.getByText(/Add-on: Garlic Mayo/)).toBeInTheDocument();
    expect(screen.getByText(/Note: extra crispy/)).toBeInTheDocument();
  });
});

describe('CustomerInvoiceModal — single-order view keeps per-item notes', () => {
  it('shows the item note and the real deal name for a non-group order', async () => {
    getOrderInvoice.mockResolvedValue({
      order_id: 21,
      order_number: 'A-21',
      items: [
        {
          name: 'Peri Peri Wings',
          quantity: 1,
          unit_price: 649,
          subtotal: 649,
          notes: 'no chilli flakes',
          deal_id: 9,
          deal_slot_index: 0,
          deal_name: 'Wings Wednesday',
        },
      ],
      subtotal: 649,
      total_amount: 649,
      template: { id: 1, layout: 'thermal_classic', config: {} },
    });
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(
      <ThemeProvider>
        <QueryClientProvider client={qc}>
          <CustomerInvoiceModal isOpen onClose={() => {}} orderId={21} />
        </QueryClientProvider>
      </ThemeProvider>,
    );
    await screen.findByText(/Order #A-21/);
    // Both were dropped by the single-order mapping: the note never reached the
    // view, and the deal header fell back to the literal word "Deal".
    expect(screen.getByText(/Note: no chilli flakes/)).toBeInTheDocument();
    expect(screen.getByText('Wings Wednesday')).toBeInTheDocument();
  });
});
