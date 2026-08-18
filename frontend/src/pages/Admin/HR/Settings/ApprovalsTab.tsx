import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdDelete, MdEdit } from 'react-icons/md';
import Loader from '../../../../components/Loader';
import Modal from '../../../../components/Modal';
import SearchableSelect from '../../../../components/SearchableSelect';
import { ApprovalRuleRow, hrService } from '../../../../services/api/hrService';
import { useHasPermission } from '../../../../hooks/useHasPermission';
import {
  EmptyHint,
  ScopeFields,
  TableShell,
  field,
  labelClass,
  mutationError,
  scopeLabel,
  useBranches,
} from './settingsShared';

const RESOURCE = 'approval-rules';

/** Subject → which threshold is meaningful for it. */
const SUBJECTS = [
  { value: 'attendance_waiver', label: 'Waiving a deduction', measure: 'amount' },
  { value: 'leave_request', label: 'Approving leave', measure: 'days' },
  { value: 'overtime', label: 'Confirming overtime', measure: 'minutes' },
  { value: 'payroll_run', label: 'Approving a payroll run', measure: 'amount' },
  { value: 'payroll_adjustment', label: 'Adjusting a payslip', measure: 'amount' },
  { value: 'salary_change', label: 'Changing a salary', measure: 'amount' },
  { value: 'promotion', label: 'Approving a promotion', measure: 'amount' },
] as const;

const PERMISSIONS = [
  { value: 'all-branches:access', label: 'General manager / owner (all branches)' },
  { value: 'payroll:approve', label: 'Payroll approver' },
  { value: 'salary:edit', label: 'Salary editor' },
  { value: 'reviews:approve', label: 'Review approver' },
  { value: 'attendance-waiver:approve', label: 'Waiver approver' },
  { value: 'hr-settings:manage', label: 'HR manager' },
];

const subjectMeta = (s: string) => SUBJECTS.find((x) => x.value === s);

const blank = () => ({
  id: undefined as number | undefined,
  branchId: '' as number | '',
  subject: 'attendance_waiver' as (typeof SUBJECTS)[number]['value'],
  threshold: '' as number | '',
  requiredPermission: 'all-branches:access',
  escalateToPermission: '' as string,
  priority: 0,
});

type Form = ReturnType<typeof blank>;

const conditionOf = (form: Form) => {
  if (form.threshold === '') return {};
  const measure = subjectMeta(form.subject)?.measure;
  const value = Number(form.threshold);
  if (measure === 'days') return { daysGt: value };
  if (measure === 'minutes') return { minutesGt: value };
  return { amountGt: value };
};

const thresholdOf = (r: ApprovalRuleRow): number | '' => {
  const c = r.condition ?? {};
  const v = c.amountGt ?? c.daysGt ?? c.minutesGt;
  return v == null ? '' : Number(v);
};

const describeCondition = (r: ApprovalRuleRow) => {
  const c = r.condition ?? {};
  if (c.amountGt != null) return `over Rs. ${Number(c.amountGt)}`;
  if (c.daysGt != null) return `over ${Number(c.daysGt)} days`;
  if (c.minutesGt != null) return `over ${Number(c.minutesGt)} minutes`;
  return 'always';
};

/**
 * Who has to sign a decision off.
 *
 * A rule only ever ADDS a requirement on top of the permission the endpoint
 * already demands — it cannot grant anyone new powers. That is why an empty list
 * is safe and is exactly how the module behaved before these existed.
 */
