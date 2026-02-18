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
    role: 'cashier',
    tenant_id: '',
  });
  const [editData, setEditData] = useState({
    name: '',
    email: '',
    password: '',
    phone: '',
    role_id: 0,
  });
  const [filterRole, setFilterRole] = useState('');
  const [filterSearch, setFilterSearch] = useState('');

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
    if (filterSearch.trim()) {
      const q = filterSearch.trim().toLowerCase();
      list = list.filter(
        (u) =>
          (u.name ?? '').toLowerCase().includes(q) ||
          (u.email ?? '').toLowerCase().includes(q)
      );
    }
    return list;
  }, [users, filterRole, filterSearch]);

  const createMutation = useMutation({
    mutationFn: async (data: typeof createData) => {
      const payload: Record<string, unknown> = {
        name: data.name,
        email: data.email,
        password: data.password,
        phone: data.phone || undefined,
        role: data.role,
      };
      if (isSuperAdmin && data.tenant_id) payload.tenant_id = Number(data.tenant_id);
      const response = await apiClient.post('/admin/users', payload);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      setShowCreate(false);
      setCreateData({ name: '', email: '', password: '', phone: '', role: 'cashier', tenant_id: '' });
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
        role_id: data.role_id,
      };
      if (data.password && data.password.trim()) payload.password = data.password.trim();
      return adminService.updateUser(id, payload);
    },
    onSuccess: () => {
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
    const roleId = u.role_id ?? roles?.find((r) => r.slug === u.role)?.id ?? 0;
    setEditData({
      name: u.name ?? '',
      email: u.email ?? '',
      password: '',
      phone: u.phone ?? '',
      role_id: roleId,
    });
  };

  if (isLoading) return <Loader fullScreen text="Loading users..." />;

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Users</h1>
        <Button onClick={() => setShowCreate(true)}>Add User</Button>
      </div>

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div className="min-w-[180px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
            <select
              value={filterRole}
              onChange={(e) => setFilterRole(e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All roles</option>
              {roles?.map((r) => (
                <option key={r.id} value={r.slug}>
                  {r.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex-1 min-w-[200px]">
            <label className="block text-sm font-medium text-gray-700 mb-1">Search</label>
            <input
              type="text"
              value={filterSearch}
              onChange={(e) => setFilterSearch(e.target.value)}
              placeholder="Name or email..."
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
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
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
              <input
                type="tel"
                value={createData.phone}
                onChange={(e) => setCreateData({ ...createData, phone: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={createData.role}
                onChange={(e) => setCreateData({ ...createData, role: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {roles?.length
                  ? roles.map((r) => (
                      <option key={r.id} value={r.slug}>{r.name}</option>
                    ))
                  : (
                      <>
                        <option value="owner">Owner</option>
                        <option value="manager">Manager</option>
                        <option value="branch_manager">Branch Manager</option>
                        <option value="cashier">Cashier</option>
                        <option value="kitchen">Kitchen</option>
                        <option value="rider">Rider</option>
                      </>
                    )}
              </select>
            </div>
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
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role</label>
              <select
                value={editData.role_id}
                onChange={(e) => setEditData({ ...editData, role_id: Number(e.target.value) })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              >
                {roles?.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
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

      <div className="grid gap-4">
        {filteredUsers.length === 0 ? (
          <Card>
            <p className="text-center text-gray-500 py-8">
              {users?.length === 0
                ? 'No users found. Create your first user!'
                : 'No users match the current filters.'}
            </p>
          </Card>
        ) : (
          filteredUsers.map((u) => (
            <Card key={u.id} hover>
              <div className="flex justify-between items-start">
                <div>
                  <h3 className="text-lg font-semibold text-gray-800 mb-1">{u.name}</h3>
                  <div className="text-sm text-gray-600 space-y-1">
                    <p>Email: {u.email}</p>
                    {u.phone && <p>Phone: {u.phone}</p>}
                    <p>
                      Role:{' '}
                      <span className="font-medium text-indigo-600">
                        {u.role ? roleSlugToLabel(u.role) : '—'}
                      </span>
                    </p>
                    <p>
                      Status:{' '}
                      <span
                        className={`font-medium ${
                          u.status === 'active' ? 'text-green-600' : 'text-red-600'
                        }`}
                      >
                        {u.status}
                      </span>
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="small" variant="outline" onClick={() => openEdit(u)}>
                    Edit
                  </Button>
                  <Button
                    size="small"
                    variant="danger"
                    onClick={() => {
                      if (confirm(`Delete user "${u.name}"?`)) deleteMutation.mutate(u.id);
                    }}
                    isLoading={deleteMutation.isPending}
                  >
                    Delete
                  </Button>
                </div>
              </div>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

export default Users;
