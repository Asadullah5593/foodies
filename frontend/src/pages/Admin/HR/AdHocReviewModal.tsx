import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import Modal from '../../../components/Modal';
import SearchableSelect from '../../../components/SearchableSelect';
import { hrService } from '../../../services/api/hrService';

interface Props {
  onClose: () => void;
  /** Pre-selects the employee when opened from their 360 page. */
  employeeId?: number;
}

const REASONS = [
  { value: 'promotion_consideration', label: 'Promotion consideration' },
  { value: 'performance_concern', label: 'Performance concern' },
  { value: 'post_training_assessment', label: 'Post-training assessment' },
  { value: 'disciplinary', label: 'Disciplinary' },
  { value: 'pre_exit', label: 'Pre-exit' },
];

const inTwoWeeks = () =>
  new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);

/**
 * Raise a review outside the fixed cadence.
 *
 * The wording here is deliberate: this is an ADDITION, not a replacement. The
 * server records it with origin=manual and the scheduler never reads those
 * rows, so the next scheduled review still falls due when it always would have.
 */
const AdHocReviewModal: React.FC<Props> = ({ onClose, employeeId }) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [form, setForm] = useState({
    employee_id: employeeId ?? ('' as number | ''),
    ad_hoc_reason: '',
    due_date: inTwoWeeks(),
  });

  const { data: employees } = useQuery({
    queryKey: ['hr-employees', { limit: 200 }],
    queryFn: () => hrService.listEmployees({ limit: 200 }),
    enabled: employeeId == null,
  });

  const mutation = useMutation({
    mutationFn: () =>
      hrService.createAdHocReview({
        employee_id: Number(form.employee_id),
        ad_hoc_reason: form.ad_hoc_reason,
        due_date: form.due_date,
      }),
    onSuccess: (result) => {
      toast.success('Review raised — the scheduled cadence is unchanged');
      queryClient.invalidateQueries({ queryKey: ['hr-review-cycles'] });
      onClose();
      navigate(`/admin/hr/reviews/${result.id}`);
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not raise the review';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const valid = form.employee_id !== '' && form.ad_hoc_reason !== '' && !!form.due_date;

  const field =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';
  const label = 'mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300';

  return (
    <Modal isOpen onClose={onClose} title="Start a review" size="large">
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

        <div>
          <label className={label}>Reason *</label>
          <SearchableSelect
            value={form.ad_hoc_reason}
            onChange={(v) => setForm((f) => ({ ...f, ad_hoc_reason: v }))}
            options={REASONS}
            placeholder="Why now?"
          />
        </div>

        <div>
          <label className={label}>Due by *</label>
          <input
            type="date"
            className={field}
            value={form.due_date}
            onChange={(e) => setForm((f) => ({ ...f, due_date: e.target.value }))}
          />
        </div>

        <p className="sm:col-span-2 rounded-md bg-gray-50 p-3 text-xs text-gray-600 dark:bg-slate-800 dark:text-gray-400">
          This is an extra review, not a replacement. The employee&apos;s scheduled 3-monthly
          review still falls due on its own date, and this one carries the same weight when
          its outcome is approved.
        </p>
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
          {mutation.isPending ? 'Raising…' : 'Raise review'}
        </button>
      </div>
    </Modal>
  );
};

export default AdHocReviewModal;
