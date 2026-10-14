import React from 'react';
import { render, screen, fireEvent, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ThemeProvider } from '../../contexts/ThemeContext';

/**
 * The Assign Users dialog on a phone lists one block per user — tick, name, then the role
 * below it at full width — instead of the table whose Role column sat past the screen edge.
 * Tablets and desktop keep the table.
 */

const getBranchUsers = vi.fn();
vi.mock('../../services/api/adminService', () => ({
  adminService: {
    getBranchUsers: () => getBranchUsers(),
    assignBranchUsersWithRoles: vi.fn().mockResolvedValue([]),
    removeBranchUser: vi.fn(),
    bulkAssignUserToBranches: vi.fn(),
  },
}));
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({ user: { tenant_id: 1, permissions: ['branch-users:assign', 'branch-users:remove'] } }),
}));
const USERS = [
  { id: 1, name: 'Ali', email: 'ali@demo.com', phone: null },
  { id: 2, name: 'Sara', email: 'sara@demo.com', phone: '03001234567' },
];
const ROLES = [
  { id: 3, name: 'Cashier', slug: 'cashier' },
  { id: 7, name: 'Rider', slug: 'rider' },
];
const BRANCHES = [{ id: 10, name: 'Emporium', code: 'EMP', brand_ids: [], is_active: true }];
vi.mock('../../utils/apiClient', () => ({
  default: {
    get: vi.fn(async (url: string) => {
      if (url.startsWith('/admin/users')) return { data: USERS };
      if (url.startsWith('/admin/roles')) return { data: ROLES };
      if (url.startsWith('/admin/branches')) return { data: BRANCHES };
      return { data: [] };
    }),
  },
}));
vi.mock('react-hot-toast', () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock('../../utils/sweetAlert', () => ({ confirmDialog: vi.fn() }));

import BranchUsers from './BranchUsers';

const setWidth = (w: number) => Object.defineProperty(window, 'innerWidth', { configurable: true, writable: true, value: w });

const renderPage = () =>
  render(
    <ThemeProvider>
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <BranchUsers />
      </QueryClientProvider>
    </ThemeProvider>,
  );

beforeEach(() => {
  vi.clearAllMocks();
  getBranchUsers.mockResolvedValue([]);
});
afterEach(() => setWidth(1024));

describe('Assign Users on a phone', () => {
  it('lists users as blocks and shows the role only once a user is ticked', async () => {
    setWidth(390);
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Assign Users' }));
    const list = await screen.findByTestId('assign-users-list');
    expect(screen.queryByRole('table')).toBeNull();
    expect(list).toHaveTextContent('Ali');
    expect(list).toHaveTextContent('ali@demo.com');
    expect(screen.queryByRole('button', { name: /^Role for Ali/ })).toBeNull();

    fireEvent.click(within(list).getByRole('checkbox', { name: 'Include Ali' }));
    expect(within(list).getByRole('button', { name: /^Role for Ali/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Role for Sara/ })).toBeNull();
  });
});

describe('Assign Users on desktop', () => {
  it('keeps the table', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Assign Users' }));
    expect(await screen.findByRole('table')).toBeInTheDocument();
    expect(screen.queryByTestId('assign-users-list')).toBeNull();
  });
});
