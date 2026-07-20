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
// The page gates Assign/Remove on permissions via useHasPermission → useAuth.
vi.mock('../../contexts/AuthContext', () => ({
  useAuth: () => ({
    user: { tenant_id: 1, permissions: ['branch-users:assign', 'branch-users:remove'] },
  }),
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
      if (url.startsWith('/admin/brands')) return { data: [] };
      return { data: [] };
    }),
  },
}));
const toastError = vi.fn();
vi.mock('react-hot-toast', () => ({
  toast: { success: vi.fn(), error: (...a: unknown[]) => toastError(...a) },
}));
vi.mock('../../utils/sweetAlert', () => ({ confirmDialog: vi.fn() }));

import BranchUsers from './BranchUsers';

beforeEach(() => {
  vi.clearAllMocks();
  getBranchUsers.mockResolvedValue([]); // nobody assigned yet
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

/** Render the page, open "Assign Users", choose the branch, and tick a user. */
const openModalAndPick = async (userName: string) => {
  renderPage();
  fireEvent.click(await screen.findByRole('button', { name: /Assign Users/i }));
  // Nothing can be assigned until the modal has a branch. SearchableSelect
  // commits its options on mousedown, not click.
  fireEvent.click(await screen.findByRole('button', { name: /Select branch/i }));
  fireEvent.mouseDown(await screen.findByRole('option', { name: 'Emporium (EMP)' }));
  const row = (await screen.findByText(userName)).closest('tr') as HTMLElement;
  fireEvent.click(within(row).getByRole('checkbox'));
  return row;
};

const setRole = (row: HTMLElement, roleName: string) => {
  const select = within(row).getByRole('combobox');
  fireEvent.change(select, { target: { value: String(ROLES.find((r) => r.name === roleName)!.id) } });
};

const save = () => fireEvent.click(screen.getByRole('button', { name: /Assign \d+ user\(s\)/ }));

describe('Branch Users — phone is required only for riders', () => {
  it('asks for no phone while the role is not rider', async () => {
    const row = await openModalAndPick('Ali');
    expect(screen.queryByText('Phone (riders)')).not.toBeInTheDocument();
    save();
    await waitFor(() => expect(assignBranchUsersWithRoles).toHaveBeenCalled());
    // A cashier assignment carries no phone at all.
    expect(assignBranchUsersWithRoles.mock.calls[0][1]).toEqual([
      { user_id: 1, role_id: 3, brand_id: null },
    ]);
    expect(row).toBeTruthy();
  });

  it('reveals a phone field as soon as a user is made a rider', async () => {
    const row = await openModalAndPick('Ali');
    setRole(row, 'Rider');
    expect(await screen.findByText('Phone (riders)')).toBeInTheDocument();
    expect(within(row).getByLabelText('Phone for Ali')).toHaveValue('');
  });

  it('refuses to save a rider with no phone, naming them', async () => {
    const row = await openModalAndPick('Ali');
    setRole(row, 'Rider');
    save();
    await waitFor(() =>
      expect(toastError).toHaveBeenCalledWith(expect.stringMatching(/phone number is required for riders: Ali/)),
    );
    expect(assignBranchUsersWithRoles).not.toHaveBeenCalled();
  });

  it('sends the typed phone with the rider assignment', async () => {
    const row = await openModalAndPick('Ali');
    setRole(row, 'Rider');
    fireEvent.change(within(row).getByLabelText('Phone for Ali'), {
      target: { value: '03009998877' },
    });
    save();
    await waitFor(() => expect(assignBranchUsersWithRoles).toHaveBeenCalled());
    expect(assignBranchUsersWithRoles.mock.calls[0][1]).toEqual([
      { user_id: 1, role_id: 7, brand_id: null, phone: '03009998877' },
    ]);
  });

  it('prefills the number already on file so it can be confirmed or corrected', async () => {
    const row = await openModalAndPick('Sara');
    setRole(row, 'Rider');
    const field = within(row).getByLabelText('Phone for Sara');
    expect(field).toHaveValue('03001234567');

    fireEvent.change(field, { target: { value: '03110000000' } });
    save();
    await waitFor(() => expect(assignBranchUsersWithRoles).toHaveBeenCalled());
    expect(assignBranchUsersWithRoles.mock.calls[0][1][0].phone).toBe('03110000000');
  });

  it('saves a rider straight through on the number already on file', async () => {
    const row = await openModalAndPick('Sara');
    setRole(row, 'Rider');
    save();
    await waitFor(() => expect(assignBranchUsersWithRoles).toHaveBeenCalled());
    expect(assignBranchUsersWithRoles.mock.calls[0][1][0].phone).toBe('03001234567');
    expect(toastError).not.toHaveBeenCalled();
  });

  it('drops the phone again if the role is switched away from rider', async () => {
    const row = await openModalAndPick('Ali');
    setRole(row, 'Rider');
    fireEvent.change(within(row).getByLabelText('Phone for Ali'), { target: { value: '0300111' } });
    setRole(row, 'Cashier');
    expect(screen.queryByText('Phone (riders)')).not.toBeInTheDocument();
    save();
    await waitFor(() => expect(assignBranchUsersWithRoles).toHaveBeenCalled());
    expect(assignBranchUsersWithRoles.mock.calls[0][1][0]).not.toHaveProperty('phone');
  });
});
