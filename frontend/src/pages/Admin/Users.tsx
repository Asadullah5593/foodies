import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { useAuth } from '../../contexts/AuthContext';
import { User, Tenant } from '../../types';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';

interface RoleOption {
  id: number;
  name: string;
  slug: string;
}

function roleSlugToLabel(slug: string): string {
  return slug
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}

const Users: React.FC = () => {
  const { user } = useAuth();
  const isSuperAdmin = user?.is_super_admin ?? false;
  const queryClient = useQueryClient();
  const [showCreate, setShowCreate] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [createData, setCreateData] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    tenant_id: '',
  });
  const [editData, setEditData] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
  });
  const [filterRole, setFilterRole] = useState('');
  const [filterSearch, setFilterSearch] = useState('');
  const debouncedFilterSearch = useDebouncedValue(filterSearch, 300);
  const [page, setPage] = useState(1);

  const { data: roles } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const response = await apiClient.get<RoleOption[]>('/admin/roles');
      return response.data ?? [];
    },
  });

  const { data: tenants } = useQuery({
    queryKey: ['tenants'],
    queryFn: async () => {
      const response = await apiClient.get<Tenant[]>('/admin/tenants');
      return response.data;
    },
    enabled: isSuperAdmin,
  });

  const { data: users, isLoading } = useQuery({
    queryKey: ['users'],
    queryFn: () => adminService.getUsers(),
  });

  const filteredUsers = useMemo(() => {
    let list = users ?? [];
    if (filterRole) {
      list = list.filter((u) => (u.role ?? '').toLowerCase() === filterRole.toLowerCase());
    }
    if (debouncedFilterSearch.trim()) {
      const q = debouncedFilterSearch.trim().toLowerCase();
      list = list.filter(
        (u) =>
          (u.name ?? '').toLowerCase().includes(q) ||
          (u.email ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, filterRole, debouncedFilterSearch]);

  const paginatedUsers = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return filteredUsers.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [filteredUsers, page]);

  React.useEffect(() => setPage(1), [filterRole, debouncedFilterSearch]);

  const userSearchTypeahead = useTypeaheadSuggestions({
    query: debouncedFilterSearch,
    options: (users ?? []).map((u: any) => ({ id: String(u.id), label: u.name ?? '' })),
    minChars: 2,
    limit: 8,
  });

  const createMutation = useMutation({
    mutationFn: async (data: typeof createData) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        email: data.email,
        password: data.password,
        phone: data.phone || undefined,
      };
      if (isSuperAdmin && data.tenant_id) payload.tenant_id = Number(data.tenant_id);
      const response = await apiClient.post('/admin/users', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreate(false);
      setCreateData({ name: '', email: '', password: '', phone: '', tenant_id: '' });
      toast.success('User created successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create user');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: typeof editData }) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        email: data.email,
        phone: data.phone || undefined,
      };
      if (data.password && data.password.trim()) payload.password = data.password.trim();
      return adminService.updateUser(id, payload);
    },
    onSuccess: (updatedUser) => {
      // Update list cache with API response so role (and other fields) show immediately
      queryClient.setQueryData<User[]>(['users'], (old) => {
        if (!old) return old;
        return old.map((u) =>
          u.id === updatedUser.id
            ? { ...u, ...updatedUser, role: updatedUser.role ?? u.role }
            : u
        );
      });
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setEditingUser(null);
      toast.success('User updated successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update user');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteUser(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      toast.success('User deleted successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete user');
    },
  });

  const openEdit = (u: User) => {
    setEditingUser(u);
    setEditData({
      name: u.name ?? '',
      email: u.email ?? '',
      password: '',
      phone: u.phone ?? '',
    });
  };

  const isSubmitting = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading users...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Users</h1>
        <Button variant="primary" onClick={() => setShowCreate(true)}>Add User</Button>
      </div>

      <Card className="mb-6 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-4 items-end">
          <SearchableSelect
            label="Role"
            value={filterRole}
            onChange={setFilterRole}
            options={[
              { value: '', label: 'All roles' },
              ...(roles ?? []).map((r) => ({ value: r.slug, label: r.name })),
            ]}
            placeholder="All roles"
            minWidth="min-w-[180px]"
          />
          <div className="flex-1 min-w-[200px] relative">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              onFocus={() => userSearchTypeahead.setOpen(true)}
              onKeyDown={(e) => {
                const suggestions = userSearchTypeahead.suggestions;
                if (!suggestions.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  userSearchTypeahead.setActiveIndex(Math.min(userSearchTypeahead.activeIndex + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  userSearchTypeahead.setActiveIndex(Math.max(userSearchTypeahead.activeIndex - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const opt = suggestions[userSearchTypeahead.activeIndex];
                  if (opt?.label) setFilterSearch(opt.label);
                  userSearchTypeahead.setOpen(false);
                } else if (e.key === 'Escape') {
                  userSearchTypeahead.setOpen(false);
                }
              }}
              placeholder="Name or email..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
            <TypeaheadDropdown
              open={userSearchTypeahead.open && filterSearch.trim().length >= 2}
              suggestions={userSearchTypeahead.suggestions}
              activeIndex={userSearchTypeahead.activeIndex}
              onHoverIndex={userSearchTypeahead.setActiveIndex}
              onSelect={(opt) => {
                setFilterSearch(opt.label);
                userSearchTypeahead.setOpen(false);
              }}
              onClose={() => userSearchTypeahead.setOpen(false)}
            />
          </div>
          <ClearFiltersButton
            onClick={() => {
              setFilterRole('');
              setFilterSearch('');
            }}
          />
        </div>
      </Card>

      {/* Create User Modal */}
      <Modal isOpen={showCreate} onClose={() => setShowCreate(false)} title="Create User" size="medium">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (isSuperAdmin && !createData.tenant_id) {
              toast.error('Please select a tenant.');
              return;
            }
            createMutation.mutate(createData);
          }}
          className="space-y-4"
        >
          {isSuperAdmin && tenants && tenants.length > 0 && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tenant *</label>
              <select
                value={createData.tenant_id}
                onChange={(e) => setCreateData({ ...createData, tenant_id: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                <option value="">Select tenant</option>
                {tenants.map((t) => (
                  <option key={t.id} value={t.id}>{t.name}</option>
                ))}
              </select>
            </div>
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
            <input
              type="text"
              value={createData.name}
              onChange={(e) => setCreateData({ ...createData, name: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input
              type="email"
              value={createData.email}
              onChange={(e) => setCreateData({ ...createData, email: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
            <input
              type="password"
              value={createData.password}
              onChange={(e) => setCreateData({ ...createData, password: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
            <input
              type="tel"
              value={createData.phone}
              onChange={(e) => setCreateData({ ...createData, phone: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowCreate(false)}>
              Cancel
            </Button>
            <Button type="submit" isLoading={createMutation.isPending}>
              Create User
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit User Modal */}
      <Modal
        isOpen={!!editingUser}
        onClose={() => setEditingUser(null)}
        title="Edit User"
        size="medium"
      >
        {editingUser && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              updateMutation.mutate({ id: editingUser.id, data: editData });
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Name *</label>
              <input
                type="text"
                value={editData.name}
                onChange={(e) => setEditData({ ...editData, name: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
              <input
                type="email"
                value={editData.email}
                onChange={(e) => setEditData({ ...editData, email: e.target.value })}
                required
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={editData.phone}
                onChange={(e) => setEditData({ ...editData, phone: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">New password</label>
              <input
                type="password"
                value={editData.password}
                onChange={(e) => setEditData({ ...editData, password: e.target.value })}
                placeholder="Leave blank to keep current"
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="outline" onClick={() => setEditingUser(null)}>
                Cancel
              </Button>
              <Button type="submit" isLoading={updateMutation.isPending}>
                Update User
              </Button>
            </div>
          </form>
        )}
      </Modal>

      <div className="w-full space-y-3">
        {filteredUsers.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">
              {users?.length === 0 ? 'No users found. Create your first user!' : 'No users match the current filters.'}
            </p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedUsers.map((u, i) => (
                <AccentedListRow
                  key={u.id}
                  accent={u.status === 'active' ? 'active' : 'inactive'}
                  initial={(u.name || 'U').charAt(0)}
                  title={u.name || '—'}
                  subtitle={
                    <>
                      <p>Email: {u.email}</p>
                      {u.phone && <p>Phone: {u.phone}</p>}
                      <p>Role: <span className="font-medium text-indigo-600 dark:text-indigo-400">{u.role ? roleSlugToLabel(u.role) : '—'}</span></p>
                    </>
                  }
                  statusLabel={u.status}
                  statusVariant={u.status === 'active' ? 'active' : 'inactive'}
                  animationIndex={i}
                  actions={
                    <>
                      <Button size="small" variant="edit" onClick={() => openEdit(u)}>Edit</Button>
                      <Button size="small" variant="danger" onClick={() => confirm(`Delete user "${u.name}"?`) && deleteMutation.mutate(u.id)} isLoading={deleteMutation.isPending}>Delete</Button>
                    </>
                  }
                />
              ))}
            </AccentedList>
            <PaginationBar totalCount={filteredUsers.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="users" />
          </>
        )}
      </div>
    </div>
  );
};

export default Users;
