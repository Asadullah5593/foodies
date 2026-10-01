import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Routes, Route, useLocation } from 'react-router-dom';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { formatDay } from '../../utils/dateDisplay';

/**
 * Clicking a customer in the table opens this page: who they are — with the
 * phone and registration date staff come here to read off given prominence —
 * the points they hold, and where and how often they order: one line per
 * brand + branch ("12 completed at Fireaway · Pine Avenue"), each number
 * opening exactly those orders in the Orders module.
 *
 * Two things the client asked to have taken OFF this page are pinned too: the
 * email card, and the coloured two-letter brand marks.
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

const daysAgoIso = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const LAST = daysAgoIso(69);
const FIRST = daysAgoIso(140);
const REGISTERED = daysAgoIso(211);

const summary = {
  id: 412,
  name: 'Abdullah Arshad',
  phone: '03240201350',
  email: 'abd@mail.com',
  source: 'consumer_app',
  createdAt: REGISTERED,
  loyaltyWallets: [
    { wallet_type: 'pos', brand_id: 21, brand_name: 'Fireaway', balance: 4369 },
    { wallet_type: 'pos', brand_id: 23, brand_name: 'Peperi Co', balance: 949 },
    { wallet_type: 'app', brand_id: null, brand_name: null, balance: 709 },
  ],
  brands: [{ id: 21, name: 'Fireaway' }],
  branches: [{ id: 10, name: 'Pine Avenue' }],
  orderStats: {
    completed_count: 19,
    cancelled_count: 2,
    spent: 39530,
    last_order_at: LAST,
    first_order_at: FIRST,
  },
  breakdown: [
    { brand_id: 21, brand_name: 'Fireaway', branch_id: 10, branch_name: 'Pine Avenue', completed_count: 12, cancelled_count: 1, spent: 26400, last_order_at: LAST },
    { brand_id: 21, brand_name: 'Fireaway', branch_id: 12, branch_name: 'DHA', completed_count: 5, cancelled_count: 0, spent: 9150, last_order_at: daysAgoIso(80) },
    { brand_id: 30, brand_name: 'Loranzo', branch_id: 14, branch_name: 'Johar Town', completed_count: 2, cancelled_count: 1, spent: 3980, last_order_at: daysAgoIso(120) },
  ],
  by_order_type: [
    { order_type: 'delivery', completed_count: 15, cancelled_count: 2, spent: 31000, last_order_at: null },
    { order_type: 'dine_in', completed_count: 4, cancelled_count: 0, spent: 8530, last_order_at: null },
  ],
  by_source: [
    { source: 'call_centre', completed_count: 15, cancelled_count: 2, spent: 31000, last_order_at: null },
    { source: 'pos', completed_count: 4, cancelled_count: 0, spent: 8530, last_order_at: null },
  ],
};

const getCustomerSummary = vi.fn();
vi.mock('../../services/api', () => ({
  adminService: {
    getCustomerSummary: (id: number) => getCustomerSummary(id),
    getCustomerVouchers: () => Promise.resolve({ vouchers: [] }),
    updateCustomer: vi.fn().mockResolvedValue({}),
    createCustomer: vi.fn().mockResolvedValue({}),
  },
}));

import CustomerDetail from './CustomerDetail';
import { ThemeProvider } from '../../contexts/ThemeContext';

const Where: React.FC = () => {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname + loc.search}</div>;
};

const renderAt = (url = '/admin/customers/412') =>
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <MemoryRouter initialEntries={[url]}>
          <Routes>
            <Route path="/admin/customers/:id" element={<CustomerDetail />} />
            <Route path="/admin/customers" element={<Where />} />
            <Route path="/admin/orders" element={<Where />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </ThemeProvider>,
  );

const loaded = () => screen.findByRole('heading', { name: 'Abdullah Arshad' });
const breakdownRows = async () => {
  const table = await screen.findByTestId('customer-breakdown');
  return within(table).getAllByRole('row').slice(1);
};
const params = (href: string | null) => new URL(href ?? '', 'http://x').searchParams;
const kpi = (label: string) => screen.getByTestId(`kpi-${label}`).textContent ?? '';

beforeEach(() => {
  canOpenOrders = true;
  permissions = ['customers:view'];
  getCustomerSummary.mockReset();
  getCustomerSummary.mockResolvedValue(summary);
});

describe('Customer profile — who they are', () => {
  it('asks for that customer and names them', async () => {
    renderAt();
    expect(await loaded()).toBeTruthy();
    expect(getCustomerSummary).toHaveBeenCalledWith(412);
  });

  it('gives the phone and the registration date a block each, in large type', async () => {
    renderAt();
    await loaded();
    const block = (id: string) => screen.getByTestId(id);
    const value = (id: string) => block(id).querySelector('dd') as HTMLElement;

    expect(within(block('contact-phone')).getByText('Phone')).toBeTruthy();
    expect(value('contact-phone').textContent).toBe('0324 0201350');
    expect(within(block('contact-registered')).getByText('Registered')).toBeTruthy();
    expect(value('contact-registered').textContent).toBe(formatDay(REGISTERED));

    // Prominent: bigger and heavier than the page's body text, not small print.
    for (const id of ['contact-phone', 'contact-registered']) {
      expect(value(id).className).toContain('text-[18px]');
      expect(value(id).className).toContain('font-extrabold');
    }
  });

  it('has no email card — with or without an email on record', async () => {
    for (const email of ['abd@mail.com', null]) {
      getCustomerSummary.mockResolvedValue({ ...summary, email });
      const { container, unmount } = renderAt();
      await loaded();
      expect(screen.queryByTestId('contact-email')).toBeNull();
      expect(screen.queryByText('Email')).toBeNull();
      expect(screen.queryByText('Not provided')).toBeNull();
      expect(container.textContent).not.toContain('abd@mail.com');
      // Exactly the two contact blocks that remain.
      expect(container.querySelectorAll('dl > div')).toHaveLength(2);
      unmount();
    }
  });

  it('says how long ago they registered, and through which channel', async () => {
    renderAt();
    await loaded();
    expect(screen.getByTestId('contact-registered').textContent).toContain('211 days ago · via Mobile app');
  });

  it('shows where they registered and where they stand', async () => {
    renderAt();
    await loaded();
    expect(screen.getByTestId('source-pill').textContent).toBe('Mobile app');
    expect(screen.getByTestId('status-pill').textContent).toBe('Lapsed · 69 days since last order');
  });

  it('words the status by how recent the last completed order is', async () => {
    const pill = async (lastOrderAt: string | null) => {
      getCustomerSummary.mockResolvedValue({ ...summary, orderStats: { ...summary.orderStats, last_order_at: lastOrderAt } });
      const { unmount } = renderAt();
      await loaded();
      const text = screen.getByTestId('status-pill').textContent;
      unmount();
      return text;
    };
    expect(await pill(daysAgoIso(3))).toBe('Active · last order 3 days ago');
    expect(await pill(daysAgoIso(45))).toBe('Lapsing · 45 days since last order');
    expect(await pill(daysAgoIso(61))).toBe('Lapsed · 61 days since last order');
    expect(await pill(null)).toBe('Never ordered');
  });

  it('shows the headline figures', async () => {
    renderAt();
    await loaded();
    expect(kpi('Completed orders')).toBe('Completed orders19of 21 finished orders');
    expect(kpi('Cancelled orders')).toBe('Cancelled orders210% of finished orders');
    expect(kpi('Spent')).toBe('SpentRs. 39,530.00Completed orders only');
    expect(kpi('Last order')).toBe(`Last order${formatDay(LAST)}69 days ago`);
    expect(kpi('First order')).toBe(`First order${formatDay(FIRST)}140 days ago`);
  });

  it('words the figures for a customer with nothing cancelled', async () => {
    getCustomerSummary.mockResolvedValue({ ...summary, orderStats: { ...summary.orderStats, cancelled_count: 0 } });
    renderAt();
    await loaded();
    expect(kpi('Completed orders')).toBe('Completed orders19finished orders');
    expect(kpi('Cancelled orders')).toBe('Cancelled orders0none cancelled');
  });
});

describe('Customer profile — loyalty points', () => {
  it('shows the total, and every wallet with its kind', async () => {
    const { container } = renderAt();
    await loaded();
    expect(screen.getByTestId('points-total').textContent).toBe('6,027 pts total');
    const rows = Array.from(container.querySelectorAll<HTMLElement>('[data-wallet-type]'));
    expect(rows.map((r) => r.textContent)).toEqual(['POSFireaway4,369', 'POSPeperi Co949', 'APPAll brands709']);
  });

  it('explains what each kind can be spent on', async () => {
    renderAt();
    await loaded();
    expect(screen.getByText(/POS points belong to one brand .* App points are one shared balance/)).toBeTruthy();
  });

  it('says so for a customer with no points', async () => {
    getCustomerSummary.mockResolvedValue({ ...summary, loyaltyWallets: [] });
    renderAt();
    await loaded();
    expect(screen.getByTestId('points-total').textContent).toBe('0 pts total');
    expect(screen.getByText('No loyalty points yet.')).toBeTruthy();
  });
});

describe('Customer profile — where they order', () => {
  it('has one line per brand and branch', async () => {
    renderAt();
    const rows = await breakdownRows();
    expect(rows).toHaveLength(3);
    const line = (r: HTMLElement) => within(r).getAllByRole('cell').map((c) => c.textContent);
    expect(line(rows[0]).slice(0, 6)).toEqual(['Fireaway', 'Pine Avenue', '12', '1', 'Rs. 26,400.00', formatDay(LAST)]);
    expect(line(rows[1]).slice(0, 5)).toEqual(['Fireaway', 'DHA', '5', '0', 'Rs. 9,150.00']);
    expect(line(rows[2]).slice(0, 5)).toEqual(['Loranzo', 'Johar Town', '2', '1', 'Rs. 3,980.00']);
  });

  it('names each brand in plain text, with no coloured two-letter mark beside it', async () => {
    const { container } = renderAt();
    const rows = await breakdownRows();
    // The brand cell is the name and nothing else — no "FI", "PC", "LO".
    expect(rows.map((r) => within(r).getAllByRole('cell')[0].textContent)).toEqual(['Fireaway', 'Fireaway', 'Loranzo']);
    expect(container.querySelector('[data-brand-mark]')).toBeNull();
  });

  it('opens exactly those orders from a count', async () => {
    renderAt();
    const [pine] = await breakdownRows();
    const completed = params(within(pine).getByRole('link', { name: '12' }).getAttribute('href'));
    expect(completed.get('customer_id')).toBe('412');
    expect(completed.get('brand_id')).toBe('21');
    expect(completed.get('branch_id')).toBe('10');
    expect(completed.get('status')).toBe('completed');
    // The whole history of that slice, not just today's.
    expect(completed.has('date_from')).toBe(false);

    const cancelled = params(within(pine).getByRole('link', { name: '1' }).getAttribute('href'));
    expect(cancelled.get('status')).toBe('cancelled');
    expect(cancelled.get('branch_id')).toBe('10');
  });

  it('"View all" opens that brand and branch in every status', async () => {
    renderAt();
    const dha = (await breakdownRows())[1];
    const all = params(within(dha).getByRole('link', { name: 'View all' }).getAttribute('href'));
    expect(all.get('customer_id')).toBe('412');
    expect(all.get('brand_id')).toBe('21');
    expect(all.get('branch_id')).toBe('12');
    expect(all.has('status')).toBe(false);
  });

  it('does not link a zero', async () => {
    renderAt();
    const dha = (await breakdownRows())[1];
    expect(within(dha).queryByRole('link', { name: '0' })).toBeNull();
  });

  it('breaks the same orders down by type and by channel', async () => {
    renderAt();
    await breakdownRows();
    const section = (title: string) => screen.getByRole('heading', { name: title }).parentElement as HTMLElement;
    const lines = (title: string) =>
      within(section(title)).getAllByRole('row').slice(1).map((r) => within(r).getAllByRole('cell').map((c) => c.textContent));
    expect(lines('By order type')).toEqual([
      ['Delivery', '15', '2', 'Rs. 31,000.00'],
      ['Dine in', '4', '0', 'Rs. 8,530.00'],
    ]);
    expect(lines('By channel')).toEqual([
      ['Call centre', '15', '2', 'Rs. 31,000.00'],
      ['POS', '4', '0', 'Rs. 8,530.00'],
    ]);
  });

  it('says so plainly for a customer with no finished orders', async () => {
    getCustomerSummary.mockResolvedValue({
      ...summary,
      orderStats: { completed_count: 0, cancelled_count: 0, spent: 0, last_order_at: null, first_order_at: null },
      breakdown: [], by_order_type: [], by_source: [],
    });
    renderAt();
    await loaded();
    expect(screen.queryByTestId('customer-breakdown')).toBeNull();
    expect(screen.getAllByText('No finished orders yet.').length).toBe(3);
    expect(kpi('Last order')).toBe('Last orderNeverno completed order yet');
    expect(screen.getByTestId('status-pill').textContent).toBe('Never ordered');
  });
});

describe('Customer profile — what the account may do', () => {
  it('offers Orders, Vouchers and Edit, opening what they open in the table', async () => {
    permissions = ['customers:view', 'customers:edit'];
    renderAt();
    await loaded();
    const orders = screen.getByRole('link', { name: 'Orders' });
    expect(params(orders.getAttribute('href')).get('customer_id')).toBe('412');
    expect(params(orders.getAttribute('href')).has('brand_id')).toBe(false);

    fireEvent.click(screen.getByRole('button', { name: 'Vouchers' }));
    expect(await screen.findByText('Vouchers — Abdullah Arshad')).toBeTruthy();
    fireEvent.keyDown(window, { key: 'Escape' });

    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(await screen.findByText('Edit customer')).toBeTruthy();
    expect((screen.getByLabelText('Name *') as HTMLInputElement).value).toBe('Abdullah Arshad');
  });

  it('links back to the full list', async () => {
    renderAt();
    await loaded();
    expect(screen.getByRole('link', { name: 'All customers' }).getAttribute('href')).toBe('/admin/customers');
  });

  it('shows counts as plain numbers to someone who cannot open Orders', async () => {
    canOpenOrders = false;
    renderAt();
    const [pine] = await breakdownRows();
    expect(within(pine).queryByRole('link')).toBeNull();
    expect(within(pine).getAllByRole('cell')[2].textContent).toBe('12');
    expect(screen.queryByRole('link', { name: 'Orders' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();
  });

  it('shows no money to an account that may not see totals', async () => {
    permissions = ['customers:view', 'orders:view:no-totals'];
    getCustomerSummary.mockResolvedValue({
      ...summary,
      orderStats: { ...summary.orderStats, spent: null },
      breakdown: summary.breakdown.map((l) => ({ ...l, spent: null })),
      by_order_type: summary.by_order_type.map((l) => ({ ...l, spent: null })),
      by_source: summary.by_source.map((l) => ({ ...l, spent: null })),
    });
    const { container } = renderAt();
    await breakdownRows();
    expect(screen.queryByText('Spent')).toBeNull();
    expect(screen.queryByTestId('kpi-Spent')).toBeNull();
    expect(container.textContent).not.toContain('Rs.');
    // Counts are not money and stay.
    expect(kpi('Completed orders')).toContain('19');
  });
});

describe('Customer profile — a customer that is not there', () => {
  it('says not found, with the way back, when the server refuses', async () => {
    getCustomerSummary.mockRejectedValue({ response: { status: 404 } });
    renderAt('/admin/customers/999');
    expect(await screen.findByText('Customer not found.')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'All customers' }).getAttribute('href')).toBe('/admin/customers');
  });

  it('never asks the server about an id that is not a number', async () => {
    renderAt('/admin/customers/abc');
    expect(await screen.findByText('Customer not found.')).toBeTruthy();
    expect(getCustomerSummary).not.toHaveBeenCalled();
  });
});
