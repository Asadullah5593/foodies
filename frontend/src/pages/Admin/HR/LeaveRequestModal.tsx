import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Modal from '../../../components/Modal';
import { hrService } from '../../../services/api/hrService';
import SearchableSelect from '../../../components/SearchableSelect';

interface Props {
  onClose: () => void;
  /** Pre-selects the employee when opened from their 360 page. */
  employeeId?: number;
}

const today = () => new Date().toISOString().slice(0, 10);

const LeaveRequestModal: React.FC<Props> = ({ onClose, employeeId }) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    employee_id: employeeId ?? ('' as number | ''),
    leave_type_id: '' as number | '',
    from_date: today(),
    to_date: today(),
    reason: '',
  });

  const { data: employees } = useQuery({
    queryKey: ['hr-employees', { limit: 200 }],
    queryFn: () => hrService.listEmployees({ limit: 200 }),
    enabled: employeeId == null,
  });

  const { data: types = [] } = useQuery({
    queryKey: ['hr-leave-types'],
    queryFn: () => hrService.listLeaveTypes(),
  });

  const selectedEmployee = form.employee_id === '' ? null : Number(form.employee_id);

  // Balances are shown live so the requester can see, before submitting, that
  // part of the request will land as unpaid.
  const { data: balances = [] } = useQuery({
    queryKey: ['hr-leave-balances', selectedEmployee],
    queryFn: () => hrService.getLeaveBalances(selectedEmployee as number),
    enabled: selectedEmployee != null,
  });

  const selectedBalance = balances.find(
    (b) => b.leave_type_id === Number(form.leave_type_id),
  );

  const mutation = useMutation({
    mutationFn: () =>
      hrService.createLeave({
        employee_id: Number(form.employee_id),
        leave_type_id: Number(form.leave_type_id),
        from_date: form.from_date,
        to_date: form.to_date,
        reason: form.reason.trim() || undefined,
      }),
    onSuccess: (result) => {
      toast.success(`Request created — ${result.total_days} chargeable day(s)`);
      queryClient.invalidateQueries({ queryKey: ['hr-leaves'] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not create the request';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const valid =
    form.employee_id !== '' &&
    form.leave_type_id !== '' &&
    form.from_date <= form.to_date;

  const field =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
  const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <Modal isOpen onClose={onClose} title="New leave request">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {employeeId == null && (
          <div className="sm:col-span-2">
            <label className={label}>Employee *</label>
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

        <div className="sm:col-span-2">
          <label className={label}>Leave type *</label>
          <SearchableSelect
            value={form.leave_type_id === '' ? '' : String(form.leave_type_id)}
            onChange={(v) =>
              setForm((f) => ({ ...f, leave_type_id: v === '' ? '' : Number(v) }))
            }
            options={types.map((t) => ({ value: String(t.id), label: t.name }))}
            placeholder="Select a type"
          />
          {selectedBalance && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              {selectedBalance.available} day(s) available this month
              {selectedBalance.available <= 0 &&
                ' — further days will be recorded as unpaid'}
              {selectedBalance.is_monthly_off &&
                selectedBalance.encash_unused &&
                '. Unused offs are encashed at payroll.'}
            </p>
          )}
        </div>

        <div>
          <label className={label}>From *</label>
          <input
            type="date"
            className={field}
            value={form.from_date}
            onChange={(e) => setForm((f) => ({ ...f, from_date: e.target.value }))}
          />
        </div>

        <div>
          <label className={label}>To *</label>
          <input
            type="date"
            className={field}
            value={form.to_date}
            onChange={(e) => setForm((f) => ({ ...f, to_date: e.target.value }))}
          />
          {form.to_date < form.from_date && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              The end date cannot be before the start date.
            </p>
          )}
        </div>

        <div className="sm:col-span-2">
          <label className={label}>Reason</label>
          <textarea
            className={field}
            rows={2}
            value={form.reason}
            onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
          />
        </div>
      </div>

      <p className="mt-4 rounded-md bg-blue-50 px-3 py-2 text-xs text-blue-800 dark:bg-blue-900/20 dark:text-blue-300">
        Weekly offs and public holidays inside the range are not charged against
        entitlement.
      </p>

      <div className="mt-5 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={!valid || mutation.isPending}
          onClick={() => mutation.mutate()}
          className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Create request'}
        </button>
      </div>
    </Modal>
  );
};

export default LeaveRequestModal;
