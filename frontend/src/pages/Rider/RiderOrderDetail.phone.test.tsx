import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThemeProvider } from '../../contexts/ThemeContext';
import RiderOrderDetail from './RiderOrderDetail';

/**
 * The rider's order page. On a phone the "Update delivery status" button is pinned to the bottom
 * edge and the next status is picked in a bottom sheet, one large option per status. On a tablet
 * or desktop the button stays in the card and the dialog keeps its dropdown.
 */

const getOrder = vi.fn();
const updateDeliveryStatus = vi.fn();
vi.mock('../../services/api/riderService', () => ({
  riderService: {
    getOrder: (id: number) => getOrder(id),
    getOrders: vi.fn().mockResolvedValue([]),
    updateDeliveryStatus: (id: number, status: string, reason?: string) => updateDeliveryStatus(id, status, reason),
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));

const order = (over: Record<string, unknown> = {}) => ({
  id: 7,
  order_number: '007',
  order_group_id: null,
  status: 'ready',
  delivery_status: 'accepted',
  delivery_failed_reason: null,
  customer_name: 'Jane Doe',
  customer_phone: '03001234567',
  delivery_address: '12 Test Street',
  placed_at: '2026-10-08T10:00:00.000Z',
  total_amount: 1450,
  branch: { id: 10, name: 'Emporium', address: 'Mall Road' },
  brand_name: 'Fireaway',
  items: [{ id: 1, name_snapshot: 'Zinger', quantity: 2, unit_price: 700 }],
  ...over,
});

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
const renderPage = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={['/rider/orders/7']}>
        <ThemeProvider>
          <Routes>
            <Route path="/rider/orders/:id" element={<RiderOrderDetail />} />
          </Routes>
        </ThemeProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  getOrder.mockResolvedValue(order());
  updateDeliveryStatus.mockResolvedValue({});
});
afterEach(() => setWidth(1024));

describe('Rider order page on a phone', () => {
  beforeEach(() => setWidth(390));

  it('pins the update button to the bottom edge instead of the end of the card', async () => {
    renderPage();
    const button = await screen.findByRole('button', { name: 'Update delivery status' });
    expect(screen.getAllByRole('button', { name: 'Update delivery status' })).toHaveLength(1);
    expect(button.closest('.fixed')).not.toBeNull();
    expect(button.closest('.fixed')!.className).toContain('bottom-0');
  });

  it('picks the next status from large options and sends it', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Update delivery status' }));
    expect(await screen.findByText('Update status')).toBeInTheDocument();
    const group = screen.getByRole('radiogroup', { name: 'New status' });
    // From "accepted" the only next step is Picked Up.
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Picked Up']);
    const update = screen.getByRole('button', { name: 'Update' });
    expect(update).toBeDisabled();
    fireEvent.click(within(group).getByRole('radio', { name: 'Picked Up' }));
    expect(within(group).getByRole('radio', { name: 'Picked Up' })).toHaveAttribute('aria-checked', 'true');
    expect(update).toBeEnabled();
    fireEvent.click(update);
    await waitFor(() => expect(updateDeliveryStatus).toHaveBeenCalledWith(7, 'picked_up', undefined));
  });

  it('asks for a reason before a failed delivery can be sent', async () => {
    getOrder.mockResolvedValue(order({ delivery_status: 'picked_up' }));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Update delivery status' }));
    const group = await screen.findByRole('radiogroup', { name: 'New status' });
    expect(within(group).getAllByRole('radio').map((r) => r.textContent)).toEqual(['Delivered', 'Delivery Failed']);
    fireEvent.click(within(group).getByRole('radio', { name: 'Delivery Failed' }));
    const update = screen.getByRole('button', { name: 'Update' });
    expect(update).toBeDisabled();
    fireEvent.change(screen.getByPlaceholderText(/Customer not available/), { target: { value: 'Customer not available' } });
    expect(update).toBeEnabled();
    fireEvent.click(update);
    await waitFor(() => expect(updateDeliveryStatus).toHaveBeenCalledWith(7, 'delivery_failed', 'Customer not available'));
  });

  it('Cancel closes the sheet and forgets the choice', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Update delivery status' }));
    fireEvent.click(await screen.findByRole('radio', { name: 'Picked Up' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('radiogroup')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Update delivery status' }));
    expect(await screen.findByRole('radio', { name: 'Picked Up' })).toHaveAttribute('aria-checked', 'false');
    expect(updateDeliveryStatus).not.toHaveBeenCalled();
  });

  it('offers no update for a delivered order', async () => {
    getOrder.mockResolvedValue(order({ delivery_status: 'delivered' }));
    renderPage();
    expect(await screen.findByText(/#007/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Update delivery status' })).toBeNull();
  });
});

describe('Rider order page on a tablet or desktop', () => {
  it('keeps the button in the card and the dialog with its dropdown', async () => {
    setWidth(1440);
    renderPage();
    const button = await screen.findByRole('button', { name: 'Update delivery status' });
    expect(button.closest('.fixed')).toBeNull();
    fireEvent.click(button);
    const select = await screen.findByRole('combobox');
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.change(select, { target: { value: 'picked_up' } });
    fireEvent.click(screen.getByRole('button', { name: 'Update' }));
    await waitFor(() => expect(updateDeliveryStatus).toHaveBeenCalledWith(7, 'picked_up', undefined));
  });

  it('does the same on a tablet', async () => {
    setWidth(768);
    renderPage();
    const button = await screen.findByRole('button', { name: 'Update delivery status' });
    expect(button.closest('.fixed')).toBeNull();
    fireEvent.click(button);
    // The status picker is a searchable dropdown below lg (a trigger button opening a listbox).
    const trigger = await screen.findByRole('button', { name: 'Select...' });
    expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');
  });
});
