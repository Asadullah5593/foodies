import React from 'react';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * Each customer row has an "Orders" button that opens the Orders module on that
 * customer's whole history — the same list, details and invoices Orders shows,
 * not a cut-down copy. It is offered only to someone who can open Orders.
 *
 * The row also shows loyalty per wallet, POS and app told apart (see
 * LoyaltyWalletChips.test.tsx): a customer who registered in the mobile app can
 * hold POS points and no app points at all.
 */

let canOpenOrders = true;
let permissions: string[] = [];
vi.mock('../../hooks/useHasPermission', () => ({
  useHasPermission: (need: string | string[]) => {
    const list = Array.isArray(need) ? need : [need];
    return list.some((p) => permissions.includes(p));
  },
}));
vi.mock('../../hooks/useSensitivePageView', () => ({ useSensitivePageView: () => undefined }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));
vi.mock('../../lib/pathPermissions', () => ({
  PATH_PERMISSIONS: {},
  canAccessPath: (_u: unknown, path: string) => path === '/admin/orders' && canOpenOrders,
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => null }));

const customers = [
  {
    id: 412,
    name: 'Abdullah Arshad',
    phone: '03240201350',
    source: 'consumer_app',
    loyaltyWallets: [
      { wallet_type: 'pos', brand_id: 21, brand_name: 'Fireaway', balance: 4369 },
      { wallet_type: 'pos', brand_id: 23, brand_name: 'Peperi Co', balance: 949 },
    ],
    brands: [{ id: 23, name: 'Peperi Co' }],
  },
  { id: 7, name: 'Arbaz', phone: '03124551339', source: 'consumer_app', loyaltyWallets: [] },
];

vi.mock('../../services/api', () => ({
  adminService: {
    getCustomers: () => Promise.resolve(customers),
    getCustomerVouchers: () => Promise.resolve({ vouchers: [] }),
  },
}));

import Customers from './Customers';
import { ThemeProvider } from '../../contexts/ThemeContext';

const Where: React.FC = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
};

const renderPage = () =>
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={['/admin/customers']}>
          <Routes>
            <Route path="/admin/customers" element={<Customers />} />
            <Route path="/admin/orders" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );

describe('Customers — order history button', () => {
  beforeEach(() => {
    canOpenOrders = true;
    permissions = [];
  });

  it("opens the Orders module on that customer's history", async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Abdullah Arshad')).toBeTruthy());
    const buttons = screen.getAllByRole('button', { name: 'Orders' });
    expect(buttons).toHaveLength(customers.length);
    fireEvent.click(buttons[0]);
    const where = await screen.findByTestId('where');
    const url = new URL(where.textContent ?? '', 'http://x');
    expect(url.pathname).toBe('/admin/orders');
    expect(url.searchParams.get('customer_id')).toBe('412');
    expect(url.searchParams.get('customer_label')).toBe('Abdullah Arshad (03240201350)');
    // No dates: the history is not cut down to today.
    expect(url.searchParams.has('date_from')).toBe(false);
  });

  it('is not offered to someone who cannot open Orders', async () => {
    canOpenOrders = false;
    renderPage();
    await waitFor(() => expect(screen.getByText('Abdullah Arshad')).toBeTruthy());
    expect(screen.queryByRole('button', { name: 'Orders' })).toBeNull();
    // The rest of the row is untouched.
    expect(screen.getAllByRole('button', { name: 'Vouchers' })).toHaveLength(customers.length);
  });
});

describe('Customers — loyalty per wallet', () => {
  beforeEach(() => {
    canOpenOrders = true;
    permissions = [];
  });

  it('shows an app-registered customer’s POS points as POS points', async () => {
    const { container } = renderPage();
    await waitFor(() => expect(screen.getByText('Abdullah Arshad')).toBeTruthy());
    const chips = Array.from(container.querySelectorAll<HTMLElement>('[data-wallet-type]'));
    expect(chips.map((c) => c.dataset.walletType)).toEqual(['pos', 'pos']);
    expect(chips[0].textContent).toContain('POS');
    expect(chips[0].textContent).toContain('Fireaway');
    expect(chips[0].textContent).toContain('4,369');
    expect(chips[1].textContent).toContain('Peperi Co');
    expect(chips[1].textContent).toContain('949');
  });

  it('still says zero for a customer with no wallet', async () => {
    renderPage();
    await waitFor(() => expect(screen.getByText('Arbaz')).toBeTruthy());
    expect(screen.getByText('Loyalty: 0 pts')).toBeTruthy();
  });
});
