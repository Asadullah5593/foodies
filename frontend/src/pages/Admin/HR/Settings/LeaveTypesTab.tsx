import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdEdit } from 'react-icons/md';
import Loader from '../../../../components/Loader';
import Modal from '../../../../components/Modal';
import { hrService, LeaveTypeRow } from '../../../../services/api/hrService';
import { useHasPermission } from '../../../../hooks/useHasPermission';
import {
  EmptyHint,
  TableShell,
  Toggle,
  field,
  labelClass,
  mutationError,
  num,
} from './settingsShared';

const RESOURCE = 'leave-types';

const blank = () => ({
  id: undefined as number | undefined,
  name: '',
  code: '',
  isPaid: true,
  quotaPerPeriod: 0,
  carryForward: false,
  encashUnused: false,
  maxConsecutiveDays: '' as number | '',
  requiresDocument: false,
  isMonthlyOff: false,
  sortOrder: 0,
});

type Form = ReturnType<typeof blank>;

/**
 * Leave types.
 *
 * The client's scope is one type — the 4 monthly offs — and everything else is
 * optional. The monthly-off flag is fixed once created because balances and
 * encashment are computed from exactly one type; moving it would detach what
 * everyone has already accrued.
 */
const LeaveTypesTab: React.FC = () => {
  const queryClient = useQueryClient();
  const canManage = useHasPermission('hr-settings:manage');
  const [editing, setEditing] = useState<Form | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-settings', RESOURCE],
    queryFn: () =>
      hrService.settingsList<LeaveTypeRow>('leave-types/manage', true),
  });

  const save = useMutation({
    mutationFn: (form: Form) =>
      hrService.settingsSave(RESOURCE, {
        id: form.id,
        name: form.name.trim(),
        code: form.code.trim() || undefined,
        isPaid: form.isPaid,
        quotaPerPeriod: form.quotaPerPeriod,
        carryForward: form.carryForward,
        encashUnused: form.encashUnused,
        maxConsecutiveDays:
          form.maxConsecutiveDays === ''
            ? null
            : Number(form.maxConsecutiveDays),
        requiresDocument: form.requiresDocument,
        // Only sent on create: the server refuses to change it afterwards.
        isMonthlyOff: form.id ? undefined : form.isMonthlyOff,
        sortOrder: form.sortOrder,
      }),
    onSuccess: () => {
      toast.success('Leave type saved');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
      queryClient.invalidateQueries({ queryKey: ['hr-leave-types'] });
    },
    onError: mutationError('Could not save the leave type'),
  });

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          What staff can request. The monthly-off type is the one the 4-offs
          entitlement and encashment are computed from.
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing(blank())}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New leave type
          </button>
        )}
      </div>

      {isLoading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyHint>
          No leave types — nobody can request leave, and offs cannot be recorded.
        </EmptyHint>
      ) : (
        <TableShell
          headers={['Name', 'Code', 'Paid', 'Quota', 'Unused', 'Document', '']}
        >
          {rows.map((r) => (
            <tr key={r.id} className={r.isActive ? '' : 'opacity-50'}>
              <td className="px-3 py-2">
                <div className="font-medium text-gray-900 dark:text-gray-100">
                  {r.name}
                </div>
                {r.isMonthlyOff && (
                  <span className="text-xs text-blue-600 dark:text-blue-400">
                    Monthly off
                  </span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.code}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.isPaid ? 'Paid' : 'Unpaid'}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {num(r.quotaPerPeriod) || '—'}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.encashUnused
                  ? 'Encashed'
                  : r.carryForward
                    ? 'Carried forward'
                    : 'Lapse'}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.requiresDocument ? 'Required' : '—'}
              </td>
              <td className="px-3 py-2 text-right">
                {canManage && (
                  <button
                    type="button"
                    onClick={() =>
                      setEditing({
                        id: r.id,
                        name: r.name,
                        code: r.code,
                        isPaid: r.isPaid,
                        quotaPerPeriod: num(r.quotaPerPeriod),
                        carryForward: r.carryForward ?? false,
                        encashUnused: r.encashUnused,
                        maxConsecutiveDays: r.maxConsecutiveDays ?? '',
                        requiresDocument: r.requiresDocument ?? false,
                        isMonthlyOff: r.isMonthlyOff,
                        sortOrder: r.sortOrder ?? 0,
                      })
                    }
                    className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
                    aria-label={`Edit ${r.name}`}
                  >
                    <MdEdit />
                  </button>
                )}
              </td>
            </tr>
          ))}
        </TableShell>
      )}

      {editing && (
        <Modal
          isOpen
          onClose={() => setEditing(null)}
          title={editing.id ? 'Edit leave type' : 'New leave type'}
          size="large"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Name *</label>
              <input
                className={field}
                value={editing.name}
                onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              />
            </div>
            <div>
              <label className={labelClass}>Code</label>
              <input
                className={field}
                value={editing.code}
                disabled={editing.id != null}
                onChange={(e) => setEditing({ ...editing, code: e.target.value })}
                placeholder="Derived from the name"
              />
            </div>

            <div>
              <label className={labelClass}>Quota per month</label>
              <input
                type="number"
                min={0}
                step="0.5"
                className={field}
                value={editing.quotaPerPeriod}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    quotaPerPeriod: Number(e.target.value),
                  })
                }
              />
            </div>
            <div>
              <label className={labelClass}>Maximum consecutive days</label>
              <input
                type="number"
                min={1}
                className={field}
                value={editing.maxConsecutiveDays}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    maxConsecutiveDays:
                      e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
                placeholder="No limit"
              />
            </div>

            <div className="sm:col-span-2 space-y-3">
              <Toggle
                label="Paid leave"
                checked={editing.isPaid}
                onChange={(v) => setEditing({ ...editing, isPaid: v })}
              />
              <Toggle
                label="Unused days are encashed"
                checked={editing.encashUnused}
                onChange={(v) =>
                  setEditing({
                    ...editing,
                    encashUnused: v,
                    carryForward: v ? false : editing.carryForward,
                  })
                }
              />
              <Toggle
                label="Unused days carry forward"
                checked={editing.carryForward}
                onChange={(v) =>
                  setEditing({
                    ...editing,
                    carryForward: v,
                    encashUnused: v ? false : editing.encashUnused,
                  })
                }
              />
              <Toggle
                label="A document is required"
                hint="For example a medical certificate."
                checked={editing.requiresDocument}
                onChange={(v) => setEditing({ ...editing, requiresDocument: v })}
              />
              {editing.id == null && (
                <Toggle
                  label="This is the monthly-off type"
                  hint="Fixed once created — balances and encashment are computed from exactly one type."
                  checked={editing.isMonthlyOff}
                  onChange={(v) => setEditing({ ...editing, isMonthlyOff: v })}
                />
              )}
            </div>
          </div>

          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(null)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={editing.name.trim() === '' || save.isPending}
              onClick={() => save.mutate(editing)}
              className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default LeaveTypesTab;
