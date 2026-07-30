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
  ceilingFieldValues,
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
  /** Blank = unlimited history. Kept as a string so the field can be cleared. */
  const [historyDays, setHistoryDays] = useState('');
  /**
   * Largest staff discount this role may grant at the till. Blank = no ceiling
   * of that kind; 0 legitimately means "may grant nothing", so both are kept as
   * strings to tell an empty field from a deliberate zero.
   */
  const [maxStaffPercent, setMaxStaffPercent] = useState('');
  const [maxStaffAmount, setMaxStaffAmount] = useState('');

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
      setHistoryDays(role.orderHistoryDays != null ? String(role.orderHistoryDays) : '');
      const ceilings = ceilingFieldValues(role);
      setMaxStaffPercent(ceilings.percent);
      setMaxStaffAmount(ceilings.amount);
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
    mutationFn: async (data: {
      name: string;
      slug?: string;
      permission_ids: number[];
      order_history_days: number | null;
      max_staff_discount_percent: number | null;
      max_staff_discount_amount: number | null;
    }) => {
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
    const trimmedDays = historyDays.trim();
    const parsedDays = trimmedDays === '' ? null : Math.floor(Number(trimmedDays));
    if (parsedDays !== null && (!Number.isFinite(parsedDays) || parsedDays < 1)) {
      toast.error('Order history days must be a whole number of 1 or more (leave blank for unlimited)');
      return;
    }
    const trimmedPct = maxStaffPercent.trim();
    const parsedPct = trimmedPct === '' ? null : Number(trimmedPct);
    if (parsedPct !== null && (!Number.isFinite(parsedPct) || parsedPct < 0 || parsedPct > 100)) {
      toast.error('Staff discount limit must be between 0 and 100% (leave blank for no limit)');
      return;
    }
    const trimmedAmt = maxStaffAmount.trim();
    const parsedAmt = trimmedAmt === '' ? null : Number(trimmedAmt);
    if (parsedAmt !== null && (!Number.isFinite(parsedAmt) || parsedAmt < 0)) {
      toast.error('Staff discount cash limit must be zero or more (leave blank for no limit)');
      return;
    }
    if (isEdit) {
      saveMutation.mutate({
        name: trimmedName,
        permission_ids: permissionIds,
        order_history_days: parsedDays,
        max_staff_discount_percent: parsedPct,
        max_staff_discount_amount: parsedAmt,
      });
    } else {
      // Slug is auto-generated from the role name (not shown in the form).
      const slug = trimmedName
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '');
      saveMutation.mutate({
        name: trimmedName,
        slug,
        permission_ids: permissionIds,
        order_history_days: parsedDays,
        max_staff_discount_percent: parsedPct,
        max_staff_discount_amount: parsedAmt,
      });
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

          {/* Order-history window — a scope limit rather than a permission. */}
          <div className="px-4 sm:px-8 py-6 border-b border-gray-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-[13rem_minmax(0,1fr)] gap-3 md:gap-6 items-start">
            <label
              htmlFor="role-history-days"
              className="text-lg font-medium text-gray-800 dark:text-slate-100 md:pt-2"
            >
              Order history
            </label>
            <div>
              <div className="flex items-center gap-3">
                <input
                  id="role-history-days"
                  type="number"
                  min={1}
                  step={1}
                  value={historyDays}
                  onChange={(e) => !isViewOnly && setHistoryDays(e.target.value)}
                  readOnly={isViewOnly}
                  className="w-32 px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 read-only:bg-gray-100 dark:read-only:bg-slate-700"
                  placeholder="Unlimited"
                />
                <span className="text-[15px] text-slate-600 dark:text-slate-300">
                  days back {historyDays.trim() === '' && '(blank = unlimited)'}
                </span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">
                How far back this role can see orders. Enforced on the server, so the limit
                holds even if the date filter is changed by hand. E.g. 7 for a cashier, 30 for
                a call-centre agent, blank for full history.
              </p>
            </div>
          </div>

          <div className="px-4 sm:px-8 py-6 border-b border-gray-200 dark:border-slate-700 grid grid-cols-1 md:grid-cols-[13rem_minmax(0,1fr)] gap-3 md:gap-6 items-start">
            <label
              htmlFor="role-max-staff-percent"
              className="text-lg font-medium text-gray-800 dark:text-slate-100 md:pt-2"
            >
              Staff discount limit
            </label>
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <input
                  id="role-max-staff-percent"
                  type="number"
                  min={0}
                  max={100}
                  step="0.01"
                  value={maxStaffPercent}
                  onChange={(e) => !isViewOnly && setMaxStaffPercent(e.target.value)}
                  readOnly={isViewOnly}
                  className="w-32 px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 read-only:bg-gray-100 dark:read-only:bg-slate-700"
                  placeholder="No limit"
                />
                <span className="text-[15px] text-slate-600 dark:text-slate-300">% at most</span>
                <input
                  id="role-max-staff-amount"
                  type="number"
                  min={0}
                  step="1"
                  value={maxStaffAmount}
                  onChange={(e) => !isViewOnly && setMaxStaffAmount(e.target.value)}
                  readOnly={isViewOnly}
                  className="w-36 px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 read-only:bg-gray-100 dark:read-only:bg-slate-700"
                  placeholder="No limit"
                />
                <span className="text-[15px] text-slate-600 dark:text-slate-300">Rs. at most</span>
              </div>
              <p className="text-xs text-gray-500 dark:text-slate-400 mt-2">
                The largest give-away this role can grant at the till, from{' '}
                <span className="font-medium">Staff Discounts</span>. The percentage caps
                percentage buttons; the cash figure caps what any button can actually take off,
                which is the only limit that binds a flat &ldquo;Rs. 200 off&rdquo;. Buttons above
                the limit are hidden at the till and refused by the server. E.g. 10% for a
                cashier, 25% for a manager, 100% for a role allowed to comp a whole bill.
                Enter 0 to let this role grant nothing.
              </p>
            </div>
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
