import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Branch, User } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';

interface RoleOption {
  id: number;
  name: string;
  slug: string;
}

const BranchUsers: React.FC = () => {
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [assignBranchId, setAssignBranchId] = useState<number | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [roleByUserId, setRoleByUserId] = useState<Record<number, number>>({});
  const [page, setPage] = useState(1);

  // Fetch branches
  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get<Branch[]>('/admin/branches');
      return response.data;
    },
  });

  // Fetch all users (stable list – super admin sees all, tenant user sees tenant users)
  const { data: allUsers } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const response = await apiClient.get<User[]>('/admin/users');
      return response.data;
    },
  });

  // Fetch roles (for branch assignment)
  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const response = await apiClient.get<RoleOption[]>('/admin/roles');
      return response.data;
    },
  });

  // Fetch all branch-user assignments (then filter by selected branch if any)
  const { data: branchUsers, isLoading } = useQuery({
    queryKey: ['branchUsers'],
    queryFn: () => adminService.getBranchUsers(),
  });

  type BranchUserRow = User & { branch_id?: number; branch_name?: string; branch_code?: string; role_name?: string };
  const filteredUsers = React.useMemo(() => {
    if (!branchUsers) return [];
    if (selectedBranch == null) return branchUsers as BranchUserRow[];
    return (branchUsers as BranchUserRow[]).filter((u) => u.branch_id === selectedBranch);
  }, [branchUsers, selectedBranch]);

  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filteredUsers.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredUsers, page]);
  React.useEffect(() => setPage(1), [selectedBranch]);

  const defaultRoleId = roles?.[0]?.id ?? 0;

  const assignMutation = useMutation({
    mutationFn: ({ branchId, assignments }: { branchId: number; assignments: { user_id: number; role_id: number }[] }) =>
      adminService.assignBranchUsersWithRoles(branchId, assignments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branchUsers'] });
      setShowForm(false);
      setSelectedUserIds([]);
      setRoleByUserId({});
      toast.success('Users assigned successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to assign users');
    },
  });

  const removeMutation = useMutation({
    mutationFn: ({ branchId, userId }: { branchId: number; userId: number }) =>
      adminService.removeBranchUser(branchId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branchUsers'] });
      toast.success('User removed successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to remove user');
    },
  });

  const openAssignModal = () => {
    setAssignBranchId(selectedBranch);
    setSelectedUserIds([]);
    setRoleByUserId({});
    setShowForm(true);
  };

  const toggleUser = (userId: number, checked: boolean) => {
    if (checked) {
      setSelectedUserIds((prev) => [...prev, userId]);
      setRoleByUserId((prev) => ({ ...prev, [userId]: prev[userId] ?? defaultRoleId }));
    } else {
      setSelectedUserIds((prev) => prev.filter((id) => id !== userId));
      setRoleByUserId((prev => {
        const next = { ...prev };
        delete next[userId];
        return next;
      }));
    }
  };

  const setUserRole = (userId: number, roleId: number) => {
    setRoleByUserId((prev) => ({ ...prev, [userId]: roleId }));
  };

  const handleAssign = () => {
    if (assignBranchId == null) {
      toast.error('Please select a branch');
      return;
    }
    if (selectedUserIds.length === 0) {
      toast.error('Please select at least one user');
      return;
    }
    const assignments = selectedUserIds.map((user_id) => ({
      user_id,
      role_id: roleByUserId[user_id] ?? defaultRoleId,
    }));
    assignMutation.mutate({ branchId: assignBranchId, assignments });
  };

  const isSubmitting = assignMutation.isPending || removeMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading branch users...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Branch Users</h1>
        <Button variant="primary" onClick={openAssignModal}>Assign Users</Button>
      </div>

      <Card className="mb-4 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-3 items-end">
          <SearchableSelect
            label="Filter by Branch"
            value={selectedBranch != null ? String(selectedBranch) : ''}
            onChange={(v) => setSelectedBranch(v ? parseInt(v, 10) : null)}
            options={[
              { value: '', label: 'All branches' },
              ...(branches ?? []).map((branch) => ({
                value: String(branch.id),
                label: `${branch.name} (${branch.code})`,
              })),
            ]}
            placeholder="All branches"
            minWidth="min-w-[200px]"
          />
          <ClearFiltersButton onClick={() => setSelectedBranch(null)} />
        </div>
      </Card>

      <Modal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setAssignBranchId(null);
          setSelectedUserIds([]);
          setRoleByUserId({});
        }}
        title="Assign Users to Branch"
        size="large"
      >
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Branch *</label>
            <select
              value={assignBranchId ?? ''}
              onChange={(e) => setAssignBranchId(e.target.value ? parseInt(e.target.value, 10) : null)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select branch</option>
              {branches?.map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name} ({branch.code})
                </option>
              ))}
            </select>
          </div>
          <p className="text-sm text-gray-600">
            Select users and choose a role for each. All selected users stay in the list until you submit or cancel.
          </p>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Users and role per user</label>
            <div className="max-h-80 overflow-y-auto border border-gray-300 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left p-2 w-10">Include</th>
                    <th className="text-left p-2">User</th>
                    <th className="text-left p-2">Role for this branch</th>
                  </tr>
                </thead>
                <tbody>
                  {allUsers?.map((user) => (
                    <tr key={user.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(user.id)}
                          onChange={(e) => toggleUser(user.id, e.target.checked)}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                        />
                      </td>
                      <td className="p-2">
                        <span className="font-medium text-gray-800">{user.name}</span>
                        <span className="text-gray-500 ml-1">({user.email})</span>
                      </td>
                      <td className="p-2">
                        <select
                          value={roleByUserId[user.id] ?? defaultRoleId}
                          onChange={(e) => setUserRole(user.id, parseInt(e.target.value, 10))}
                          disabled={!selectedUserIds.includes(user.id)}
                          className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                        >
                          {roles?.map((role) => (
                            <option key={role.id} value={role.id}>
                              {role.name}
                            </option>
                          ))}
                        </select>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {allUsers?.length === 0 && (
              <p className="text-gray-500 text-sm p-2">No users found. Create users in the Users page first.</p>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setSelectedUserIds([]);
                setRoleByUserId({});
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              isLoading={assignMutation.isPending}
              disabled={!assignBranchId}
            >
              Assign {selectedUserIds.length > 0 ? selectedUserIds.length : ''} user(s)
            </Button>
          </div>
        </div>
      </Modal>

      {filteredUsers.length === 0 ? (
        <Card>
          <p className="text-center text-gray-500 py-8">
            {branchUsers?.length === 0
              ? 'No branch-user assignments yet. Use Assign Users above.'
              : selectedBranch
                ? 'No users assigned to this branch. Change filter or assign users.'
                : 'No branch-user assignments yet. Use Assign Users above.'}
          </p>
        </Card>
      ) : (
        <>
          <AccentedList>
            {paginatedUsers.map((user: BranchUserRow, i) => (
              <AccentedListRow
                key={`${user.branch_id}-${user.id}`}
                accent="active"
                initial={(user.name ?? 'U').charAt(0)}
                title={user.name ?? '—'}
                subtitle={
                  <>
                    <p>{user.email}</p>
                    {user.branch_name != null && <p>Branch: {user.branch_name}{user.branch_code ? ` (${user.branch_code})` : ''}</p>}
                    {user.role_name && <p>Role: {user.role_name}</p>}
                    {user.phone && <p>{user.phone}</p>}
                  </>
                }
                animationIndex={i}
                actions={
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => {
                      (async () => {
                        const branchId = user.branch_id ?? selectedBranch;
                        if (branchId == null) return;
                        const ok = await confirmDialog({
                          title: `Remove ${user.name} from this branch?`,
                          text: 'They will lose access to this branch.',
                          confirmText: 'Remove',
                        });
                        if (!ok) return;
                        removeMutation.mutate({ branchId, userId: user.id });
                      })();
                    }}
                    isLoading={removeMutation.isPending}
                  >
                    Remove
                  </Button>
                }
              />
            ))}
          </AccentedList>
          <PaginationBar totalCount={filteredUsers.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="users" />
        </>
      )}
    </div>
  );
};

export default BranchUsers;
