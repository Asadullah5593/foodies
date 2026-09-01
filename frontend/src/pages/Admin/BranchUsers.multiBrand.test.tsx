import React from 'react';
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ThemeProvider } from '../../contexts/ThemeContext';

const assignBranchUsersWithRoles = vi.fn();
const getBranchUsers = vi.fn();
vi.mock('../../services/api/adminService', () => ({
  adminService: {
    getBranchUsers: () => getBranchUsers(),
    assignBranchUsersWithRoles: (...a: unknown[]) => assignBranchUsersWithRoles(...a),
    removeBranchUser: vi.fn(),
    bulkAssignUserToBranches: vi.fn(),
  },
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { tenant_id: 1, permissions: ['branch-users:assign', 'branch-users:remove'] },
  }),
}));

const USERS = [{ id: 1, name: 'Ali', email: 'ali@demo.com', phone: null }];
const ROLES = [{ id: 3, name: 'Cashier', slug: 'cashier' }];
const BRANDS = [
  { id: 21, name: 'Peperi Co', is_active: true },
  { id: 22, name: 'Fireaway', is_active: true },
  { id: 23, name: 'Loranzo', is_active: true },
];
// A food-court branch carrying three brands — the case that has no answer today.
const BRANCHES = [
  { id: 10, name: 'Johar Town', code: 'BR-23', brand_ids: [21, 22, 23], is_active: true },
];

vi.mock('../../utils/apiClient', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (url.startsWith('/admin/users')) return { data: USERS };
      if (url.startsWith('/admin/roles')) return { data: ROLES };
      if (url.startsWith('/admin/branches')) return { data: BRANCHES };
      if (url.startsWith('/admin/brands')) return { data: BRANDS };
      return { data: [] };
    }),
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../utils/sweetAlert', () => ({ confirmDialog: vi.fn() }));

import BranchUsers from './BranchUsers';

beforeEach(() => {
  vi.clearAllMocks();
  getBranchUsers.mockResolvedValue([]);
  assignBranchUsersWithRoles.mockResolvedValue([]);
});

const renderPage = () => {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <ThemeProvider>
      <QueryClientProvider client={qc}>
        <BranchUsers />
      </QueryClientProvider>
    </ThemeProvider>,
  );
};

const openModalAndPick = async () => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Assign Users/i }));
  fireEvent.click(await screen.findByRole('button', { name: /Select branch/i }));
  fireEvent.mouseDown(await screen.findByRole('option', { name: 'Johar Town (BR-23)' }));
  const row = (await screen.findByText('Ali')).closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByRole('checkbox'));
  return row;
};

const save = () => fireEvent.click(screen.getByRole('button', { name: /Assign \d+ user\(s\)/ }));
/** Open a row's brand dropdown; its panel is portalled outside the table. */
const openBrands = (row: HTMLElement) => {
  fireEvent.click(within(row).getByRole('button', { name: /^Brands for/ }));
  return screen.getByRole('listbox');
};
/**
 * Tick a brand. The panel deliberately stays open after a pick — that is what
 * makes choosing two of them one gesture — so reuse it when it is already up
 * rather than clicking the trigger shut again.
 */
const pick = (row: HTMLElement, name: RegExp) => {
  const panel = screen.queryByRole('listbox') ?? openBrands(row);
  fireEvent.click(within(panel).getByText(name));
};
const payload = () => assignBranchUsersWithRoles.mock.calls[0][1] as Array<Record<string, unknown>>;

describe('Branch Users — a user can hold more than one brand at a branch', () => {
  it('sends both brands, not just the last one clicked', async () => {
    const row = await openModalAndPick();
    pick(row, /Peperi Co/);
    pick(row, /Fireaway/);
    save();
    await waitFor(() => expect(assignBranchUsersWithRoles).toHaveBeenCalled());
    expect(payload()).toEqual([{ user_id: 1, role_id: 3, brand_ids: [21, 22] }]);
  });

  it('sends an empty list for all brands', async () => {
    await openModalAndPick();
    save();
    await waitFor(() => expect(assignBranchUsersWithRoles).toHaveBeenCalled());
    expect(payload()).toEqual([{ user_id: 1, role_id: 3, brand_ids: [] }]);
  });

  it('unticking the last brand goes back to all brands', async () => {
    const row = await openModalAndPick();
    pick(row, /Peperi Co/);
    pick(row, /Peperi Co/);
    save();
    await waitFor(() => expect(assignBranchUsersWithRoles).toHaveBeenCalled());
    expect(payload()).toEqual([{ user_id: 1, role_id: 3, brand_ids: [] }]);
  });

  it('offers only the brands the chosen branch actually carries', async () => {
    const panel = openBrands(await openModalAndPick());
    expect(within(panel).getByText(/Peperi Co/)).toBeTruthy();
    expect(within(panel).getByText(/Loranzo/)).toBeTruthy();
    expect(within(panel).queryByText(/Wok & Go/)).toBeNull();
  });

  it('prefills an existing two-brand lock and treats it as unchanged', async () => {
    getBranchUsers.mockResolvedValue([
      {
        id: 1,
        name: 'Ali',
        email: 'ali@demo.com',
        branch_id: 10,
        branch_name: 'Johar Town',
        role_id: 3,
        brand_id: 21,
        brand_ids: [21, 22],
        brand_names: ['Peperi Co', 'Fireaway'],
      },
    ]);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: /Assign Users/i }));
    fireEvent.click(await screen.findByRole('button', { name: /Select branch/i }));
    fireEvent.mouseDown(await screen.findByRole('option', { name: 'Johar Town (BR-23)' }));
    // Ali appears twice now — on the page's assignment card and in the modal
    // table; only the latter sits in a row.
    const row = (await screen.findAllByText('Ali'))
      .map((el) => el.closest('tr'))
      .find(Boolean) as HTMLElement;
    // The trigger summarises both without being opened…
    await waitFor(() =>
      expect(
        within(row).getByRole('button', { name: /^Brands for/ }).textContent,
      ).toContain('2 brands'),
    );
    const panel = openBrands(row);
    const selectedOf = (name: RegExp | string) =>
      within(panel).getByText(name).closest('[role="option"]')!.getAttribute('aria-selected');
    expect(selectedOf(/Peperi Co/)).toBe('true');
    expect(selectedOf(/Fireaway/)).toBe('true');
    expect(selectedOf('All brands')).toBe('false');
    fireEvent.keyDown(document, { key: 'Escape' });
    // …and re-saving an untouched row asks the API for nothing.
    expect(screen.queryByRole('button', { name: /Assign \d+ user\(s\)/ })).toBeNull();
  });

  it('lists every locked brand on the assignment card', async () => {
    getBranchUsers.mockResolvedValue([
      {
        id: 1,
        name: 'Ali',
        email: 'ali@demo.com',
        branch_id: 10,
        branch_name: 'Johar Town',
        role_id: 3,
        brand_id: 21,
        brand_ids: [21, 22],
        brand_names: ['Peperi Co', 'Fireaway'],
      },
    ]);
    renderPage();
    expect(await screen.findByText(/Brands: Peperi Co, Fireaway \(locked\)/)).toBeTruthy();
  });
});