const ApprovalsTab: React.FC = () => {
  const queryClient = useQueryClient();
  const canManage = useHasPermission('hr-settings:manage');
  const [editing, setEditing] = useState<Form | null>(null);
  const { data: branches = [] } = useBranches();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-settings', RESOURCE],
    queryFn: () => hrService.settingsList<ApprovalRuleRow>(RESOURCE, true),
  });

  const save = useMutation({
    mutationFn: (form: Form) =>
      hrService.settingsSave(RESOURCE, {
        id: form.id,
        branchId: form.branchId === '' ? null : Number(form.branchId),
        subject: form.subject,
        condition: conditionOf(form),
        requiredPermission: form.requiredPermission,
        escalateToPermission: form.escalateToPermission || null,
        priority: form.priority,
      }),
    onSuccess: () => {
      toast.success('Approval rule saved');
      setEditing(null);
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not save the rule'),
  });

  const remove = useMutation({
    mutationFn: (id: number) => hrService.settingsRemove(RESOURCE, id),
    onSuccess: () => {
      toast.success('Rule deactivated');
      queryClient.invalidateQueries({ queryKey: ['hr-settings', RESOURCE] });
    },
    onError: mutationError('Could not deactivate the rule'),
  });

  const measure = editing ? subjectMeta(editing.subject)?.measure : 'amount';

  return (
    <div>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Extra sign-off above a threshold — &ldquo;a branch manager may waive up to
          2,000; above that needs the GM&rdquo;.
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

      {isLoading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <EmptyHint>
          No approval rules — each action needs only its own permission, which is
          how the module has always worked.
        </EmptyHint>
      ) : (
        <TableShell
          headers={['Decision', 'Applies to', 'When', 'Needs', 'Escalates to', '']}
        >
          {rows.map((r) => (
            <tr key={r.id} className={r.isActive ? '' : 'opacity-50'}>
              <td className="px-3 py-2 text-gray-900 dark:text-gray-100">
                {subjectMeta(r.subject)?.label ?? r.subject}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {scopeLabel(r.branchId, branches)}
              </td>
              <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                {describeCondition(r)}
              </td>
              <td className="px-3 py-2 text-gray-800 dark:text-gray-200">
                {r.requiredPermission}
              </td>
              <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                {r.escalateToPermission ?? '—'}
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
                          subject: r.subject,
                          threshold: thresholdOf(r),
                          requiredPermission: r.requiredPermission,
                          escalateToPermission: r.escalateToPermission ?? '',
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
          title={editing.id ? 'Edit approval rule' : 'New approval rule'}
          size="xlarge"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <label className={labelClass}>Decision *</label>
              <SearchableSelect
                value={editing.subject}
                onChange={(v) =>
                  setEditing({
                    ...editing,
                    subject: v as (typeof SUBJECTS)[number]['value'],
                  })
                }
                options={SUBJECTS.map((s) => ({ value: s.value, label: s.label }))}
                placeholder="Which decision"
                ariaLabel="Decision"
              />
            </div>

            <div>
              <label className={labelClass}>
                Applies above{' '}
                {measure === 'days'
                  ? '(days)'
                  : measure === 'minutes'
                    ? '(minutes)'
                    : '(amount)'}
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={field}
                value={editing.threshold}
                onChange={(e) =>
                  setEditing({
                    ...editing,
                    threshold: e.target.value === '' ? '' : Number(e.target.value),
                  })
                }
                placeholder="Blank applies to every one"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Strictly greater than: a threshold of 2,000 does not catch exactly
                2,000.
              </p>
            </div>

            <ScopeFields
              branchId={editing.branchId}
              onBranch={(v) => setEditing({ ...editing, branchId: v })}
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
            </div>

            <div>
              <label className={labelClass}>Requires permission *</label>
              <SearchableSelect
                value={editing.requiredPermission}
                onChange={(v) =>
                  setEditing({ ...editing, requiredPermission: v })
                }
                options={PERMISSIONS}
                placeholder="Who may approve it"
                searchPlaceholder="Search permissions…"
                ariaLabel="Required permission"
              />
            </div>

            <div>
              <label className={labelClass}>Escalate to</label>
              <SearchableSelect
                value={editing.escalateToPermission}
                onChange={(v) =>
                  setEditing({ ...editing, escalateToPermission: v })
                }
                options={[
                  { value: '', label: 'No escalation named' },
                  ...PERMISSIONS,
                ]}
                placeholder="No escalation named"
                searchPlaceholder="Search permissions…"
                ariaLabel="Escalation permission"
              />
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Named in the refusal, so the person blocked knows who to ask.
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

export default ApprovalsTab;
