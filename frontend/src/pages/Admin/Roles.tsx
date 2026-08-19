import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../utils/apiClient';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../contexts/AuthContext';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import Modal from '../../components/Modal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { confirmDialog } from '../../utils/sweetAlert';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { useHasPermission } from '../../hooks/useHasPermission';
import {
  Permission,
  Role,
  SUPER_ADMIN_SLUG,
  groupByResource,
  resourceLabel,
} from './roleShared';
import { useSensitivePageView } from '../../hooks/useSensitivePageView';
import RecordHistoryLink from '../../components/RecordHistoryLink';

const isSuperAdmin = (u: { tenant_id?: number | null } | null) => u?.tenant_id == null;

const Roles: React.FC = () => {
  // Opening this screen is itself worth recording — see the hook.
  useSensitivePageView('roles');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { user } = useAuth();
  const canCreate = useHasPermission('roles:create');
  const canEdit = useHasPermission('roles:edit');
  const canDelete = useHasPermission('roles:delete');
  const [showAllPermissions, setShowAllPermissions] = useState(false);
  const [page, setPage] = useState(1);

  /* Super Admin: manage permissions (add / edit / delete) */
  const [showPermissionForm, setShowPermissionForm] = useState(false);
  const [editingPermission, setEditingPermission] = useState<Permission | null>(null);
  const [permissionFormData, setPermissionFormData] = useState({
    name: '',
    resource: '',
    action: '',
    description: '',
  });

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

  const roleList = roles ?? [];
  const paginatedRoles = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return roleList.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [roleList, page]);

  const groupedPermissions = useMemo(
    () => (permissions ? groupByResource(permissions) : new Map<string, Permission[]>()),
    [permissions],
  );

  const sortedResources = useMemo(
    () => Array.from(groupedPermissions.keys()).sort((a, b) => a.localeCompare(b)),
    [groupedPermissions],
  );

  const createPermissionMutation = useMutation({
    mutationFn: async (data: { name: string; resource: string; action: string; description?: string }) => {
      const response = await apiClient.post('/admin/roles/permissions', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] });
      setShowPermissionForm(false);
      setEditingPermission(null);
      setPermissionFormData({ name: '', resource: '', action: '', description: '' });
      toast.success('Permission created');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to create permission');
    },
  });

  const updatePermissionMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: { name?: string; resource?: string; action?: string; description?: string | null } }) => {
      const response = await apiClient.put(`/admin/roles/permissions/${id}`, data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] });
      setShowPermissionForm(false);
      setEditingPermission(null);
      setPermissionFormData({ name: '', resource: '', action: '', description: '' });
      toast.success('Permission updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update permission');
    },
  });

  const deletePermissionMutation = useMutation({
    mutationFn: async (id: number) => {
      await apiClient.delete(`/admin/roles/permissions/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['permissions'] });
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      toast.success('Permission deleted');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to delete permission');
    },
  });

  const openAddPermission = () => {
    setEditingPermission(null);
    setPermissionFormData({ name: '', resource: '', action: '', description: '' });
    setShowPermissionForm(true);
  };

  const openEditPermission = (p: Permission) => {
    setEditingPermission(p);
    setPermissionFormData({
      name: p.name,
      resource: p.resource,
      action: p.action,
      description: p.description ?? '',
    });
    setShowPermissionForm(true);
  };

  const handlePermissionFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const { name, resource, action, description } = permissionFormData;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Permission name is required');
      return;
    }
    if (editingPermission) {
      updatePermissionMutation.mutate({
        id: editingPermission.id,
        data: {
          name: trimmedName,
          resource: resource.trim() || undefined,
          action: action.trim() || undefined,
          description: description.trim() || null,
        },
      });
    } else {
      createPermissionMutation.mutate({
        name: trimmedName,
        resource: (resource || '').trim() || 'other',
        action: (action || '').trim() || 'access',
        description: description.trim() || undefined,
      });
    }
  };

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

  const isSubmitting =
    deleteMutation.isPending ||
    deletePermissionMutation.isPending ||
    createPermissionMutation.isPending ||
    updatePermissionMutation.isPending;
  if (permsLoading || rolesLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-wrap justify-between items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Roles & Permissions</h1>
          <p className="text-gray-500 text-sm mt-1">
            Assign permissions to roles. All system permissions are listed below; new permissions added in the system will appear here automatically.
          </p>
        </div>
        <div className="flex gap-2 flex-wrap">
          {isSuperAdmin(user) && (
            <Button variant="outline" onClick={openAddPermission}>
              Add permission
            </Button>
          )}
          {user?.tenant_id != null && canCreate && (
            <Button onClick={() => navigate('/admin/roles/new')}>Create Role</Button>
          )}
        </div>
      </div>

      {/* Super Admin: Manage permissions */}
      {isSuperAdmin(user) && (
        <Card className="mb-6 overflow-hidden">
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-gray-800">Manage permissions</h2>
            <Button size="small" onClick={openAddPermission}>
              + New permission
            </Button>
          </div>
          <div className="overflow-x-auto max-h-64 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-left text-gray-600 font-medium">
                  <th className="px-4 py-2">Name</th>
                  <th className="px-4 py-2">Resource</th>
                  <th className="px-4 py-2">Action</th>
                  <th className="px-4 py-2">Description</th>
                  <th className="px-4 py-2 w-24">Actions</th>
                </tr>
              </thead>
              <tbody>
                {permissions?.map((p) => (
                  <tr key={p.id} className="border-t border-gray-100 hover:bg-gray-50/50">
                    <td className="px-4 py-2 font-mono text-blue-700">{p.name}</td>
                    <td className="px-4 py-2 text-gray-700">{resourceLabel(p.resource)}</td>
                    <td className="px-4 py-2 text-gray-700">{p.action}</td>
                    <td className="px-4 py-2 text-gray-600 max-w-xs truncate" title={p.description ?? ''}>
                      {p.description || '—'}
                    </td>
                    <td className="px-4 py-2">
                      <div className="flex gap-1">
                        <Button size="small" variant="edit" onClick={() => openEditPermission(p)}>
                          Edit
                        </Button>
                        <Button
                          size="small"
                          variant="danger"
                          onClick={() => {
                            (async () => {
                              const ok = await confirmDialog({
                                title: `Delete permission "${p.name}"?`,
                                text: 'This will remove it from all roles.',
                                confirmText: 'Delete',
                              });
                              if (!ok) return;
                              deletePermissionMutation.mutate(p.id);
                            })();
                          }}
                          isLoading={deletePermissionMutation.isPending}
                        >
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

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

      {/* Add / Edit Permission Modal (Super Admin only) */}
      <Modal
        isOpen={showPermissionForm}
        onClose={() => {
          setShowPermissionForm(false);
          setEditingPermission(null);
          setPermissionFormData({ name: '', resource: '', action: '', description: '' });
        }}
        title={editingPermission ? 'Edit permission' : 'Add permission'}
      >
        <form onSubmit={handlePermissionFormSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name * (e.g. orders:view)</label>
            <input
              type="text"
              value={permissionFormData.name}
              onChange={(e) => setPermissionFormData({ ...permissionFormData, name: e.target.value })}
              required
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 font-mono"
              placeholder="resource:action"
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Resource</label>
              <input
                type="text"
                value={permissionFormData.resource}
                onChange={(e) => setPermissionFormData({ ...permissionFormData, resource: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. orders"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
              <input
                type="text"
                value={permissionFormData.action}
                onChange={(e) => setPermissionFormData({ ...permissionFormData, action: e.target.value })}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. view"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description (optional)</label>
            <input
              type="text"
              value={permissionFormData.description}
              onChange={(e) => setPermissionFormData({ ...permissionFormData, description: e.target.value })}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              placeholder="Short description for admins"
            />
          </div>
          <div className="flex gap-2 justify-end pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                setShowPermissionForm(false);
                setEditingPermission(null);
              }}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={createPermissionMutation.isPending || updatePermissionMutation.isPending}
            >
              {editingPermission ? 'Update permission' : 'Add permission'}
            </Button>
          </div>
        </form>
      </Modal>

      <div className="w-full space-y-3">
        {roleList.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No roles yet. Create a role or run seed for default roles.</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedRoles.map((role, i) => {
                const isSuperAdminRole = role.slug === SUPER_ADMIN_SLUG;
                return (
                  <AccentedListRow
                    key={role.id}
                    accent="active"
                    initial={role.name.charAt(0)}
                    title={role.name}
                    subtitle={<><p className="font-mono text-gray-500 dark:text-slate-400">{role.slug}</p><p>Permissions: {role.permissions?.length ?? 0}</p></>}
                    statusLabel={isSuperAdminRole ? 'System' : undefined}
                    statusVariant="active"
                    animationIndex={i}
                    actions={
                      <>
                        {(isSuperAdminRole || canEdit) && <Button size="small" variant={isSuperAdminRole ? 'view' : 'edit'} onClick={() => navigate(`/admin/roles/${role.id}/edit`)}>{isSuperAdminRole ? 'View' : 'Edit'}</Button>}
                        {/* Renders nothing without activity-log:view. A role's
                            permission history is otherwise unrecoverable —
                            updateRole overwrites the set in place. */}
                        <RecordHistoryLink module="access" entityType="role" entityId={role.id} label={role.name} />
                        {!isSuperAdminRole && canDelete && (
                          <Button
                            size="small"
                            variant="danger"
                            onClick={() => {
                              (async () => {
                                const ok = await confirmDialog({
                                  title: `Delete role "${role.name}"?`,
                                  text: 'This action cannot be undone.',
                                  confirmText: 'Delete',
                                });
                                if (!ok) return;
                                deleteMutation.mutate(role.id);
                              })();
                            }}
                            isLoading={deleteMutation.isPending}
                          >
                            Delete
                          </Button>
                        )}
                      </>
                    }
                  />
                );
              })}
            </AccentedList>
            <PaginationBar totalCount={roleList.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="roles" />
          </>
        )}
      </div>
    </div>
  );
};

export default Roles;
