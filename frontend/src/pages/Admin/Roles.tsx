import React, { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../utils/apiClient';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';

interface Permission {
  id: number;
  name: string;
  resource: string;
  action: string;
  description?: string | null;
}

interface Role {
  id: number;
  name: string;
  slug: string;
  tenant_id?: number | null;
  permissions?: Permission[];
}

function groupByResource(permissions: Permission[]): Map<string, Permission[]> {
  const map = new Map<string, Permission[]>();
  for (const p of permissions) {
    const key = p.resource || 'other';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

function resourceLabel(resource: string): string {
  return resource
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}

const SUPER_ADMIN_SLUG = 'super_admin';

const Roles: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [showForm, setShowForm] = useState(false);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [showAllPermissions, setShowAllPermissions] = useState(false);
  const [formData, setFormData] = useState({ name: '', slug: '', permission_ids: [] as number[] });

  const { data: permissions, isLoading: permsLoading } = useQuery({
    queryKey: ['permissions'],
    queryFn: async () => {
      const response = await apiClient.get<Permission[]>('/admin/roles/permissions');
      return response.data ?? [];
    },
  });

  const { data: roles, isLoading: rolesLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: async () => {
      const response = await apiClient.get<Role[]>('/admin/roles');
      return response.data ?? [];
    },
  });

  const groupedPermissions = useMemo(
    () => (permissions ? groupByResource(permissions) : new Map<string, Permission[]>()),
    [permissions],
  );

  const sortedResources = useMemo(
    () => Array.from(groupedPermissions.keys()).sort((a, b) => a.localeCompare(b)),
    [groupedPermissions],
  );

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; slug: string; permission_ids?: number[] }) => {
      const response = await apiClient.post('/admin/roles', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setShowForm(false);
      setEditingRole(null);
      resetForm();
      toast.success('Role created');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create role');
    },
  });

  const updateMutation = useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: number;
      data: { name?: string; slug?: string; permission_ids?: number[] };
    }) => {
      const response = await apiClient.put(`/admin/roles/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      setShowForm(false);
      setEditingRole(null);
      resetForm();
      toast.success('Role updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update role');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/admin/roles/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Role deleted');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete role');
    },
  });

  const resetForm = () => {
    setFormData({ name: '', slug: '', permission_ids: [] });
  };

  const handleEdit = (role: Role) => {
    setEditingRole(role);
    setFormData({
      name: role.name,
      slug: role.slug,
      permission_ids: role.permissions?.map((p) => p.id) ?? [],
    });
    setShowForm(true);
  };

  const togglePermission = (id: number) => {
    if (editingRole?.slug === SUPER_ADMIN_SLUG) return;
    setFormData((prev) => ({
      ...prev,
      permission_ids: prev.permission_ids.includes(id)
        ? prev.permission_ids.filter((x) => x !== id)
        : [...prev.permission_ids, id],
    }));
  };

  const toggleResource = (resource: string) => {
    if (editingRole?.slug === SUPER_ADMIN_SLUG) return;
    const perms = groupedPermissions.get(resource) ?? [];
    const ids = perms.map((p) => p.id);
    const allSelected = ids.every((id) => formData.permission_ids.includes(id));
    setFormData((prev) => ({
      ...prev,
      permission_ids: allSelected
        ? prev.permission_ids.filter((id) => !ids.includes(id))
        : [...new Set([...prev.permission_ids, ...ids])],
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingRole?.slug === SUPER_ADMIN_SLUG) return;
    if (editingRole) {
      updateMutation.mutate({ id: editingRole.id, data: formData });
    } else {
      createMutation.mutate(formData);
    }
  };

  const isRoleViewOnly = editingRole?.slug === SUPER_ADMIN_SLUG;

  if (permsLoading || rolesLoading) return <Loader fullScreen text="Loading..." />;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Roles & Permissions</h1>
          <p className="text-gray-500 text-sm mt-1">
            Assign permissions to roles. All system permissions are listed below; new permissions added in the system will appear here automatically.
          </p>
        </div>
        {user?.tenant_id != null && (
          <Button
            onClick={() => {
              setEditingRole(null);
              resetForm();
              setShowForm(true);
            }}
          >
            Create Role
          </Button>
        )}
      </div>

      {/* All permissions reference */}
      <Card className="mb-6 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAllPermissions(!showAllPermissions)}
          className="w-full px-4 py-3 flex items-center justify-between text-left font-medium text-gray-800 hover:bg-gray-50 transition-colors"
        >
          <span>All permissions ({permissions?.length ?? 0})</span>
          <span className="text-gray-500 text-sm">
            {showAllPermissions ? '▼ Hide' : '▶ Show'}
          </span>
        </button>
        {showAllPermissions && permissions && permissions.length > 0 && (
          <div className="border-t border-gray-100 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-600 font-medium">
                  <th className="px-4 py-2">Resource</th>
                  <th className="px-4 py-2">Permission (resource:action)</th>
                  <th className="px-4 py-2">Description</th>
                </tr>
              </thead>
              <tbody>
                {sortedResources.flatMap((resource) =>
                  (groupedPermissions.get(resource) ?? []).map((p) => (
                    <tr key={p.id} className="border-t border-gray-50 hover:bg-gray-50/50">
                      <td className="px-4 py-2 font-medium text-gray-700">
                        {resourceLabel(p.resource)}
                      </td>
                      <td className="px-4 py-2 font-mono text-blue-700">{p.name}</td>
                      <td className="px-4 py-2 text-gray-600">
                        {p.description || '—'}
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* Create / Edit Role Modal */}
      <Modal
        isOpen={showForm}
        onClose={() => {
          setShowForm(false);
          setEditingRole(null);
          resetForm();
        }}
        title={editingRole ? 'Edit Role' : 'Create Role'}
        size="large"
      >
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Role name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  !isRoleViewOnly && setFormData({ ...formData, name: e.target.value })
                }
                required
                readOnly={isRoleViewOnly}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 disabled:bg-gray-100"
                placeholder="e.g. Accountant"
              />
              {isRoleViewOnly && (
                <p className="text-xs text-amber-600 mt-1">Super Admin role cannot be edited.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                {editingRole ? 'Slug' : 'Slug *'}
              </label>
              {editingRole ? (
                <p className="px-4 py-2 bg-gray-100 rounded-lg font-mono text-sm">
                  {formData.slug}
                </p>
              ) : (
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      slug: e.target.value
                        .toLowerCase()
                        .replace(/\s+/g, '-')
                        .replace(/[^a-z0-9-]/g, ''),
                    })
                  }
                  required
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g. accountant"
                />
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">
              Permissions — select what this role can do
            </label>
            <div className="max-h-96 overflow-y-auto border border-gray-200 rounded-lg divide-y divide-gray-100">
              {sortedResources.map((resource) => {
                const perms = groupedPermissions.get(resource) ?? [];
                const allSelected = perms.every((p) => formData.permission_ids.includes(p.id));
                const someSelected = perms.some((p) => formData.permission_ids.includes(p.id));
                return (
                  <div key={resource} className="bg-white">
                    <label
                      className={`flex items-center gap-3 px-4 py-3 cursor-pointer font-medium border-b border-gray-100 ${
                        someSelected ? 'bg-indigo-50/50' : 'hover:bg-gray-50'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={allSelected}
                        ref={(el) => {
                          if (el) el.indeterminate = someSelected && !allSelected;
                        }}
                        onChange={() => toggleResource(resource)}
                        disabled={isRoleViewOnly}
                        className="rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                      />
                      <span className="text-gray-800">
                        {resourceLabel(resource)}
                      </span>
                      <span className="text-xs text-gray-500">
                        ({perms.length} permission{perms.length !== 1 ? 's' : ''})
                      </span>
                    </label>
                    <div className="pl-4 pr-4 pb-3 pt-1 space-y-2">
                      {perms.map((p) => (
                        <label
                          key={p.id}
                          className="flex items-start gap-3 cursor-pointer hover:bg-gray-50 p-2 rounded-lg -mx-2"
                        >
                          <input
                            type="checkbox"
                            checked={formData.permission_ids.includes(p.id)}
                            onChange={() => togglePermission(p.id)}
                            disabled={isRoleViewOnly}
                            className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                          <div className="min-w-0">
                            <span className="font-mono text-sm text-blue-700">{p.name}</span>
                            {p.description && (
                              <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
                            )}
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex gap-2 justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowForm(false);
                setEditingRole(null);
                resetForm();
              }}
            >
              {isRoleViewOnly ? 'Close' : 'Cancel'}
            </Button>
            {!isRoleViewOnly && (
              <Button
                type="submit"
                isLoading={createMutation.isPending || updateMutation.isPending}
              >
                {editingRole ? 'Update role' : 'Create role'}
              </Button>
            )}
          </div>
        </form>
      </Modal>

      {/* Role cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {roles && roles.length === 0 ? (
          <Card className="md:col-span-2 lg:col-span-3">
            <p className="text-center text-gray-500 py-8">
              No roles yet. Create a role or run seed for default roles.
            </p>
          </Card>
        ) : (
          roles?.map((role) => {
            const isSuperAdminRole = role.slug === SUPER_ADMIN_SLUG;
            return (
              <Card key={role.id} hover className="flex flex-col">
                <div className="flex justify-between items-start gap-2">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-lg font-semibold text-gray-800">{role.name}</h3>
                      {isSuperAdminRole && (
                        <span className="px-2 py-0.5 text-xs font-medium bg-amber-100 text-amber-800 rounded">
                          System
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 font-mono mt-0.5">{role.slug}</p>
                  </div>
                  <div className="flex gap-2 shrink-0">
                    <Button
                      size="small"
                      variant="outline"
                      onClick={() => handleEdit(role)}
                    >
                      {isSuperAdminRole ? 'View' : 'Edit'}
                    </Button>
                    {!isSuperAdminRole && (
                      <Button
                        size="small"
                        variant="danger"
                        onClick={() => {
                          if (confirm(`Delete role "${role.name}"?`))
                            deleteMutation.mutate(role.id);
                        }}
                        isLoading={deleteMutation.isPending}
                      >
                        Delete
                      </Button>
                    )}
                  </div>
                </div>
                <div className="mt-3 pt-3 border-t border-gray-100">
                  <p className="text-xs font-medium text-gray-500 mb-1.5">
                    Permissions ({role.permissions?.length ?? 0})
                  </p>
                  <div className="flex flex-wrap gap-1">
                    {role.permissions?.length ? (
                      role.permissions.map((p) => (
                        <span
                          key={p.id}
                          className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded text-xs font-mono"
                          title={p.description ?? p.name}
                        >
                          {p.name}
                        </span>
                      ))
                    ) : (
                      <span className="text-gray-400 text-xs">None</span>
                    )}
                  </div>
                </div>
              </Card>
            );
          })
        )}
      </div>
    </div>
  );
};

export default Roles;
