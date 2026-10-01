import React from 'react';
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The Customers module is a table: one customer per row, with their order
 * figures in columns, filters above, and sortable headers.
 *
 * - Clicking a row (or the customer's name, which is a real link) opens that
 *   customer's profile.
 * - Everything that can be done to a customer — Orders, Vouchers, Edit,
 *   Delete — lives in ONE "Actions" menu. There is no loose Orders button.
 * - Points show a total AND its split into POS and APP: a customer who
 *   registered in the mobile app can hold POS points only.
 * - Where a cell holds more than it shows ("+1 more"), a dotted underline says
 *   so, and hovering it lists everything.
 * - An account that may not see money totals gets no Spent column or filter.
 */

let canOpenOrders = true;
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
  canAccessPath: (_u: unknown, path: string) => path === '/admin/orders' && canOpenOrders,
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
    email: 'abd@mail.com',
    source: 'consumer_app',
    createdAt: '2026-06-12T09:00:00',
    loyaltyWallets: [
      { wallet_type: 'pos', brand_id: 21, brand_name: 'Fireaway', balance: 4369 },
      { wallet_type: 'pos', brand_id: 23, brand_name: 'Peperi Co', balance: 949 },
    ],
    brands: [{ id: 21, name: 'Fireaway' }, { id: 23, name: 'Peperi Co' }],
    branches: [{ id: 10, name: 'Pine Avenue' }, { id: 12, name: 'DHA' }],
    orderStats: { completed_count: 14, cancelled_count: 2, spent: 31240, last_order_at: recently },
  },
  {
    id: 7,
    name: 'Arbaz',
    phone: '03124551339',
    source: 'consumer_app',
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

const deleteCustomer = vi.fn().mockResolvedValue(undefined);
vi.mock('../../services/api', () => ({
  adminService: {
    getCustomers: () => Promise.resolve(customers),
    getCustomerVouchers: () => Promise.resolve({ vouchers: [] }),
    deleteCustomer: (id: number) => deleteCustomer(id),
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

const renderPage = (url = '/admin/customers') =>
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/admin/customers" element={<Customers />} />
            <Route path="/admin/customers/:id" element={<Where />} />
            <Route path="/admin/orders" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );

const row = async (id: number) => screen.findByTestId(`customer-row-${id}`);
const rowIds = () =>
  screen.getAllByTestId(/^customer-row-/).map((r) => Number(r.dataset.testid!.replace('customer-row-', '')));
const headers = () => screen.getAllByRole('columnheader').map((h) => h.textContent?.trim());
const cellsOf = (r: HTMLElement) => within(r).getAllByRole('cell');
const openMoreFilters = () => fireEvent.click(screen.getByRole('button', { name: /More filters/ }));
const actionsButton = (r: HTMLElement) => within(r).getByRole('button', { name: 'Actions for Abdullah Arshad' });

beforeEach(() => {
  canOpenOrders = true;
  permissions = ['customers:view'];
  deleteCustomer.mockClear();
});

describe('Customers table — what a row shows', () => {
  it('keeps every column, in this order', async () => {
    renderPage();
    await row(412);
    expect(headers()).toEqual([
      'Customer', 'Phone', 'Source', 'Points',
      'Completed', 'Cancelled', 'Spent', 'Last order', 'Brands', 'Branches', 'Actions',
    ]);
    expect(rowIds()).toEqual([412, 7, 9]);
  });

  it('shows who they are and where they registered', async () => {
    renderPage();
    const cells = cellsOf(await row(412));
    expect(within(cells[0]).getByRole('link', { name: 'Abdullah Arshad' })).toBeTruthy();
    expect(cells[1].textContent).toBe('03240201350');
    expect(cells[2].textContent).toBe('Mobile app');
  });

  it('shows completed and cancelled separately, and spend with grouped thousands', async () => {
    renderPage();
    const cells = cellsOf(await row(412)).map((c) => c.textContent);
    expect(cells[4]).toBe('14');
    expect(cells[5]).toBe('2');
    expect(cells[6]).toBe('Rs. 31,240.00');
  });

  it('shows the last order as a date and how long ago it was', async () => {
    renderPage();
    const cells = cellsOf(await row(412));
    expect(cells[7].textContent).toContain('3 days ago');
    expect(cells[7].textContent).toMatch(/^\d{2} [A-Z][a-z]{2} \d{4}/);
  });

  it('shows an app-registered customer’s POS points as POS points', async () => {
    renderPage();
    const r = await row(412);
    const points = cellsOf(r)[3];
    expect(points.textContent).toContain('5,318 pts');
    expect(Array.from(points.querySelectorAll('[data-wallet-tag]')).map((t) => t.textContent)).toEqual(['POS']);
    // …while a counter-registered customer can hold app points.
    const zainab = cellsOf(await row(9))[3];
    expect(zainab.textContent).toBe('800 ptsAPPAll brands');
  });

  it('says "Never", with dashes, for a customer who has not ordered', async () => {
    renderPage();
    const cells = cellsOf(await row(7)).map((c) => c.textContent);
    expect(cells[3]).toBe('—'); // points
    expect(cells[4]).toBe('0');
    expect(cells[5]).toBe('0');
    expect(cells[6]).toBe('—'); // spent
    expect(cells[7]).toBe('Never');
    expect(cells[8]).toBe('—'); // brands
    expect(cells[9]).toBe('—'); // branches
  });
});

describe('Customers table — cells that hold more than they show', () => {
  it('shows the first brand and a "+N more" the user can tell is hoverable', async () => {
    renderPage();
    const cells = cellsOf(await row(412));
    // The name alone: no coloured two-letter mark ("FI", "PC") in front of it.
    expect(cells[8].textContent).toBe('Fireaway+1 more');
    const more = within(cells[8]).getByRole('button', { name: 'Show all 2 brands' });
    expect(more.textContent).toBe('+1 more');
    expect(more.className).toContain('decoration-dotted');
    expect(more.className).toContain('cursor-help');
    // Not tucked into a native tooltip, which is what nobody found before.
    expect(cells[8].querySelector('[title]')).toBeNull();
  });

  it('lists every brand on hover', async () => {
    renderPage();
    const more = within(cellsOf(await row(412))[8]).getByRole('button', { name: 'Show all 2 brands' });
    expect(screen.queryByRole('tooltip')).toBeNull();
    fireEvent.mouseEnter(more);
    const tip = screen.getByRole('tooltip');
    expect(tip.textContent).toContain('Brands (2)');
    expect(Array.from(tip.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['Fireaway', 'Peperi Co']);
    fireEvent.mouseLeave(more);
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('does the same for branches', async () => {
    renderPage();
    const cells = cellsOf(await row(412));
    expect(within(cells[9]).getByText('Pine Avenue')).toBeTruthy();
    const more = within(cells[9]).getByRole('button', { name: 'Show all 2 branches' });
    fireEvent.mouseEnter(more);
    expect(Array.from(screen.getByRole('tooltip').querySelectorAll('li')).map((li) => li.textContent)).toEqual([
      'Pine Avenue', 'DHA',
    ]);
  });

  it('adds no "+N more" when there is only one', async () => {
    renderPage();
    const cells = cellsOf(await row(9));
    expect(within(cells[8]).queryByRole('button')).toBeNull();
    expect(within(cells[9]).queryByRole('button')).toBeNull();
    expect(cells[8].textContent).toBe('Peperi Co');
    expect(cells[9].textContent).toBe('DHA');
  });

  it('draws no brand marks anywhere on the page, hover lists included', async () => {
    const { container } = renderPage();
    fireEvent.mouseEnter(within(cellsOf(await row(412))[8]).getByRole('button', { name: 'Show all 2 brands' }));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(document.querySelector('[data-brand-mark]')).toBeNull();
    expect(container.querySelector('[data-brand-mark]')).toBeNull();
  });

  it('tells the user, above the table, what the dotted underline means', async () => {
    renderPage();
    await row(412);
    expect(screen.getByTestId('hover-hint').textContent).toBe(
      'Dotted underline = hover to see every brand, branch or point balance',
    );
  });

  it('opening a "+N more" list never opens the profile', async () => {
    renderPage();
    fireEvent.click(within(cellsOf(await row(412))[8]).getByRole('button', { name: 'Show all 2 brands' }));
    expect(screen.getByRole('tooltip')).toBeTruthy();
    expect(screen.queryByTestId('where')).toBeNull();
  });
});

describe('Customers table — opening things', () => {
  it('opens the profile when a row is clicked', async () => {
    renderPage();
    fireEvent.click(cellsOf(await row(412))[1]); // the phone cell
    expect((await screen.findByTestId('where')).textContent).toBe('/admin/customers/412');
  });

  it('makes the name a real link to the profile, for keyboard and new-tab use', async () => {
    renderPage();
    const link = within(await row(412)).getByRole('link', { name: 'Abdullah Arshad' });
    expect(link.getAttribute('href')).toBe('/admin/customers/412');
    fireEvent.click(link);
    expect((await screen.findByTestId('where')).textContent).toBe('/admin/customers/412');
  });

  it('has no Orders button beside Actions — only the one Actions button', async () => {
    permissions = ['customers:view', 'customers:edit', 'customers:delete'];
    renderPage();
    const r = await row(412);
    expect(within(r).queryByRole('button', { name: 'Orders' })).toBeNull();
    expect(within(r).queryByRole('button', { name: 'Vouchers' })).toBeNull();
    expect(within(r).queryByRole('button', { name: 'Edit' })).toBeNull();
    const actionsCell = cellsOf(r)[10];
    expect(within(actionsCell).getAllByRole('button')).toHaveLength(1);
    expect(actionsCell.textContent).toBe('Actions');
  });

  it('keeps Orders, Vouchers, Edit and Delete inside the Actions menu', async () => {
    permissions = ['customers:view', 'customers:edit', 'customers:delete'];
    renderPage();
    fireEvent.click(actionsButton(await row(412)));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Orders', 'Vouchers', 'Edit', 'Delete']);
  });

  it('opens that customer’s order history from the menu', async () => {
    renderPage();
    fireEvent.click(actionsButton(await row(412)));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Orders' }));
    const url = new URL((await screen.findByTestId('where')).textContent ?? '', 'http://x');
    expect(url.pathname).toBe('/admin/orders');
    expect(url.searchParams.get('customer_id')).toBe('412');
    expect(url.searchParams.get('customer_label')).toBe('Abdullah Arshad (03240201350)');
    // No dates: the history is not cut down to today.
    expect(url.searchParams.has('date_from')).toBe(false);
  });

  it('offers only the actions the account may take', async () => {
    canOpenOrders = false;
    renderPage();
    fireEvent.click(actionsButton(await row(412)));
    expect(screen.getAllByRole('menuitem').map((i) => i.textContent)).toEqual(['Vouchers']);
  });

  it('opens Vouchers and Edit exactly as before — without leaving the page', async () => {
    permissions = ['customers:view', 'customers:edit', 'customers:delete'];
    renderPage();
    const open = async (item: string) => {
      fireEvent.click(actionsButton(await row(412)));
      fireEvent.click(screen.getByRole('menuitem', { name: item }));
    };

    await open('Vouchers');
    expect(await screen.findByText('Vouchers — Abdullah Arshad')).toBeTruthy();
    expect(screen.queryByTestId('where')).toBeNull();
    fireEvent.keyDown(window, { key: 'Escape' });

    await open('Edit');
    expect(await screen.findByText('Edit customer')).toBeTruthy();
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Abdullah Arshad');
    expect((screen.getByLabelText(/^Phone \*/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByTestId('where')).toBeNull();
  });

  it('asks before deleting, and deletes that customer', async () => {
    permissions = ['customers:view', 'customers:delete'];
    renderPage();
    fireEvent.click(actionsButton(await row(412)));
    fireEvent.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(await screen.findByText('Delete customer')).toBeTruthy();
    expect(deleteCustomer).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    await waitFor(() => expect(deleteCustomer).toHaveBeenCalledWith(412));
  });
});

describe('Customers table — filters always on show', () => {
  it('offers every source, each with its head count', async () => {
    renderPage();
    await row(412);
    const group = screen.getByRole('group', { name: 'Source' });
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'All (3)', 'POS (1)', 'Mobile app (2)', 'Website (0)', 'Kiosk (0)',
    ]);
    fireEvent.click(within(group).getByRole('button', { name: 'POS (1)' }));
    await waitFor(() => expect(rowIds()).toEqual([9]));
    expect(within(group).getByRole('button', { name: 'POS (1)' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: 'All (3)' }));
    await waitFor(() => expect(rowIds()).toEqual([412, 7, 9]));
  });

  it('filters by brand and by branch', async () => {
    renderPage();
    await row(412);
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: '12' } });
    await waitFor(() => expect(rowIds()).toEqual([412, 9]));
    fireEvent.change(screen.getByLabelText('Brand'), { target: { value: '21' } });
    await waitFor(() => expect(rowIds()).toEqual([412]));
  });

  it('says how far the filters narrowed the list', async () => {
    renderPage();
    await row(412);
    expect(screen.getByTestId('customer-count').textContent).toBe('3 customers');
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: '10' } });
    await waitFor(() => expect(screen.getByTestId('customer-count').textContent).toBe('1 of 3 customers'));
  });
});

describe('Customers table — quick picks', () => {
  it('offers All, Active, Lapsed, Never ordered and Has points, with counts', async () => {
    renderPage();
    await row(412);
    const group = screen.getByRole('group', { name: 'Quick filters' });
    expect(within(group).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'All (3)', 'Active · last 30 days (1)', 'Lapsed · 60+ days (1)', 'Never ordered (1)', 'Has points (2)',
    ]);
  });

  it('shows the customers a chip names, one chip at a time', async () => {
    renderPage();
    await row(412);
    const chip = (name: RegExp) => within(screen.getByRole('group', { name: 'Quick filters' })).getByRole('button', { name });
    fireEvent.click(chip(/^Lapsed/));
    await waitFor(() => expect(rowIds()).toEqual([9]));
    fireEvent.click(chip(/^Never ordered/));
    await waitFor(() => expect(rowIds()).toEqual([7]));
    fireEvent.click(chip(/^Has points/));
    await waitFor(() => expect(rowIds()).toEqual([412, 9]));
    expect(chip(/^Has points/).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(chip(/^All/));
    await waitFor(() => expect(rowIds()).toEqual([412, 7, 9]));
  });

  it('counts within the other filters', async () => {
    renderPage();
    await row(412);
    fireEvent.click(within(screen.getByRole('group', { name: 'Source' })).getByRole('button', { name: 'Mobile app (2)' }));
    await waitFor(() =>
      expect(
        within(screen.getByRole('group', { name: 'Quick filters' })).getAllByRole('button').map((b) => b.getAttribute('aria-label')),
      ).toEqual(['All (2)', 'Active · last 30 days (1)', 'Lapsed · 60+ days (0)', 'Never ordered (1)', 'Has points (1)']),
    );
  });
});

describe('Customers table — More filters', () => {
  it('keeps the rest out of the way until asked for', async () => {
    renderPage();
    await row(412);
    expect(screen.queryByLabelText('Points')).toBeNull();
    openMoreFilters();
    for (const label of ['Points', 'Min points', 'Last order', 'Completed orders', 'Min orders', 'Min spend (Rs.)', 'Registered from', 'Registered to'])
      expect(screen.getByLabelText(label)).toBeTruthy();
  });

  it('offers every option of the points, last-order and order-count filters', async () => {
    renderPage();
    await row(412);
    openMoreFilters();
    const options = (label: string) =>
      Array.from((screen.getByLabelText(label) as HTMLSelectElement).options).map((o) => o.textContent);
    expect(options('Points')).toEqual(['Any', 'Has points', 'Has POS points', 'Has app points', 'Has both', 'No points']);
    expect(options('Last order')).toEqual([
      'Any time', 'In the last 7 days', 'In the last 30 days', 'In the last 90 days',
      'Not for 30+ days', 'Not for 60+ days', 'Not for 90+ days', 'Never ordered',
    ]);
    expect(options('Completed orders')).toEqual(['Any', 'None', 'At least 1', 'Exactly one', 'Repeat (2 or more)']);
  });

  it('filters by points, last order and completed orders', async () => {
    renderPage();
    await row(412);
    openMoreFilters();
    fireEvent.change(screen.getByLabelText('Points'), { target: { value: 'pos' } });
    await waitFor(() => expect(rowIds()).toEqual([412]));
    fireEvent.change(screen.getByLabelText('Points'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Last order'), { target: { value: 'lapsed90' } });
    await waitFor(() => expect(rowIds()).toEqual([9]));
    fireEvent.change(screen.getByLabelText('Last order'), { target: { value: '' } });
    fireEvent.change(screen.getByLabelText('Completed orders'), { target: { value: 'none' } });
    await waitFor(() => expect(rowIds()).toEqual([7]));
  });

  it('opens by itself when the link carries one of its filters, so none applies out of sight', async () => {
    renderPage('/admin/customers?points=app&min_points=500');
    await row(9);
    expect(rowIds()).toEqual([9]);
    expect((screen.getByLabelText('Points') as HTMLSelectElement).value).toBe('app');
    expect((screen.getByLabelText('Min points') as HTMLInputElement).value).toBe('500');
  });

  it('shows on the button how many of its filters are set, even when closed', async () => {
    renderPage('/admin/customers?points=app&min_points=500');
    await row(9);
    expect(screen.getByTestId('more-filters-count').textContent).toBe('2');
    openMoreFilters(); // close it
    expect(screen.queryByLabelText('Points')).toBeNull();
    expect(screen.getByTestId('more-filters-count').textContent).toBe('2');
    expect(rowIds()).toEqual([9]);
  });

  it('says so when nothing matches, and Clear brings everyone back', async () => {
    renderPage('/admin/customers?min_spend=99999999');
    expect(await screen.findByText('No customers match these filters.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: /^Clear/ }));
    await row(412);
    expect(rowIds()).toEqual([412, 7, 9]);
    expect(screen.queryByRole('button', { name: /^Clear/ })).toBeNull();
    expect(screen.queryByTestId('more-filters-count')).toBeNull();
  });
});

describe('Customers table — sorting', () => {
  it('sorts by a column: first click, second click flips, third clears', async () => {
    renderPage();
    await row(412);
    const spent = screen.getByRole('button', { name: /Spent/ });
    fireEvent.click(spent);
    await waitFor(() => expect(rowIds()).toEqual([9, 412, 7]));
    fireEvent.click(spent);
    await waitFor(() => expect(rowIds()).toEqual([7, 412, 9]));
    fireEvent.click(spent);
    await waitFor(() => expect(rowIds()).toEqual([412, 7, 9]));
  });

  it('sorts by last order with never-ordered customers at the bottom', async () => {
    renderPage();
    await row(412);
    fireEvent.click(screen.getByRole('button', { name: /Last order/ }));
    await waitFor(() => expect(rowIds()).toEqual([412, 9, 7]));
  });

  it('marks the sorted column for screen readers', async () => {
    renderPage();
    await row(412);
    fireEvent.click(screen.getByRole('button', { name: /Completed/ }));
    await waitFor(() =>
      expect(screen.getByRole('columnheader', { name: /Completed/ }).getAttribute('aria-sort')).toBe('descending'),
    );
    expect(screen.getByRole('columnheader', { name: /Spent/ }).getAttribute('aria-sort')).toBe('none');
  });
});

describe('Customers table — an account that may not see money totals', () => {
  beforeEach(() => {
    permissions = ['customers:view', 'orders:view:no-totals'];
  });

  it('has no Spent column and no spend filter', async () => {
    renderPage();
    await row(412);
    expect(headers()).not.toContain('Spent');
    openMoreFilters();
    expect(screen.queryByLabelText('Min spend (Rs.)')).toBeNull();
    expect(screen.queryByText('Rs. 31,240.00')).toBeNull();
    // The counts are not money and stay.
    expect(headers()).toContain('Completed');
    expect(screen.getByLabelText('Min orders')).toBeTruthy();
  });
});
