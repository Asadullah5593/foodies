import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Modal from '../../../components/Modal';
import SearchableSelect from '../../../components/SearchableSelect';
import { hrService } from '../../../services/api/hrService';
import { rupees } from './Payroll';

interface Props {
  onClose: () => void;
  /** Pre-selects the employee when opened from their 360 page. */
  employeeId?: number;
}

const today = () => new Date().toISOString().slice(0, 10);

const field =
  'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
const labelClass = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

/**
 * Record an advance.
 *
 * The instalment count is shown before saving because that is the part people get
 * wrong: an advance of 30,000 recovered at 5,000 a month is six payslips, and
 * whoever authorises it should see that rather than discover it in December.
 */
const AdvanceModal: React.FC<Props> = ({ onClose, employeeId }) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    employee_id: employeeId ?? ('' as number | ''),
    principal_amount: '' as number | '',
    installment_amount: '' as number | '',
    disbursed_on: today(),
    note: '',
  });

  const { data: employees } = useQuery({
    queryKey: ['hr-employees', { limit: 200 }],
    queryFn: () => hrService.listEmployees({ limit: 200 }),
    enabled: employeeId == null,
  });

  const principal = form.principal_amount === '' ? 0 : Number(form.principal_amount);
  const installment =
    form.installment_amount === '' ? 0 : Number(form.installment_amount);
  // Mirrors the server: ceil, so a remainder is its own final, smaller instalment.
  const installments = installment > 0 ? Math.ceil(principal / installment) : 0;
  const lastInstalment =
    installments > 1 ? principal - installment * (installments - 1) : principal;

  const mutation = useMutation({
    mutationFn: () =>
      hrService.createAdvance({
        employee_id: Number(form.employee_id),
        principal_amount: principal,
        installment_amount: installment,
        disbursed_on: form.disbursed_on || undefined,
        note: form.note.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast.success(
        `Advance recorded — recovered over ${result.installments_total} payroll run(s)`,
      );
      queryClient.invalidateQueries({ queryKey: ['hr-advances'] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not record the advance';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const valid =
    form.employee_id !== '' &&
    principal > 0 &&
    installment > 0 &&
    installment <= principal;

  return (
    <Modal isOpen onClose={onClose} title="Record a salary advance" size="xlarge">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {employeeId == null && (
          <div className="sm:col-span-2">
            <label className={labelClass}>Employee *</label>
            <SearchableSelect
              value={form.employee_id === '' ? '' : String(form.employee_id)}
              onChange={(v) =>
                setForm((f) => ({ ...f, employee_id: v === '' ? '' : Number(v) }))
              }
              options={(employees?.data ?? []).map((e) => ({
                value: String(e.id),
                label: `${e.full_name} (${e.employee_code})`,
              }))}
              placeholder="Select an employee"
              searchPlaceholder="Search by name or code…"
            />
          </div>
        )}

        <div>
          <label className={labelClass}>Amount advanced *</label>
          <input
            type="number"
            min={1}
            step="0.01"
            className={field}
            value={form.principal_amount}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                principal_amount: e.target.value === '' ? '' : Number(e.target.value),
              }))
            }
          />
        </div>

        <div>
          <label className={labelClass}>Monthly instalment *</label>
          <input
            type="number"
            min={1}
            step="0.01"
            className={field}
            value={form.installment_amount}
            onChange={(e) =>
              setForm((f) => ({
                ...f,
                installment_amount: e.target.value === '' ? '' : Number(e.target.value),
              }))
            }
          />
          {installment > principal && principal > 0 && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              An instalment cannot exceed the amount advanced.
            </p>
          )}
        </div>

        <div>
          <label className={labelClass}>Disbursed on</label>
          <input
            type="date"
            className={field}
            value={form.disbursed_on}
            onChange={(e) => setForm((f) => ({ ...f, disbursed_on: e.target.value }))}
          />
        </div>

        <div>
          <label className={labelClass}>Note</label>
          <input
            className={field}
            value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            placeholder="Why it was given"
          />
        </div>

        {installments > 0 && (
          <p className="sm:col-span-2 rounded-md bg-gray-50 p-3 text-sm text-gray-700 dark:bg-slate-800 dark:text-gray-300">
            {installments} instalment{installments === 1 ? '' : 's'} of{' '}
            {rupees(installment)}
            {installments > 1 && lastInstalment !== installment && (
              <> — the last one is {rupees(lastInstalment)}</>
            )}
            . Payroll takes one per approved run, and the whole remaining balance on a
            leaver&apos;s final payslip. It cannot be waived on a payslip.
          </p>
        )}
      </div>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
        >
          {mutation.isPending ? 'Saving…' : 'Record advance'}
        </button>
      </div>
    </Modal>
  );
};

export default AdvanceModal;
