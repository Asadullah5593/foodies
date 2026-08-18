import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdDelete, MdEdit } from 'react-icons/md';
import Loader from '../../../../components/Loader';
import Modal from '../../../../components/Modal';
import SearchableSelect from '../../../../components/SearchableSelect';
import { hrService, OvertimePolicyRow } from '../../../../services/api/hrService';
import { useHasPermission } from '../../../../hooks/useHasPermission';
import {
  EmptyHint,
  ScopeFields,
  TableShell,
  Toggle,
  field,
  labelClass,
  mutationError,
  num,
  scopeLabel,
  useBranches,
  useDesignations,
} from './settingsShared';

const RESOURCE = 'overtime-policies';

const RATE_TYPES = [
  { value: 'multiplier_of_hourly', label: 'Multiple of the hourly rate' },
  { value: 'flat_per_hour', label: 'Flat amount per hour' },
];

const blank = () => ({
  id: undefined as number | undefined,
  branchId: '' as number | '',
  designationId: '' as number | '',
  isEnabled: true,
  minMinutesToQualify: 30,
  roundingMinutes: 15,
  rateType: 'multiplier_of_hourly',
  rateValue: 1.5,
  weeklyOffMultiplier: 2,
  holidayMultiplier: 2,
  dailyCapMinutes: 240 as number | '',
  monthlyCapMinutes: '' as number | '',
  requiresApproval: true,
});

type Form = ReturnType<typeof blank>;

/**
 * Overtime — branch-specific AND role-specific, which is how the client asked
 * for it. A designation rule beats a branch rule beats the tenant default.
 */
