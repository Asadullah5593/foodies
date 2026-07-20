import React, { useState, useMemo, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import apiClient from '../../utils/apiClient';
import { toast } from 'react-hot-toast';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import {
  Permission,
  Role,
  SUPER_ADMIN_SLUG,
  groupByResource,
  resourceLabel,
} from './roleShared';

/**
 * Full-screen Create / Edit Role page. Permissions are laid out per resource
 * section: section title | "Select all" | stacked permission checkboxes,
 * separated by full-width rules, with the submit button at the bottom right.
 */
const RoleForm: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const isEdit = id != null;
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [name, setName] = useState('');
  const [permissionIds, setPermissionIds] = useState<number[]>([]);

  const { data: permissions, isLoading: permsLoading } = useQuery({
    queryKey: ['permissions'],
    queryFn: async () => {
      const response = await apiClient.get<Permission[]>('/admin/roles/permissions');
      return response.data ?? [];
    },
  });

  const { data: role, isLoading: roleLoading, isError: roleError } = useQuery({
    queryKey: ['role', id],
    queryFn: async () => {
      const response = await apiClient.get<Role>(`/admin/roles/${id}`);
      return response.data;
    },
    enabled: isEdit,
  });

  useEffect(() => {
    if (role) {
      setName(role.name);
      setPermissionIds(role.permissions?.map((p) => p.id) ?? []);
    }
  }, [role]);

  const groupedPermissions = useMemo(
    () => (permissions ? groupByResource(permissions) : new Map<string, Permission[]>()),
    [permissions],
  );

  const sortedResources = useMemo(
    () => Array.from(groupedPermissions.keys()).sort((a, b) => a.localeCompare(b)),
    [groupedPermissions],
  );

  const isViewOnly = role?.slug === SUPER_ADMIN_SLUG;

  const saveMutation = useMutation({
    mutationFn: async (data: { name: string; slug?: string; permission_ids: number[] }) => {
      const response = isEdit
        ? await apiClient.put(`/admin/roles/${id}`, data)
        : await apiClient.post('/admin/roles', data);
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      if (isEdit) queryClient.invalidateQueries({ queryKey: ['role', id] });
      toast.success(isEdit ? 'Role updated' : 'Role created');
      navigate('/admin/roles');
    },
    onError: (error: any) => {
      toast.error(
        error.response?.data?.message || (isEdit ? 'Failed to update role' : 'Failed to create role'),
      );
    },
  });

  const togglePermission = (permissionId: number) => {
    if (isViewOnly) return;
    setPermissionIds((prev) =>
      prev.includes(permissionId)
        ? prev.filter((x) => x !== permissionId)
        : [...prev, permissionId],
    );
  };

  const toggleResource = (resource: string) => {
    if (isViewOnly) return;
    const ids = (groupedPermissions.get(resource) ?? []).map((p) => p.id);
    const allSelected = ids.every((permissionId) => permissionIds.includes(permissionId));
    setPermissionIds((prev) =>
      allSelected
        ? prev.filter((permissionId) => !ids.includes(permissionId))
        : [...new Set([...prev, ...ids])],
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (isViewOnly) return;
    const trimmedName = name.trim();
    if (!trimmedName) {
      toast.error('Role name is required');
      return;
    }
    if (isEdit) {
      saveMutation.mutate({ name: trimmedName, permission_ids: permissionIds });
    } else {
      // Slug is auto-generated from the role name (not shown in the form).
      const slug = trimmedName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      saveMutation.mutate({ name: trimmedName, slug, permission_ids: permissionIds });
    }
  };

  if (permsLoading || (isEdit && roleLoading) || saveMutation.isPending) {
    return <Loader fullScreen text={saveMutation.isPending ? 'Saving...' : 'Loading...'} />;
  }

  if (isEdit && (roleError || !role)) {
    return (
      <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
        <p className="text-gray-500 dark:text-slate-400">Role not found.</p>
        <Button variant="outline" className="mt-4" onClick={() => navigate('/admin/roles')}>
          ← Back to Roles
        </Button>
      </div>
    );
  }

  const pageTitle = isViewOnly ? 'View Role' : isEdit ? 'Edit Role' : 'Create Role';

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex flex-wrap items-center gap-4 mb-6">
        <Button size="small" variant="outline" onClick={() => navigate('/admin/roles')}>
          ← Back
        </Button>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">
            {pageTitle}
          </h1>
          {isViewOnly && (
            <p className="text-xs text-amber-600 mt-1">Super Admin role cannot be edited.</p>
          )}
        </div>
      </div>

      <form onSubmit={handleSubmit}>
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-md border border-gray-200 dark:border-slate-700 overflow-hidden">
          {/* Role name */}
          <div className="px-4 sm:px-8 py-6 border-b border-gray-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-[13rem_minmax(0,1fr)] gap-3 md:gap-6 items-center">
            <label
              htmlFor="role-name"
              className="text-lg font-medium text-gray-800 dark:text-slate-100"
            >
              Role name *
            </label>
            <input
              id="role-name"
              type="text"
              value={name}
              onChange={(e) => !isViewOnly && setName(e.target.value)}
              required
              readOnly={isViewOnly}
              className="w-full max-w-md px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 read-only:bg-gray-100 dark:read-only:bg-slate-700"
              placeholder="e.g. Accountant"
            />
          </div>

          {/* Permission sections: title | select all | permissions */}
          <div className="divide-y divide-gray-200 dark:divide-slate-700">
            {sortedResources.map((resource) => {
              const perms = groupedPermissions.get(resource) ?? [];
              const allSelected = perms.every((p) => permissionIds.includes(p.id));
              const someSelected = perms.some((p) => permissionIds.includes(p.id));
              return (
                <div
                  key={resource}
                  className="px-4 sm:px-8 py-6 grid grid-cols-1 md:grid-cols-[13rem_11rem_minmax(0,1fr)] gap-4 md:gap-6"
                >
                  <h2 className="text-lg font-medium text-gray-800 dark:text-slate-100">
                    {resourceLabel(resource)}
                  </h2>
                  <div>
                    {perms.length > 1 && (
                      <label className="inline-flex items-center gap-3 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected && !allSelected;
                          }}
                          onChange={() => toggleResource(resource)}
                          disabled={isViewOnly}
                          className="h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-[15px] text-slate-600 dark:text-slate-300">
                          Select all
                        </span>
                      </label>
                    )}
                  </div>
                  <div className="space-y-4">
                    {perms.map((p) => (
                      <label
                        key={p.id}
                        title={p.name}
                        className="flex items-start gap-3 cursor-pointer"
                      >
                        <input
                          type="checkbox"
                          checked={permissionIds.includes(p.id)}
                          onChange={() => togglePermission(p.id)}
                          disabled={isViewOnly}
                          className="mt-0.5 h-5 w-5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span className="text-[15px] leading-6 text-slate-600 dark:text-slate-300">
                          {p.description || p.name}
                        </span>
                      </label>
                    ))}
                  </div>
                </div>
              );
            })}
            {sortedResources.length === 0 && (
              <div className="px-4 sm:px-8 py-10 text-center text-gray-500 dark:text-slate-400 text-sm">
                No permissions available.
              </div>
            )}
          </div>

          {/* Submit */}
          {!isViewOnly && (
            <div className="px-4 sm:px-8 py-4 border-t border-gray-200 dark:border-slate-700 flex justify-end">
              <Button type="submit" isLoading={saveMutation.isPending}>
                {isEdit ? 'Update' : 'Create'}
              </Button>
            </div>
          )}
        </div>
      </form>
    </div>
  );
};

export default RoleForm;
