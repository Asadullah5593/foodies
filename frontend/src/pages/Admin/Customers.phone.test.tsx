import React from 'react';
import { render, screen, fireEvent, within, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * On a phone the Customers table becomes a list of cards. Each card carries every
 * fact a table row has, the sort moves into the Filters sheet (there is no header
 * to click), and tapping a card still opens the profile.
 */

let permissions: string[] = [];
vi.mock('../../hooks/useHasPermission', () => ({
  useHasPermission: (need: string | string[]) => {
    const list = Array.isArray(need) ? need : [need];
    return list.some((p) => permissions.includes(p));
  },
  useHasRestriction: (need: string) => permissions.includes(need),
}));
vi.mock('../../hooks/useSensitivePageView', () => ({ useSensitivePageView: () => undefined }));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { is_super_admin: false, permissions } }),
}));
vi.mock('../../lib/pathPermissions', () => ({
  PATH_PERMISSIONS: {},
  canAccessPath: (_u: unknown, path: string) => path === '/admin/orders',
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('qrcode.react', () => ({ QRCodeSVG: () => null }));

const recently = new Date(Date.now() - 3 * 86_400_000).toISOString();
const longAgo = new Date(Date.now() - 200 * 86_400_000).toISOString();

const customers = [
  {
    id: 412,
    name: 'Abdullah Arshad',
    phone: '03240201350',
    source: 'consumer_app',
    createdAt: '2026-06-12T09:00:00',
    loyaltyWallets: [{ wallet_type: 'pos', brand_id: 21, brand_name: 'Fireaway', balance: 4369 }],
    brands: [{ id: 21, name: 'Fireaway' }, { id: 23, name: 'Peperi Co' }],
    branches: [{ id: 10, name: 'Pine Avenue' }],
    orderStats: { completed_count: 14, cancelled_count: 2, spent: 31240, last_order_at: recently },
  },
  {
    id: 7,
    name: 'Arbaz',
    phone: '03124551339',
    source: 'pos',
    createdAt: '2026-09-22T09:00:00',
    loyaltyWallets: [],
    brands: [],
    branches: [],
    orderStats: { completed_count: 0, cancelled_count: 0, spent: 0, last_order_at: null },
  },
  {
    id: 9,
    name: 'Zainab',
    phone: '03001112223',
    source: 'pos',
    createdAt: '2026-03-02T09:00:00',
    loyaltyWallets: [{ wallet_type: 'app', brand_id: null, brand_name: null, balance: 800 }],
    brands: [{ id: 23, name: 'Peperi Co' }],
    branches: [{ id: 12, name: 'DHA' }],
    orderStats: { completed_count: 40, cancelled_count: 0, spent: 96000, last_order_at: longAgo },
  },
];

vi.mock('../../services/api', () => ({
  adminService: {
    getCustomers: () => Promise.resolve(customers),
    getCustomerVouchers: () => Promise.resolve({ vouchers: [] }),
    deleteCustomer: vi.fn().mockResolvedValue(undefined),
    updateCustomer: vi.fn().mockResolvedValue({}),
    createCustomer: vi.fn().mockResolvedValue({}),
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
            <Route path="/admin/customers/:id" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });
const card = async (id: number) => screen.findByTestId(`customer-card-${id}`);
const cardIds = () => screen.getAllByTestId(/^customer-card-/).map((c) => Number(c.dataset.testid!.replace('customer-card-', '')));
const openFilters = () => fireEvent.click(screen.getByRole('button', { name: /^Filters/ }));

beforeEach(() => {
  permissions = ['customers:view'];
  setWidth(390);
});
afterEach(() => setWidth(1024));

describe('Customers on a phone', () => {
  it('shows one card per customer with every fact the table row has, and no table', async () => {
    renderPage();
    const c = await card(412);
    expect(screen.queryByRole('table')).toBeNull();
    const text = c.textContent ?? '';
    expect(text).toContain('Abdullah Arshad');
    expect(text).toContain('03240201350');
    expect(text).toContain('Mobile app');
    expect(within(c).getByText('Completed').nextElementSibling).toHaveTextContent('14');
    expect(within(c).getByText('Cancelled').nextElementSibling).toHaveTextContent('2');
    expect(within(c).getByText('Spent').nextElementSibling).toHaveTextContent('31,240');
    expect(text).toMatch(/3 days ago/);
    expect(text).toContain('Fireaway');
    expect(text).toContain('+1 more');
    expect(text).toContain('Pine Avenue');
    expect(within(c).getByRole('button', { name: 'Actions for Abdullah Arshad' })).toBeInTheDocument();
    // a customer who never ordered
    expect((await card(7)).textContent).toContain('Never');
  });

  it('leaves out the Spent figure for an account that may not see totals', async () => {
    permissions = ['customers:view', 'orders:view:no-totals'];
    renderPage();
    const c = await card(412);
    expect(within(c).queryByText('Spent')).toBeNull();
    expect(within(c).getByText('Completed')).toBeInTheDocument();
  });

  it('sorts from the Filters sheet, flips the direction, and the chip removes the sort', async () => {
    renderPage();
    await card(412);
    expect(cardIds()).toEqual([412, 7, 9]);
    openFilters();
    const sort = screen.getByRole('combobox', { name: 'Sort by' });
    fireEvent.change(sort, { target: { value: 'completed' } });
    await waitFor(() => expect(cardIds()).toEqual([9, 412, 7]));
    fireEvent.click(screen.getByRole('button', { name: '↓ Descending' }));
    await waitFor(() => expect(cardIds()).toEqual([7, 412, 9]));
    fireEvent.keyDown(window, { key: 'Escape' });
    const chip = await screen.findByRole('button', { name: 'Remove filter: Sorted by completed ↑' });
    fireEvent.click(chip);
    await waitFor(() => expect(cardIds()).toEqual([412, 7, 9]));
  });

  it('opens the profile when a card is tapped, but not from the Actions menu', async () => {
    renderPage();
    const c = await card(412);
    fireEvent.click(within(c).getByRole('button', { name: 'Actions for Abdullah Arshad' }));
    expect(screen.queryByTestId('where')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });
    fireEvent.click(c);
    expect(await screen.findByTestId('where')).toHaveTextContent('/admin/customers/412');
  });
});
