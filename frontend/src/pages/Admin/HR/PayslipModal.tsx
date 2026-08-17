import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Modal from '../../../components/Modal';
import { hrService, PayslipItem } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import { rupees } from './Payroll';

interface Props {
  lineId: number;
  onClose: () => void;
  onAdjusted?: () => void;
}

/** Human-readable rendering of the arithmetic each line carries. */
function explain(item: PayslipItem): string | null {
  const m = item.calc_meta ?? {};
  const parts: string[] = [];

  if (item.component_key === 'late' && m.late_count != null) {
    parts.push(`${m.late_count} late(s) → ${m.days_deducted} day(s)`);
  }
  if (item.component_key === 'absence') {
    const bits: string[] = [];
    if (m.absent_days) bits.push(`${m.absent_days} absent`);
    if (m.half_days) bits.push(`${m.half_days} half day(s)`);
    if (m.unpaid_leave_days) bits.push(`${m.unpaid_leave_days} unpaid leave`);
    if (bits.length) parts.push(bits.join(', '));
  }
  if (item.component_key === 'off_encashment') {
    parts.push(
      `${m.offs_earned ?? m.offs_entitled} earned − ${m.offs_taken} taken${
        m.prorated ? ' (prorated)' : ''
      }`,
    );
  }
  if (item.component_key === 'basic' && m.prorated) {
    parts.push(`${m.employed_days} of ${m.days_in_month} days employed`);
  }
  if (item.component_key === 'overtime' && m.approved_minutes != null) {
    parts.push(`${m.approved_minutes} approved minutes × ${m.multiplier}`);
  }
  if (item.component_key.startsWith('advance_')) {
    parts.push(
      `outstanding ${m.outstanding_before} → ${m.outstanding_after}${
        m.recovered_in_full ? ' (recovered in full)' : ''
      }`,
    );
  }
  if (m.reason) {
    parts.push(`${String(m.reason)}${m.approved_by ? ` — ${String(m.approved_by)}` : ''}`);
  }
  if (m.actor) parts.push(`by ${String(m.actor)}`);

  return parts.length > 0 ? parts.join(' · ') : null;
}

const KIND_STYLE: Record<PayslipItem['kind'], string> = {
  earning: 'text-gray-900 dark:text-gray-100',
  deduction: 'text-red-700 dark:text-red-400',
  waiver: 'text-green-700 dark:text-green-400',
  adjustment: 'text-blue-700 dark:text-blue-400',
};

/**
 * One payslip.
 *
 * Every line shows the arithmetic that produced it, and waivers/adjustments sit
 * beside the deduction they offset rather than being netted into it — so the
 * answer to "why is my salary short" is on the page.
 */
