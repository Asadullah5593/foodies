import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdEdit, MdOutlineWorkOutline, MdDelete } from 'react-icons/md';
import { Designation, hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import { confirmDialog } from '../../../utils/sweetAlert';
import Loader from '../../../components/Loader';
import Modal from '../../../components/Modal';

const DEPARTMENTS = [
  { value: 'kitchen', label: 'Kitchen' },
  { value: 'front_of_house', label: 'Front of house' },
  { value: 'delivery', label: 'Delivery' },
  { value: 'management', label: 'Management' },
  { value: 'support', label: 'Support' },
] as const;

type DepartmentValue = (typeof DEPARTMENTS)[number]['value'];

const emptyForm = {
  name: '',
  level: 0,
  department: 'support' as DepartmentValue,
  is_active: true,
};

/**
 * Job titles and the promotion ladder.
 *
 * A designation is NOT an RBAC role: most employees never log in, and "Head
 * Chef" has to exist regardless. `level` is what makes a promotion checkable —
 * the server refuses a promotion that doesn't move up.
 */
const Designations: React.FC = () => {
  const queryClient = useQueryClient();
  const canManage = useHasPermission('hr-settings:manage');
  const [showInactive, setShowInactive] = useState(false);
  const [editing, setEditing] = useState<Designation | null>(null);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState<typeof emptyForm>(emptyForm);

  const { data: designations = [], isLoading } = useQuery({
    queryKey: ['hr-designations', showInactive],
    queryFn: () => hrService.listDesignations(showInactive),
  });

  const close = () => {
    setEditing(null);
    setCreating(false);
    setForm(emptyForm);
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      editing
        ? hrService.updateDesignation(editing.id, form)
        : hrService.createDesignation(form),
    onSuccess: () => {
      toast.success(editing ? 'Designation updated' : 'Designation created');
      queryClient.invalidateQueries({ queryKey: ['hr-designations'] });
      close();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not save the designation';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const removeMutation = useMutation({
    mutationFn: (id: number) => hrService.deleteDesignation(id),
    onSuccess: (result) => {
      // Deactivation rather than deletion is the normal outcome once anyone has
      // held the title — say so, or it looks like the delete silently failed.
      toast.success(
        result.deleted ? 'Designation deleted' : result.reason ?? 'Designation deactivated',
      );
      queryClient.invalidateQueries({ queryKey: ['hr-designations'] });
    },
    onError: () => toast.error('Could not remove the designation'),
  });

  const openEdit = (d: Designation) => {
    setEditing(d);
    setForm({ name: d.name, level: d.level, department: d.department, is_active: d.is_active });
  };

  const handleRemove = async (d: Designation) => {
    const ok = await confirmDialog({
      title: `Remove ${d.name}?`,
      text:
        d.employee_count > 0
          ? `${d.employee_count} assignment(s) reference this title, so it will be deactivated rather than deleted — past history stays intact.`
          : 'Nobody holds this title, so it will be deleted.',
      confirmText: 'Remove',
    });
    if (ok) removeMutation.mutate(d.id);
  };

  const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
  const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MdOutlineWorkOutline className="text-2xl text-gray-700 dark:text-gray-200" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Designations</h1>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(e) => setShowInactive(e.target.checked)}
              className="h-4 w-4 rounded border-gray-300"
            />
            Show inactive
          </label>
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setForm(emptyForm);
                setCreating(true);
              }}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              Add designation
            </button>
          )}
        </div>
      </div>

      <p className="mb-4 text-sm text-gray-600 dark:text-gray-400">
        A designation is a job title, not a permission set — most employees never log in. The{' '}
        <strong>level</strong> is the promotion ladder: a promotion must move an employee to a
        higher level, and the server enforces it.
      </p>

      {isLoading ? (
        <Loader />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                {['Title', 'Department', 'Level', 'Employees', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-slate-700 dark:bg-slate-900">
              {designations.map((d) => (
                <tr key={d.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {d.name}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {DEPARTMENTS.find((x) => x.value === d.department)?.label ?? d.department}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">{d.level}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {d.employee_count}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {d.is_active ? (
                      <span className="text-green-600 dark:text-green-400">Active</span>
                    ) : (
                      <span className="text-gray-500">Inactive</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          onClick={() => openEdit(d)}
                          className="text-gray-500 hover:text-blue-600"
                          title="Edit"
                        >
                          <MdEdit />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleRemove(d)}
                          className="text-gray-500 hover:text-red-600"
                          title="Remove"
                        >
                          <MdDelete />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {(creating || editing) && (
        <Modal
          isOpen
          onClose={close}
          title={editing ? `Edit ${editing.name}` : 'Add designation'}
          size="small"
        >
          <div className="space-y-4">
            <div>
              <label className={label}>Title *</label>
              <input
                className={field}
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Head Chef"
              />
            </div>
            <div>
              <label className={label}>Department</label>
              <select
                className={field}
                value={form.department}
                onChange={(e) =>
                  setForm((f) => ({ ...f, department: e.target.value as DepartmentValue }))
                }
              >
                {DEPARTMENTS.map((d) => (
                  <option key={d.value} value={d.value}>
                    {d.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={label}>Level</label>
              <input
                type="number"
                min={0}
                className={field}
                value={form.level}
                onChange={(e) => setForm((f) => ({ ...f, level: Number(e.target.value) }))}
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Higher is more senior. A promotion must move up.
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={form.is_active}
                onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                className="h-4 w-4 rounded border-gray-300"
              />
              Active
            </label>
          </div>

          <div className="mt-6 flex justify-end gap-2">
            <button
              type="button"
              onClick={close}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={form.name.trim().length < 2 || saveMutation.isPending}
              onClick={() => saveMutation.mutate()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saveMutation.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default Designations;