const OvertimeTab: React.FC = () => {
  const queryClient = useQueryClient();
  const canManage = useHasPermission('hr-settings:manage');
  const [editing, setEditing] = useState<Form | null>(null);
  const { data: branches = [] } = useBranches();
  const { data: designations = [] } = useDesignations();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-settings', RESOURCE],
    queryFn: () => hrService.settingsList<OvertimePolicyRow>(RESOURCE, true),
  });

  const save = useMutation({
    mutationFn: (form: Form) =>
      hrService.settingsSave(RESOURCE, {
        id: form.id,
        branchId: form.branchId === '' ? null : Number(form.branchId),
        designationId:
          form.designationId === '' ? null : Number(form.designationId),
        isEnabled: form.isEnabled,
        minMinutesToQualify: form.minMinutesToQualify,
        roundingMinutes: form.roundingMinutes,
        rateType: form.rateType,
        rateValue: form.rateValue,
        weeklyOffMultiplier: form.weeklyOffMultiplier,
        holidayMultiplier: form.holidayMultiplier,
        dailyCapMinutes:
          form.dailyCapMinutes === '' ? null : Number(form.dailyCapMinutes),
        monthlyCapMinutes:
          form.monthlyCapMinutes === '' ? null : Number(form.monthlyCapMinutes),
        requiresApproval: form.requiresApproval,
      }),
    onSuccess: () => {
      toast.success('Overtime policy saved');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not save the policy'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => hrService.settingsRemove(RESOURCE, id),
    onSuccess: () => {
      toast.success('Policy deactivated');
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not deactivate the policy'),
  });

  const designationName = (id: number | null) =>
    id == null
      ? 'Every designation'
      : (designations.find((d) => d.id === id)?.name ?? `#${id}`);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Overtime accrues as pending and is paid only once confirmed — these rules
          decide how much it is worth.
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing(blank())}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New policy
          </button>
        )}
      </div>

      {isLoading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyHint>
          No overtime policy — extra hours are recorded but paid at nothing.
        </EmptyHint>
      ) : (
        <TableShell
          headers={[
            'Applies to',
            'Designation',
            'Rate',
            'Off / holiday',
            'Qualifies after',
            'Daily cap',
            'Approval',
            '',
          ]}
        >
          {rows.map((r) => (
            <tr key={r.id} className={r.isActive && r.isEnabled ? '' : 'opacity-50'}>
              <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                {scopeLabel(r.branchId, branches)}
                {!r.isEnabled && (
                  <span className="ml-1 text-xs text-gray-500">· disabled</span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {designationName(r.designationId)}
              </td>
              <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                {r.rateType === 'multiplier_of_hourly'
                  ? `${num(r.rateValue)}× hourly`
                  : `Rs. ${num(r.rateValue)}/hr`}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {num(r.weeklyOffMultiplier)}× / {num(r.holidayMultiplier)}×
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.minMinutesToQualify}m
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.dailyCapMinutes ? `${r.dailyCapMinutes}m` : 'None'}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.requiresApproval ? 'Required' : 'Automatic'}
              </td>
              <td className="px-3 py-2 text-right">
                {canManage && (
                  <div className="flex justify-end gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        setEditing({
                          id: r.id,
                          branchId: r.branchId ?? '',
                          designationId: r.designationId ?? '',
                          isEnabled: r.isEnabled,
                          minMinutesToQualify: r.minMinutesToQualify,
                          roundingMinutes: r.roundingMinutes,
                          rateType: r.rateType,
                          rateValue: num(r.rateValue),
                          weeklyOffMultiplier: num(r.weeklyOffMultiplier),
                          holidayMultiplier: num(r.holidayMultiplier),
                          dailyCapMinutes: r.dailyCapMinutes ?? '',
                          monthlyCapMinutes: r.monthlyCapMinutes ?? '',
                          requiresApproval: r.requiresApproval,
                        })
                      }
                      className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
                      aria-label="Edit policy"
                    >
                      <MdEdit />
                    </button>
                    {r.isActive && (
                      <button
                        type="button"
                        onClick={() => remove.mutate(r.id)}
                        className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        aria-label="Deactivate policy"
                      >
                        <MdDelete />
                      </button>
                    )}
                  </div>
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
          title={editing.id ? 'Edit overtime policy' : 'New overtime policy'}
          size="xlarge"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <ScopeFields
              branchId={editing.branchId}
              designationId={editing.designationId}
              onBranch={(v) => setEditing({ ...editing, branchId: v })}
              onDesignation={(v) => setEditing({ ...editing, designationId: v })}
            />

            <div>
              <label className={labelClass}>Rate type</label>
              <SearchableSelect
                value={editing.rateType}
                onChange={(v) => setEditing({ ...editing, rateType: v })}
                options={RATE_TYPES}
                placeholder="How overtime is priced"
                ariaLabel="Rate type"
              />
            </div>
            <div>
              <label className={labelClass}>
                {editing.rateType === 'multiplier_of_hourly'
                  ? 'Multiplier'
                  : 'Amount per hour'}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={field}
                value={editing.rateValue}
                onChange={(e) =>
                  setEditing({ ...editing, rateValue: Number(e.target.value) })
                }
              />
            </div>

            <div>
              <label className={labelClass}>Day-off multiplier</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={field}
                value={editing.weeklyOffMultiplier}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    weeklyOffMultiplier: Number(e.target.value),
                  })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                What working on a rostered off day is worth.
              </p>
            </div>
            <div>
              <label className={labelClass}>Holiday multiplier</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={field}
                value={editing.holidayMultiplier}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    holidayMultiplier: Number(e.target.value),
                  })
                }
              />
            </div>

            <div>
              <label className={labelClass}>Qualifies after (minutes)</label>
              <input
                type="number"
                min={0}
                className={field}
                value={editing.minMinutesToQualify}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    minMinutesToQualify: Number(e.target.value),
                  })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Staying five minutes late is not overtime.
              </p>
            </div>
            <div>
              <label className={labelClass}>Round to (minutes)</label>
              <input
                type="number"
                min={1}
                className={field}
                value={editing.roundingMinutes}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    roundingMinutes: Number(e.target.value),
                  })
                }
              />
            </div>

            <div>
              <label className={labelClass}>Daily cap (minutes)</label>
              <input
                type="number"
                min={0}
                className={field}
                value={editing.dailyCapMinutes}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    dailyCapMinutes:
                      e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
                placeholder="Blank for none"
              />
            </div>
            <div>
              <label className={labelClass}>Monthly cap (minutes)</label>
              <input
                type="number"
                min={0}
                className={field}
                value={editing.monthlyCapMinutes}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    monthlyCapMinutes:
                      e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
                placeholder="Blank for none"
              />
            </div>

            <div className="sm:col-span-2 space-y-3">
              <Toggle
                label="Overtime is enabled"
                checked={editing.isEnabled}
                onChange={(v) => setEditing({ ...editing, isEnabled: v })}
              />
              <Toggle
                label="A manager must confirm overtime before it is paid"
                hint="Turning this off pays every extra minute automatically."
                checked={editing.requiresApproval}
                onChange={(v) => setEditing({ ...editing, requiresApproval: v })}
              />
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
              disabled={save.isPending}
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

export default OvertimeTab;
