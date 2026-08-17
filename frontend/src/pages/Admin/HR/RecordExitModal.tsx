import React, { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Modal from '../../../components/Modal';
import { RecordExitPayload, hrService } from '../../../services/api/hrService';
import SearchableSelect from '../../../components/SearchableSelect';

interface Props {
  employeeId: number;
  employeeName: string;
  dateOfJoining: string;
  onClose: () => void;
}

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Record a resignation or termination.
 *
 * The last working date drives everything: the server closes the assignment on
 * it, and only marks the employee resigned/terminated once it has passed — a
 * future date leaves them on `notice_period` so attendance and payroll keep
 * running while they serve it.
 */
const RecordExitModal: React.FC<Props> = ({
  employeeId,
  employeeName,
  dateOfJoining,
  onClose,
}) => {
  const queryClient = useQueryClient();
  const [form, setForm] = useState({
    exit_type: 'resignation' as RecordExitPayload['exit_type'],
    initiated_on: today(),
    last_working_date: today(),
    notice_period_days: 0,
    reason: '',
    rehire_eligible: true,
  });

  const mutation = useMutation({
    mutationFn: () =>
      hrService.recordExit(employeeId, {
        exit_type: form.exit_type,
        initiated_on: form.initiated_on,
        last_working_date: form.last_working_date,
        notice_period_days: Number(form.notice_period_days) || 0,
        reason: form.reason.trim() || undefined,
        rehire_eligible: form.rehire_eligible,
      }),
    onSuccess: (result) => {
      toast.success(
        result.status === 'notice_period'
          ? `${employeeName} is now serving notice`
          : `Exit recorded for ${employeeName}`,
      );
      queryClient.invalidateQueries({ queryKey: ['hr-employee', employeeId] });
      queryClient.invalidateQueries({ queryKey: ['hr-employee-exit', employeeId] });
      queryClient.invalidateQueries({ queryKey: ['hr-employees'] });
      onClose();
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not record the exit';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const beforeJoining = form.last_working_date < dateOfJoining;
  const isFuture = form.last_working_date > today();

  const field = 'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
  const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <Modal isOpen onClose={onClose} title={`Record exit — ${employeeName}`}>
      <p className="mb-4 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
        This closes the current assignment on the last working day and revokes the attendance PIN.
        Final settlement is calculated with payroll (Phase 4).
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <label className={label}>Type *</label>
          <SearchableSelect
            value={form.exit_type}
            onChange={(v) =>
              setForm((f) => ({
                ...f,
                exit_type: v as RecordExitPayload['exit_type'],
              }))
            }
            options={[
              { value: 'resignation', label: 'Resignation' },
              { value: 'termination', label: 'Termination' },
              { value: 'end_of_contract', label: 'End of contract' },
              { value: 'abandonment', label: 'Abandonment' },
            ]}
          />
        </div>

        <div>
          <label className={label}>Initiated on *</label>
          <input
            type="date"
            className={field}
            value={form.initiated_on}
            onChange={(e) => setForm((f) => ({ ...f, initiated_on: e.target.value }))}
          />
        </div>

        <div>
          <label className={label}>Last working date *</label>
          <input
            type="date"
            className={field}
            value={form.last_working_date}
            onChange={(e) => setForm((f) => ({ ...f, last_working_date: e.target.value }))}
          />
          {beforeJoining && (
            <p className="mt-1 text-xs text-red-600 dark:text-red-400">
              Cannot be before the joining date ({dateOfJoining}).
            </p>
          )}
          {isFuture && !beforeJoining && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
              In the future — the employee stays on notice period and keeps working until then.
            </p>
          )}
        </div>

        <div>
          <label className={label}>Notice period (days)</label>
          <input
            type="number"
            min={0}
            className={field}
            value={form.notice_period_days}
            onChange={(e) =>
              setForm((f) => ({ ...f, notice_period_days: Number(e.target.value) }))
            }
          />
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

        <label className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300 sm:col-span-2">
          <input
            type="checkbox"
            checked={form.rehire_eligible}
            onChange={(e) => setForm((f) => ({ ...f, rehire_eligible: e.target.checked }))}
            className="h-4 w-4 rounded border-gray-300"
          />
          Eligible for rehire
        </label>
      </div>

      <div className="mt-6 flex justify-end gap-2">
        <button
          type="button"
          onClick={onClose}
          className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
        >
          Cancel
        </button>
        <button
          type="button"
          disabled={mutation.isPending || beforeJoining}
          onClick={() => mutation.mutate()}
          className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {mutation.isPending ? 'Saving…' : 'Record exit'}
        </button>
      </div>
    </Modal>
  );
};

export default RecordExitModal;