const PayslipModal: React.FC<Props> = ({ lineId, onClose, onAdjusted }) => {
  const queryClient = useQueryClient();
  const canAdjust = useHasPermission('payroll:adjust');
  const [showAdjust, setShowAdjust] = useState(false);
  const [form, setForm] = useState({
    direction: 'waive' as 'waive' | 'add_deduction' | 'add_earning',
    amount: '' as number | '',
    reason: '',
  });

  const { data: slip, isLoading } = useQuery({
    queryKey: ['hr-payslip', lineId],
    queryFn: () => hrService.getPayslip(lineId),
  });

  const adjust = useMutation({
    mutationFn: () =>
      hrService.addPayrollAdjustment(lineId, {
        direction: form.direction,
        amount: Number(form.amount),
        reason: form.reason.trim(),
      }),
    onSuccess: () => {
      toast.success('Adjustment recorded');
      queryClient.invalidateQueries({ queryKey: ['hr-payslip', lineId] });
      onAdjusted?.();
      setShowAdjust(false);
      setForm({ direction: 'waive', amount: '', reason: '' });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not record the adjustment';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const field =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';

  return (
    <Modal isOpen onClose={onClose} title="Payslip" size="large">
      {isLoading || !slip ? (
        <Loader />
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-medium text-gray-900 dark:text-gray-100">
                {slip.employee.full_name}
              </p>
              <p className="text-sm text-gray-500 dark:text-gray-400">
                {slip.employee.employee_code} · {slip.run.period_from} → {slip.run.period_to}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs uppercase text-gray-500">Net payable</p>
              <p className="text-xl font-semibold text-gray-900 dark:text-gray-100">
                {rupees(slip.net_payable)}
              </p>
            </div>
          </div>

          <div className="mb-4 grid grid-cols-3 gap-3 rounded-md bg-gray-50 p-3 text-xs dark:bg-slate-800 sm:grid-cols-6">
            {[
              ['Present', slip.attendance.present_days],
              ['Half', slip.attendance.half_days],
              ['Leave', slip.attendance.paid_leave_days + slip.attendance.unpaid_leave_days],
              ['Absent', slip.attendance.absent_days],
              ['Lates', slip.attendance.late_count],
              ['OT (min)', slip.attendance.overtime_minutes],
            ].map(([label, value]) => (
              <div key={String(label)}>
                <dt className="uppercase text-gray-500 dark:text-gray-400">{label}</dt>
                <dd className="text-sm font-medium text-gray-900 dark:text-gray-100">
                  {value}
                </dd>
              </div>
            ))}
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
            <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
              <tbody className="divide-y divide-gray-100 dark:divide-slate-700">
                {slip.items.map((i, idx) => (
                  <tr key={`${i.component_key}-${idx}`}>
                    <td className="px-3 py-2">
                      <span className={KIND_STYLE[i.kind]}>{i.component_name}</span>
                      {explain(i) && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {explain(i)}
                        </div>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">
                      <span className={KIND_STYLE[i.kind]}>
                        {i.kind === 'deduction' ? '−' : i.kind === 'earning' ? '' : '+'}
                        {rupees(i.amount)}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="bg-gray-50 dark:bg-slate-800">
                <tr>
                  <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
                    Gross earnings
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {rupees(slip.gross_earnings)}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-medium text-gray-700 dark:text-gray-300">
                    Total deductions
                  </td>
                  <td className="px-3 py-2 text-right font-medium">
                    {rupees(slip.total_deductions)}
                  </td>
                </tr>
                <tr>
                  <td className="px-3 py-2 font-semibold text-gray-900 dark:text-gray-100">
                    Net payable
                  </td>
                  <td className="px-3 py-2 text-right font-semibold">
                    {rupees(slip.net_payable)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          <div className="mt-4 flex flex-wrap justify-between gap-2">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
            >
              Print
            </button>
            {canAdjust && slip.run.status !== 'reversed' && !showAdjust && (
              <button
                type="button"
                onClick={() => setShowAdjust(true)}
                className="rounded-md border border-blue-300 px-3 py-2 text-sm text-blue-700 hover:bg-blue-50 dark:border-blue-800 dark:text-blue-400 dark:hover:bg-blue-900/20"
              >
                Waive or add a deduction
              </button>
            )}
          </div>

          {showAdjust && (
            <div className="mt-4 rounded-lg border border-gray-200 p-4 dark:border-slate-700">
              <p className="mb-3 text-xs text-gray-500 dark:text-gray-400">
                This never edits a computed figure — it adds its own line, so the original
                stays visible beside your override. A reason is mandatory.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <select
                  className={field}
                  value={form.direction}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      direction: e.target.value as typeof f.direction,
                    }))
                  }
                >
                  <option value="waive">Waive a deduction</option>
                  <option value="add_deduction">Add a deduction</option>
                  <option value="add_earning">Add a payment</option>
                </select>
                <input
                  type="number"
                  min={0.01}
                  step="0.01"
                  className={field}
                  placeholder="Amount"
                  value={form.amount}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      amount: e.target.value === '' ? '' : Number(e.target.value),
                    }))
                  }
                />
                <input
                  className={field}
                  placeholder="Reason (required)"
                  value={form.reason}
                  onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))}
                />
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAdjust(false)}
                  className="rounded-md border border-gray-300 px-3 py-1.5 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={
                    form.amount === '' ||
                    Number(form.amount) <= 0 ||
                    form.reason.trim().length < 3 ||
                    adjust.isPending
                  }
                  onClick={() => adjust.mutate()}
                  className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {adjust.isPending ? 'Saving…' : 'Record adjustment'}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </Modal>
  );
};

export default PayslipModal;
