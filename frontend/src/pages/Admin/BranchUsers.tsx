import React, { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Branch, Brand, User } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import { useHasPermission } from '../../hooks/useHasPermission';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { confirmDialog } from '../../utils/sweetAlert';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { isEntityInactive, labelWithStatus } from '../../utils/entityStatus';
import InactiveBadge from '../../components/InactiveBadge';

interface RoleOption {
  id: number;
  name: string;
  slug: string;
}

const BranchUsers: React.FC = () => {
  const queryClient = useQueryClient();
  const canAssign = useHasPermission('branch-users:assign');
  const canRemove = useHasPermission('branch-users:remove');
  const [showForm, setShowForm] = useState(false);
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [assignBranchId, setAssignBranchId] = useState<number | null>(null);
  const [selectedUserIds, setSelectedUserIds] = useState<number[]>([]);
  const [roleByUserId, setRoleByUserId] = useState<Record<number, number>>({});
  // Brand lock per user: 0 / missing = all brands (no lock)
  const [brandByUserId, setBrandByUserId] = useState<Record<number, number>>({});
  const [phoneByUserId, setPhoneByUserId] = useState<Record<number, string>>({});
  const [page, setPage] = useState(1);
  // Free-text search on the listing
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebouncedValue(search, 300);
  // Free-text search on the users table inside the assign modal
  const [modalUserSearch, setModalUserSearch] = useState('');
  // Multi-branch modal state (user-centric: one user → N branches)
  const [showMultiBranchForm, setShowMultiBranchForm] = useState(false);
  const [mbUserId, setMbUserId] = useState('');
  const [mbBranchIds, setMbBranchIds] = useState<number[]>([]);
  const [mbRoleId, setMbRoleId] = useState('');
  const [mbBrandId, setMbBrandId] = useState('0');
  const [mbPhone, setMbPhone] = useState('');

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

  // Fetch brands (for the per-user brand lock selector; filtered to the assign branch's brands)
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<Brand[]>('/admin/brands');
      return response.data;
    },
  });

  // Fetch all branch-user assignments (then filter by selected branch if any)
  const { data: branchUsers, isLoading } = useQuery({
    queryKey: ['branchUsers'],
    queryFn: () => adminService.getBranchUsers(),
  });

  type BranchUserRow = User & { branch_id?: number; branch_name?: string; branch_code?: string; role_id?: number; role_name?: string; brand_id?: number | null; brand_name?: string | null };

  const assignBranchBrands = React.useMemo(() => {
    if (assignBranchId == null) return [];
    const branch = branches?.find((b) => b.id === assignBranchId);
    if (!branch?.brand_ids?.length) return [];
    return (brands ?? []).filter((b) => branch.brand_ids.includes(b.id));
  }, [assignBranchId, branches, brands]);
  const filteredUsers = React.useMemo(() => {
    if (!branchUsers) return [];
    let list = branchUsers as BranchUserRow[];
    if (selectedBranch != null) list = list.filter((u) => u.branch_id === selectedBranch);
    const q = debouncedSearch.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (u) =>
          (u.name ?? '').toLowerCase().includes(q) ||
          (u.email ?? '').toLowerCase().includes(q) ||
          (u.phone ?? '').toLowerCase().includes(q) ||
          (u.branch_name ?? '').toLowerCase().includes(q) ||
          (u.branch_code ?? '').toLowerCase().includes(q) ||
          (u.role_name ?? '').toLowerCase().includes(q) ||
          (u.brand_name ?? '').toLowerCase().includes(q),
      );
    }
    return list;
  }, [branchUsers, selectedBranch, debouncedSearch]);

  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filteredUsers.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredUsers, page]);
  React.useEffect(() => setPage(1), [selectedBranch, debouncedSearch]);

  const defaultRoleId = roles?.[0]?.id ?? 0;
  // Pre-fill the modal's selection from the chosen branch's existing assignments.
  // Already-assigned users start checked, with their saved role + brand-lock.
  const applyBranchPreselection = (branchId: number | null) => {
    if (branchId == null || !branchUsers) {
      setSelectedUserIds([]);
      setRoleByUserId({});
      setBrandByUserId({});
      setPhoneByUserId({});
      return;
    }
    const existing = (branchUsers as BranchUserRow[]).filter((u) => u.branch_id === branchId);
    setSelectedUserIds(existing.map((u) => u.id));
    const roleMap: Record<number, number> = {};
    const brandMap: Record<number, number> = {};
    for (const u of existing) {
      roleMap[u.id] = u.role_id ?? defaultRoleId;
      brandMap[u.id] = u.brand_id ?? 0;
    }
    setRoleByUserId(roleMap);
    setBrandByUserId(brandMap);
  };

  // User IDs already assigned to the branch chosen in the modal, with their saved
  // role + brand-lock (brand normalized to 0 = all brands, matching brandByUserId).
  // Drives the "Assigned" badge and the "unchanged no-op" diff below.
  const branchAssignedByUserId = React.useMemo(() => {
    const map = new Map<number, { roleId: number; brandId: number }>();
    if (assignBranchId == null || !branchUsers) return map;
    for (const u of (branchUsers as BranchUserRow[])) {
      if (u.branch_id !== assignBranchId) continue;
      map.set(u.id, { roleId: u.role_id ?? defaultRoleId, brandId: u.brand_id ?? 0 });
    }
    return map;
  }, [assignBranchId, branchUsers, defaultRoleId]);
  const branchAssignedUserIds = React.useMemo(
    () => new Set(branchAssignedByUserId.keys()),
    [branchAssignedByUserId],
  );

  // Genuinely actionable users: new assignments, or already-assigned users whose
  // role or brand-lock changed. Already-assigned + unchanged users are no-ops.
  const effectiveUserIds = React.useMemo(
    () =>
      selectedUserIds.filter((id) => {
        const existing = branchAssignedByUserId.get(id);
        if (!existing) return true; // new assignment
        const roleId = roleByUserId[id] ?? defaultRoleId;
        const brandId = brandByUserId[id] ?? 0;
        return roleId !== existing.roleId || brandId !== existing.brandId;
      }),
    [selectedUserIds, branchAssignedByUserId, roleByUserId, brandByUserId, defaultRoleId],
  );

  // Riders get called by dispatch, so the rider role is the point where a phone
  // stops being optional — it is asked for here and saved onto the user.
  const riderRoleId = roles?.find((r) => r.slug === 'rider')?.id ?? null;
  const isRiderRole = (roleId: number) => riderRoleId != null && roleId === riderRoleId;
  const phoneOf = (userId: number) =>
    phoneByUserId[userId] ?? (allUsers ?? []).find((u) => u.id === userId)?.phone ?? '';
  // The column only appears once a rider is actually in play, so nothing changes
  // for branches that have no riders.
  const showPhoneColumn = React.useMemo(
    () =>
      riderRoleId != null &&
      selectedUserIds.some((id) => isRiderRole(roleByUserId[id] ?? defaultRoleId)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selectedUserIds, roleByUserId, defaultRoleId, riderRoleId],
  );

  /** Rider rows still missing a number — they block the save. */
  const ridersMissingPhone = React.useMemo(
    () =>
      effectiveUserIds.filter(
        (id) => isRiderRole(roleByUserId[id] ?? defaultRoleId) && !phoneOf(id).trim(),
      ),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [effectiveUserIds, roleByUserId, phoneByUserId, allUsers, defaultRoleId, riderRoleId],
  );

  // Users shown in the modal table, narrowed by the modal search box.
  const modalUsers = React.useMemo(() => {
    const q = modalUserSearch.trim().toLowerCase();
    const list = allUsers ?? [];
    if (!q) return list;
    return list.filter(
      (u) => (u.name ?? '').toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q),
    );
  }, [allUsers, modalUserSearch]);

  const assignMutation = useMutation({
    mutationFn: ({ branchId, assignments }: { branchId: number; assignments: { user_id: number; role_id: number; brand_id?: number | null; phone?: string | null }[] }) =>
      adminService.assignBranchUsersWithRoles(branchId, assignments),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['branchUsers'] });
      setShowForm(false);
      setSelectedUserIds([]);
      setRoleByUserId({});
      setBrandByUserId({});
      setPhoneByUserId({});
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

  const bulkAssignMutation = useMutation({
    mutationFn: adminService.bulkAssignUserToBranches,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['branchUsers'] });
      setShowMultiBranchForm(false);
      setMbUserId('');
      setMbBranchIds([]);
      setMbRoleId('');
      setMbBrandId('0');
      setMbPhone('');
      toast.success(result.message);
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to assign user');
    },
  });

  const openAssignModal = () => {
    setAssignBranchId(selectedBranch);
    setModalUserSearch('');
    applyBranchPreselection(selectedBranch);
    setShowForm(true);
  };

  const mbUserAlreadyAssignedBranchIds = React.useMemo(() => {
    if (!mbUserId || !branchUsers) return new Set<number>();
    const uid = parseInt(mbUserId, 10);
    return new Set(
      (branchUsers as BranchUserRow[])
        .filter((u) => u.id === uid)
        .map((u) => u.branch_id!)
        .filter(Boolean),
    );
  }, [mbUserId, branchUsers]);

  const mbIsRider = !!mbRoleId && isRiderRole(parseInt(mbRoleId, 10));
  const mbPhoneValue = mbUserId
    ? (mbPhone || (allUsers ?? []).find((u) => u.id === parseInt(mbUserId, 10))?.phone || '')
    : mbPhone;

  const handleBulkAssign = () => {
    if (!mbUserId) { toast.error('Select a user'); return; }
    if (!mbRoleId) { toast.error('Select a role'); return; }
    if (mbIsRider && !mbPhoneValue.trim()) { toast.error('A phone number is required for riders'); return; }
    const newBranches = mbBranchIds.filter((id) => !mbUserAlreadyAssignedBranchIds.has(id));
    if (newBranches.length === 0) { toast.error('Select at least one branch not already assigned'); return; }
    bulkAssignMutation.mutate({
      user_id: parseInt(mbUserId, 10),
      branch_ids: newBranches,
      role_id: parseInt(mbRoleId, 10),
      brand_id: mbBrandId && mbBrandId !== '0' ? parseInt(mbBrandId, 10) : null,
      ...(mbIsRider ? { phone: mbPhoneValue.trim() } : {}),
    });
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

  const setUserBrand = (userId: number, brandId: number) => {
    setBrandByUserId((prev) => ({ ...prev, [userId]: brandId }));
  };

  const handleAssign = () => {
    if (assignBranchId == null) {
      toast.error('Please select a branch');
      return;
    }
    if (effectiveUserIds.length === 0) {
      toast.error('Please select at least one user');
      return;
    }
    if (ridersMissingPhone.length > 0) {
      const names = ridersMissingPhone
        .map((id) => (allUsers ?? []).find((u) => u.id === id)?.name ?? `User ${id}`)
        .join(', ');
      toast.error(`A phone number is required for riders: ${names}`);
      return;
    }
    const assignments = effectiveUserIds.map((user_id) => {
      const role_id = roleByUserId[user_id] ?? defaultRoleId;
      return {
        user_id,
        role_id,
        brand_id: brandByUserId[user_id] || null,
        // Only riders carry a phone: it is saved to the user, and sending it
        // for other roles would overwrite their number from this screen.
        ...(isRiderRole(role_id) ? { phone: phoneOf(user_id).trim() } : {}),
      };
    });
    assignMutation.mutate({ branchId: assignBranchId, assignments });
  };

  const isSubmitting = assignMutation.isPending || removeMutation.isPending || bulkAssignMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading branch users...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Branch Users</h1>
        <div className="flex gap-2">
          {canAssign && <Button variant="outline" onClick={() => { setMbUserId(''); setMbBranchIds([]); setMbRoleId(String(defaultRoleId)); setMbBrandId('0'); setShowMultiBranchForm(true); }}>
            Assign to Branches
          </Button>}
          {canAssign && <Button variant="primary" onClick={openAssignModal}>Assign Users</Button>}
        </div>
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
                inactive: isEntityInactive(branch),
              })),
            ]}
            placeholder="All branches"
            minWidth="min-w-[200px]"
          />
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Search</label>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Name, email, branch, role or brand..."
              className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <ClearFiltersButton
            onClick={() => {
              setSelectedBranch(null);
              setSearch('');
            }}
          />
        </div>
      </Card>

      <Modal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setAssignBranchId(null);
          setSelectedUserIds([]);
          setRoleByUserId({});
          setBrandByUserId({});
          setPhoneByUserId({});
          setModalUserSearch('');
        }}
        title="Assign Users to Branch"
        size="large"
      >
        <div className="space-y-4">
          <div>
            <SearchableSelect
              label="Branch *"
              value={assignBranchId != null ? String(assignBranchId) : ''}
              onChange={(v) => {
                const id = v ? parseInt(v, 10) : null;
                setAssignBranchId(id);
                applyBranchPreselection(id);
              }}
              options={(branches ?? []).map((branch) => ({
                value: String(branch.id),
                label: `${branch.name} (${branch.code})`,
                inactive: isEntityInactive(branch),
              }))}
              placeholder="Select branch"
              searchPlaceholder="Search branches..."
              minWidth="min-w-full"
            />
          </div>
          <p className="text-sm text-gray-600">
            Select users and choose a role for each. All selected users stay in the list until you submit or cancel.
            {assignBranchBrands.length > 1 &&
              ' "Brand" locks the user’s till, kitchen and FOH screens to that brand only — leave "All brands" for supervisors.'}
          </p>
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-2">
              <label className="block text-sm font-medium text-gray-700">Users and role per user</label>
              <input
                type="text"
                value={modalUserSearch}
                onChange={(e) => setModalUserSearch(e.target.value)}
                placeholder="Search users by name or email..."
                className="w-full sm:w-64 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="max-h-80 overflow-y-auto border border-gray-300 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left p-2 w-10">Include</th>
                    <th className="text-left p-2">User</th>
                    <th className="text-left p-2">Role for this branch</th>
                    {assignBranchBrands.length > 1 && (
                      <th className="text-left p-2">Brand</th>
                    )}
                    {showPhoneColumn && <th className="text-left p-2">Phone (riders)</th>}
                  </tr>
                </thead>
                <tbody>
                  {modalUsers.map((user) => (
                    <tr key={user.id} className="border-t border-gray-100 hover:bg-gray-50">
                      <td className="p-2">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(user.id)}
                          onChange={(e) => toggleUser(user.id, e.target.checked)}
                          disabled={branchAssignedUserIds.has(user.id)}
                          title={branchAssignedUserIds.has(user.id) ? 'Already assigned — remove from the list page' : undefined}
                          className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-60 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="p-2">
                        <span className="font-medium text-gray-800">{user.name}</span>
                        <span className="text-gray-500 ml-1">({user.email})</span>
                        {branchAssignedUserIds.has(user.id) && (
                          <span className="ml-2 inline-block text-[10px] font-semibold uppercase tracking-wide bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                            Assigned
                          </span>
                        )}
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
                      {assignBranchBrands.length > 1 && (
                        <td className="p-2">
                          <select
                            value={brandByUserId[user.id] ?? 0}
                            onChange={(e) => setUserBrand(user.id, parseInt(e.target.value, 10))}
                            disabled={!selectedUserIds.includes(user.id)}
                            className="px-2 py-1 border border-gray-300 rounded focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
                          >
                            <option value={0}>All brands</option>
                            {assignBranchBrands.map((brand) => (
                              <option key={brand.id} value={brand.id}>
                                {brand.name}
                              </option>
                            ))}
                          </select>
                        </td>
                      )}
                      {showPhoneColumn && (
                        <td className="p-2">
                          {isRiderRole(roleByUserId[user.id] ?? defaultRoleId) &&
                          selectedUserIds.includes(user.id) ? (
                            <input
                              type="tel"
                              value={phoneOf(user.id)}
                              onChange={(e) =>
                                setPhoneByUserId((prev) => ({ ...prev, [user.id]: e.target.value }))
                              }
                              placeholder="Required for riders"
                              aria-label={`Phone for ${user.name}`}
                              className={`w-40 px-2 py-1 border rounded focus:ring-2 focus:ring-blue-500 ${
                                phoneOf(user.id).trim()
                                  ? 'border-gray-300'
                                  : 'border-red-400 bg-red-50 placeholder-red-400'
                              }`}
                            />
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {allUsers?.length === 0 && (
              <p className="text-gray-500 text-sm p-2">No users found. Create users in the Users page first.</p>
            )}
            {!!allUsers?.length && modalUsers.length === 0 && (
              <p className="text-gray-500 text-sm p-2">No users match “{modalUserSearch}”.</p>
            )}
          </div>

          <div className="flex gap-2 justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setAssignBranchId(null);
                setSelectedUserIds([]);
                setRoleByUserId({});
                setBrandByUserId({});
                setModalUserSearch('');
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleAssign}
              isLoading={assignMutation.isPending}
              disabled={!assignBranchId}
            >
              Assign {effectiveUserIds.length > 0 ? effectiveUserIds.length : ''} user(s)
            </Button>
          </div>
        </div>
      </Modal>

      {/* Multi-branch modal: pick one user, assign to multiple branches at once */}
      <Modal
        isOpen={showMultiBranchForm}
        onClose={() => { setShowMultiBranchForm(false); setMbUserId(''); setMbBranchIds([]); setMbRoleId(''); setMbBrandId('0'); }}
        title="Assign User to Multiple Branches"
        size="large"
      >
        <div className="space-y-4">
          <SearchableSelect
            label="User *"
            value={mbUserId}
            onChange={(v) => { setMbUserId(v); setMbBranchIds([]); }}
            options={[
              { value: '', label: 'Select user' },
              ...(allUsers ?? []).map((u) => ({ value: String(u.id), label: `${u.name} (${u.email})` })),
            ]}
            placeholder="Select user"
            searchPlaceholder="Search users..."
            minWidth="min-w-full"
          />

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role *</label>
              <select
                value={mbRoleId}
                onChange={(e) => setMbRoleId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select role</option>
                {roles?.map((r) => <option key={r.id} value={String(r.id)}>{r.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand lock</label>
              <select
                value={mbBrandId}
                onChange={(e) => setMbBrandId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="0">All brands</option>
                {(brands ?? []).map((b) => <option key={b.id} value={String(b.id)}>{labelWithStatus(b.name, b)}</option>)}
              </select>
            </div>
          </div>

          {mbIsRider && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone *</label>
              <input
                type="tel"
                value={mbPhoneValue}
                onChange={(e) => setMbPhone(e.target.value)}
                placeholder="Required for riders"
                className={`w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 ${
                  mbPhoneValue.trim() ? 'border-gray-300' : 'border-red-400 bg-red-50 placeholder-red-400'
                }`}
              />
              <p className="mt-1 text-xs text-gray-500">Dispatch calls riders on this number. Saved to the user.</p>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Branches *</label>
            <div className="max-h-64 overflow-y-auto border border-gray-300 rounded-lg">
              <table className="w-full text-sm">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="text-left p-2 w-10">Select</th>
                    <th className="text-left p-2">Branch</th>
                    <th className="text-left p-2">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(branches ?? []).map((branch) => {
                    const alreadyAssigned = mbUserAlreadyAssignedBranchIds.has(branch.id);
                    const checked = mbBranchIds.includes(branch.id);
                    return (
                      <tr key={branch.id} className="border-t border-gray-100 hover:bg-gray-50">
                        <td className="p-2">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={alreadyAssigned}
                            onChange={(e) =>
                              setMbBranchIds((prev) =>
                                e.target.checked ? [...prev, branch.id] : prev.filter((id) => id !== branch.id),
                              )
                            }
                            className="h-4 w-4 text-blue-600 border-gray-300 rounded disabled:opacity-60 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="p-2 font-medium text-gray-800">
                          <span className="inline-flex items-center gap-1.5">
                            {branch.name} <span className="text-gray-500 font-normal">({branch.code})</span>
                            {isEntityInactive(branch) && <InactiveBadge />}
                          </span>
                        </td>
                        <td className="p-2">
                          {alreadyAssigned && (
                            <span className="inline-block text-[10px] font-semibold uppercase tracking-wide bg-green-100 text-green-700 px-1.5 py-0.5 rounded">
                              Already assigned
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <div className="flex gap-2 justify-end">
            <Button variant="outline" onClick={() => { setShowMultiBranchForm(false); setMbUserId(''); setMbBranchIds([]); setMbRoleId(''); setMbBrandId('0'); }}>
              Cancel
            </Button>
            <Button onClick={handleBulkAssign} isLoading={bulkAssignMutation.isPending}>
              Assign to {mbBranchIds.filter((id) => !mbUserAlreadyAssignedBranchIds.has(id)).length || ''} branch(es)
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
                    {user.brand_name && <p>Brand: {user.brand_name} (locked)</p>}
                    {user.phone && <p>{user.phone}</p>}
                  </>
                }
                animationIndex={i}
                actions={
                  canRemove ? (
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
                  ) : undefined
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
