import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Modal from '../../../components/Modal';
import { rupees } from './Payroll';

interface Props {
  employeeId: number;
}

const tomorrow = () => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * Salary history and revisions.
 *
 * Rendered only for holders of `salary:view` — the whole section is absent
 * otherwise, rather than showing empty rows that read as "no salary on file".
 * A revision closes the current structure and opens a new one, so the history
 * below is the actual audit trail rather than a log of edits.
 */
const EmployeeSalarySection: React.FC<Props> = ({ employeeId }) => {
  const queryClient = useQueryClient();
  const canView = useHasPermission('salary:view');
  const canEdit = useHasPermission('salary:edit');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    effective_from: tomorrow(),
    basic_amount: '' as number | '',
    per_delivered_order_amount: '' as number | '',
    change_reason: '',
  });

  const { data: history = [], isLoading } = useQuery({
    queryKey: ['hr-salary', employeeId],
    queryFn: () => hrService.getSalaryHistory(employeeId),
    enabled: canView,
  });

  const save = useMutation({
    mutationFn: () =>
      hrService.setSalary(employeeId, {
        effective_from: form.effective_from,
        basic_amount: Number(form.basic_amount),
        per_delivered_order_amount:
          form.per_delivered_order_amount === ''
            ? undefined
            : Number(form.per_delivered_order_amount),
        change_reason: form.change_reason.trim() || undefined,
      }),
    onSuccess: () => {
      toast.success('Salary recorded');
      queryClient.invalidateQueries({ queryKey: ['hr-salary', employeeId] });
      queryClient.invalidateQueries({ queryKey: ['hr-employee', employeeId] });
      setShowForm(false);
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not record the salary';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  if (!canView) return null;

  const current = history.find((h) => h.is_current);
  const field =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
  const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4 dark:border-slate-700 dark:bg-slate-900">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700 dark:text-gray-300">
          Salary
        </h2>
        {canEdit && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="text-sm text-blue-600 hover:underline dark:text-blue-400"
          >
            {current ? 'Revise' : 'Set salary'}
          </button>
        )}
      </div>

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading…</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-gray-500 dark:text-gray-400">
          No salary on file — payroll will skip this employee until one is set.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase text-gray-500 dark:text-gray-400">
                <th className="py-2 pr-4">Period</th>
                <th className="py-2 pr-4">Basic</th>
                <th className="py-2 pr-4">Per order</th>
                <th className="py-2 pr-4">Reason</th>
                <th className="py-2 pr-4">Set by</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
              {history.map((h) => (
                <tr key={h.id} className={h.is_current ? 'font-medium' : ''}>
                  <td className="whitespace-nowrap py-2 pr-4 text-gray-700 dark:text-gray-300">
                    {h.effective_from} → {h.effective_to ?? 'present'}
                  </td>
                  <td className="py-2 pr-4">{rupees(h.basic_amount)}</td>
                  <td className="py-2 pr-4">
                    {h.per_delivered_order_amount > 0
                      ? rupees(h.per_delivered_order_amount)
                      : '—'}
                  </td>
                  <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                    {h.change_reason ?? '—'}
                  </td>
                  <td className="py-2 pr-4 text-gray-600 dark:text-gray-400">
                    {h.set_by?.name ?? '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <Modal
          isOpen
          onClose={() => setShowForm(false)}
          title={current ? 'Revise salary' : 'Set salary'}
          size="small"
        >
          {current && (
            <p className="mb-3 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
              The current structure ({rupees(current.basic_amount)} from{' '}
              {current.effective_from}) is closed the day before the new one starts. Nothing is
              overwritten.
            </p>
          )}
          <div className="space-y-3">
            <div>
              <label className={label}>Effective from *</label>
              <input
                type="date"
                className={field}
                value={form.effective_from}
                onChange={(e) =>
                  setForm((f) => ({ ...f, effective_from: e.target.value }))
                }
              />
            </div>
            <div>
              <label className={label}>Basic (monthly) *</label>
              <input
                type="number"
                min={0}
                className={field}
                value={form.basic_amount}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    basic_amount: e.target.value === '' ? '' : Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className={label}>Per delivered order</label>
              <input
                type="number"
                min={0}
                className={field}
                placeholder="Riders only — leave blank otherwise"
                value={form.per_delivered_order_amount}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    per_delivered_order_amount:
                      e.target.value === '' ? '' : Number(e.target.value),
                  }))
                }
              />
            </div>
            <div>
              <label className={label}>Reason</label>
              <input
                className={field}
                placeholder="e.g. annual increment"
                value={form.change_reason}
                onChange={(e) =>
                  setForm((f) => ({ ...f, change_reason: e.target.value }))
                }
              />
            </div>
          </div>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowForm(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={
                form.basic_amount === '' ||
                Number(form.basic_amount) < 0 ||
                save.isPending
              }
              onClick={() => save.mutate()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {save.isPending ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Modal>
      )}
    </section>
  );
};

export default EmployeeSalarySection;
