import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdDelete, MdEdit, MdInfoOutline } from 'react-icons/md';
import Loader from '../../../../components/Loader';
import Modal from '../../../../components/Modal';
import SearchableSelect from '../../../../components/SearchableSelect';
import { DeductionRuleRow, hrService } from '../../../../services/api/hrService';
import { useHasPermission } from '../../../../hooks/useHasPermission';
import {
  EmptyHint,
  ScopeFields,
  TableShell,
  field,
  labelClass,
  mutationError,
  num,
  scopeLabel,
  useBranches,
  useDesignations,
} from './settingsShared';

const RESOURCE = 'deduction-rules';

const TRIGGERS = [
  { value: 'late', label: 'Late arrival (the ladder)' },
  { value: 'absent', label: 'Absent day' },
  { value: 'half_day', label: 'Half day' },
  { value: 'unapproved_leave', label: 'Unpaid / unapproved leave' },
  { value: 'early_leave', label: 'Left early' },
  { value: 'missed_punch', label: 'Missing clock-out' },
];

const EFFECTS = [
  { value: 'deduct_days', label: 'Deduct days of pay' },
  { value: 'deduct_amount', label: 'Deduct a fixed amount' },
  { value: 'deduct_percent_of_daily', label: 'Deduct a percentage of a day' },
];

const triggerLabel = (t: string) =>
  TRIGGERS.find((x) => x.value === t)?.label ?? t;

const blank = () => ({
  id: undefined as number | undefined,
  branchId: '' as number | '',
  designationId: '' as number | '',
  trigger: 'absent',
  effectType: 'deduct_days',
  effectValue: 1,
  ladder: '0, 0.5, 0.5',
  priority: 0,
});

type Form = ReturnType<typeof blank>;

const parseLadder = (text: string) =>
  text
    .split(',')
    .map((v) => v.trim())
    .filter((v) => v !== '')
    .map(Number);

/**
 * The deduction arithmetic, made visible.
 *
 * Only `deduct_days` rules are read by payroll today — the other two effects are
 * accepted and stored but not yet applied, so they are labelled as such rather
 * than offered as if they worked. A tenant with no rules at all is charged on
 * the shipped defaults, which is why an empty list is not a disabled one.
 */
const DeductionsTab: React.FC = () => {
  const queryClient = useQueryClient();
  const canManage = useHasPermission('hr-settings:manage');
  const [editing, setEditing] = useState<Form | null>(null);
  const { data: branches = [] } = useBranches();
  const { data: designations = [] } = useDesignations();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-settings', RESOURCE],
    queryFn: () => hrService.settingsList<DeductionRuleRow>(RESOURCE, true),
  });

  const save = useMutation({
    mutationFn: (form: Form) =>
      hrService.settingsSave(RESOURCE, {
        id: form.id,
        branchId: form.branchId === '' ? null : Number(form.branchId),
        designationId:
          form.designationId === '' ? null : Number(form.designationId),
        trigger: form.trigger,
        condition:
          form.trigger === 'late' ? { ladder: parseLadder(form.ladder) } : {},
        effectType: form.effectType,
        effectValue: form.trigger === 'late' ? 0 : form.effectValue,
        priority: form.priority,
      }),
    onSuccess: () => {
      toast.success('Deduction rule saved');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not save the rule'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => hrService.settingsRemove(RESOURCE, id),
    onSuccess: () => {
      toast.success('Rule deactivated — the shipped default applies again');
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not deactivate the rule'),
  });

  const describe = (r: DeductionRuleRow) => {
    if (r.trigger === 'late') {
      const ladder = (r.condition?.ladder as number[] | undefined) ?? [];
      const total = ladder.reduce((s, v) => s + Number(v || 0), 0);
      return `${ladder.join(' → ')} days, repeating (${total} per ${ladder.length} lates)`;
    }
    if (r.effectType === 'deduct_days') {
      return `${num(r.effectValue)} day(s) each`;
    }
    if (r.effectType === 'deduct_amount') return `Rs. ${num(r.effectValue)} each`;
    return `${num(r.effectValue)}% of a day each`;
  };

  const designationName = (id: number | null) =>
    id == null
      ? 'Every designation'
      : (designations.find((d) => d.id === id)?.name ?? `#${id}`);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          What each kind of attendance problem costs. Deductions can always be waived
          on a payslip with a reason.
        </p>
        {canManage && (
          <button
            type="button"
            onClick={() => setEditing(blank())}
            className="shrink-0 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New rule
          </button>
        )}
      </div>

      <div className="mb-4 flex items-start gap-2 rounded-md border border-gray-200 bg-gray-50 p-3 text-sm text-gray-700 dark:border-slate-700 dark:bg-slate-800 dark:text-gray-300">
        <MdInfoOutline className="mt-0.5 shrink-0 text-lg" />
        <p>
          Payroll applies <strong>deduct days</strong> rules. Fixed amounts and
          percentages are stored for reference and are not charged yet — use days,
          or waive on the payslip.
        </p>
      </div>

      {isLoading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyHint>
          No rules — payroll uses the shipped defaults: 1st late free, 2nd and 3rd
          half a day each, one day per absence.
        </EmptyHint>
      ) : (
        <TableShell
          headers={['Trigger', 'Applies to', 'Designation', 'Effect', 'Priority', '']}
        >
          {rows.map((r) => (
            <tr key={r.id} className={r.isActive ? '' : 'opacity-50'}>
              <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                {triggerLabel(r.trigger)}
                {!r.isActive && (
                  <span className="ml-1 text-xs text-gray-500">· inactive</span>
                )}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {scopeLabel(r.branchId, branches)}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {designationName(r.designationId)}
              </td>
              <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                {describe(r)}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.priority}
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
                          trigger: r.trigger,
                          effectType: r.effectType,
                          effectValue: num(r.effectValue),
                          ladder:
                            ((r.condition?.ladder as number[] | undefined) ?? [
                              0, 0.5, 0.5,
                            ]).join(', '),
                          priority: r.priority,
                        })
                      }
                      className="rounded p-1 text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-slate-700"
                      aria-label="Edit rule"
                    >
                      <MdEdit />
                    </button>
                    {r.isActive && (
                      <button
                        type="button"
                        onClick={() => remove.mutate(r.id)}
                        className="rounded p-1 text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20"
                        aria-label="Deactivate rule"
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
          title={editing.id ? 'Edit deduction rule' : 'New deduction rule'}
          size="large"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Trigger *</label>
              <SearchableSelect
                value={editing.trigger}
                onChange={(v) => setEditing({ ...editing, trigger: v })}
                options={TRIGGERS}
                placeholder="What causes the deduction"
                ariaLabel="Trigger"
              />
            </div>

            {editing.trigger === 'late' ? (
              <div>
                <label className={labelClass}>Ladder (days per position) *</label>
                <input
                  className={field}
                  value={editing.ladder}
                  onChange={(e) =>
                    setEditing({ ...editing, ladder: e.target.value })
                  }
                  placeholder="0, 0.5, 0.5"
                />
                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                  Repeats: with 0, 0.5, 0.5 the first late is free, the next two
                  cost half a day each, then it restarts. The count resets every
                  payroll period.
                </p>
              </div>
            ) : (
              <>
                <div>
                  <label className={labelClass}>Effect *</label>
                  <SearchableSelect
                    value={editing.effectType}
                    onChange={(v) => setEditing({ ...editing, effectType: v })}
                    options={EFFECTS}
                    placeholder="How much"
                    ariaLabel="Effect"
                  />
                </div>
                <div>
                  <label className={labelClass}>Amount *</label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    className={field}
                    value={editing.effectValue}
                    onChange={(e) =>
                      setEditing({
                        ...editing,
                        effectValue: Number(e.target.value),
                      })
                    }
                  />
                  {editing.effectType !== 'deduct_days' && (
                    <p className="mt-1 text-xs text-amber-600 dark:text-amber-400">
                      Stored, but not applied by payroll yet.
                    </p>
                  )}
                </div>
              </>
            )}

            <ScopeFields
              branchId={editing.branchId}
              designationId={editing.designationId}
              onBranch={(v) => setEditing({ ...editing, branchId: v })}
              onDesignation={(v) => setEditing({ ...editing, designationId: v })}
            />

            <div>
              <label className={labelClass}>Priority</label>
              <input
                type="number"
                className={field}
                value={editing.priority}
                onChange={(e) =>
                  setEditing({ ...editing, priority: Number(e.target.value) })
                }
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Only breaks ties between rules of equal specificity.
              </p>
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
              disabled={
                save.isPending ||
                (editing.trigger === 'late' &&
                  parseLadder(editing.ladder).some((v) => !Number.isFinite(v)))
              }
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

export default DeductionsTab;
