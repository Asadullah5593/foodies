import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdArrowBack, MdWarningAmber } from 'react-icons/md';
import { hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import Modal from '../../../components/Modal';
import PayslipModal from './PayslipModal';
import { rupees, STATUS_CLASS } from './Payroll';

/**
 * One payroll run.
 *
 * The preflight panel is deliberately prominent and its blockers are spelled
 * out: unapproved overtime is never paid, so approving past it silently
 * underpays whoever earned it. Approving is possible anyway, but only via an
 * explicit "approve anyway" that records what was accepted.
 */
const PayrollRunDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const runId = Number(id);
  const queryClient = useQueryClient();
  const canRun = useHasPermission('payroll:run');
  const canApprove = useHasPermission('payroll:approve');
  const canReverse = useHasPermission('payroll:reverse');

  const [payslipLineId, setPayslipLineId] = useState<number | null>(null);
  const [showReverse, setShowReverse] = useState(false);
  const [reverseReason, setReverseReason] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['hr-payroll-run', runId] });
    queryClient.invalidateQueries({ queryKey: ['hr-payroll-preflight', runId] });
    queryClient.invalidateQueries({ queryKey: ['hr-payroll-runs'] });
  };

  const onError = (fallback: string) => (err: unknown) => {
    const message =
      (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
        ?.message ?? fallback;
    toast.error(Array.isArray(message) ? message[0] : message);
  };

  const { data: run, isLoading } = useQuery({
    queryKey: ['hr-payroll-run', runId],
    queryFn: () => hrService.getPayrollRun(runId),
    enabled: Number.isFinite(runId),
  });

  const { data: preflight } = useQuery({
    queryKey: ['hr-payroll-preflight', runId],
    queryFn: () => hrService.getPayrollPreflight(runId),
    enabled: Number.isFinite(runId),
  });

  const compute = useMutation({
    mutationFn: (projectFullPeriod: boolean) =>
      hrService.computePayrollRun(runId, projectFullPeriod),
    onSuccess: (result) => {
      toast.success(
        result.projected_full_period
          ? `Projected the full period — ${result.lines} payslip(s)`
          : `Computed to ${result.as_of} — ${result.lines} payslip(s)`,
      );
      if (result.skipped.length > 0) {
        // Skipped employees are a data problem, not a success — name them.
        toast(
          `${result.skipped.length} skipped: ${result.skipped
            .map((s) => `${s.employee} (${s.reason})`)
            .join(', ')}`,
          { icon: '⚠️', duration: 8000 },
        );
      }
      invalidate();
    },
    onError: onError('Could not compute the run'),
  });

  const approve = useMutation({
    mutationFn: (force: boolean) => hrService.approvePayrollRun(runId, force),
    onSuccess: (result) => {
      toast.success('Approved — the attendance period is now locked');
      if (result.exits_settled) {
        toast.success(`${result.exits_settled} exit(s) settled`);
      }
      invalidate();
    },
    onError: onError('Could not approve the run'),
  });

  const reverse = useMutation({
    mutationFn: () => hrService.reversePayrollRun(runId, reverseReason.trim()),
    onSuccess: () => {
      toast.success('Reversed — the attendance period is unlocked again');
      setShowReverse(false);
      setReverseReason('');
      invalidate();
    },
    onError: onError('Could not reverse the run'),
  });

  const markPaid = useMutation({
    mutationFn: () => hrService.markPayrollPaid(runId),
    onSuccess: () => {
      toast.success('Marked paid');
      invalidate();
    },
    onError: onError('Could not mark the run paid'),
  });

  if (isLoading) return <Loader />;
  if (!run) {
    return (
      <div className="p-6">
        <p className="rounded-md bg-red-50 p-4 text-sm text-red-700 dark:bg-red-900/20 dark:text-red-300">
          Could not load this payroll run.
        </p>
      </div>
    );
  }

  const editable = ['draft', 'computed'].includes(run.status);
  const snapshot = (run.rule_snapshot ?? {}) as {
    as_of?: string;
    projected_full_period?: boolean;
  };
  const asOf = snapshot.as_of;
  const projected = snapshot.projected_full_period === true;

  return (
    <div className="p-4 md:p-6">
      <Link
        to="/admin/hr/payroll"
        className="mb-4 inline-flex items-center gap-1 text-sm text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
      >
        <MdArrowBack /> Back to payroll
      </Link>

      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-3">
            <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
              {run.period_from} → {run.period_to}
            </h1>
            <span
              className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[run.status]}`}
            >
              {run.status.replace('_', ' ')}
            </span>
          </div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            {run.lines.length} payslip(s) · gross {rupees(run.totals.gross)} · deductions{' '}
            {rupees(run.totals.deductions)} · net {rupees(run.totals.net)}
          </p>
          {/* Saying WHAT was measured matters: the same run shows very different
              figures earned-to-date versus projected. */}
          {asOf && (
            <p className="mt-1 text-xs font-medium text-blue-700 dark:text-blue-400">
              {projected
                ? 'Projected for the full period — not what has been earned yet'
                : `Earned up to ${asOf}`}
            </p>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          {canRun && editable && (
            <>
              <button
                type="button"
                disabled={compute.isPending}
                onClick={() => compute.mutate(false)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
              >
                {compute.isPending
                  ? 'Computing…'
                  : run.status === 'draft'
                    ? 'Compute earned so far'
                    : 'Recompute earned so far'}
              </button>
              {/* A mid-month run is only ever one of two questions: what has
                  been earned so far, or what will the whole month cost. */}
              <button
                type="button"
                disabled={compute.isPending}
                onClick={() => compute.mutate(true)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
              >
                Project full month
              </button>
            </>
          )}
          {canApprove && run.status === 'computed' && (
            <button
              type="button"
              disabled={approve.isPending}
              onClick={() => approve.mutate(false)}
              className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
            >
              {approve.isPending ? 'Approving…' : 'Approve'}
            </button>
          )}
          {canApprove && run.status === 'approved' && (
            <button
              type="button"
              disabled={markPaid.isPending}
              onClick={() => markPaid.mutate()}
              className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Mark paid
            </button>
          )}
          {canReverse && ['approved', 'paid'].includes(run.status) && (
            <button
              type="button"
              onClick={() => setShowReverse(true)}
              className="rounded-md border border-red-300 px-3 py-2 text-sm text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
            >
              Reverse
            </button>
          )}
        </div>
      </div>

      {preflight && editable && !preflight.ready && (
        <div className="mb-5 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="mb-2 flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <MdWarningAmber className="text-lg" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">
              Not ready to approve
            </h2>
          </div>
          <ul className="list-inside list-disc text-sm text-amber-900 dark:text-amber-200">
            {preflight.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
          {canApprove && run.status === 'computed' && (
            <button
              type="button"
              disabled={approve.isPending}
              onClick={() => approve.mutate(true)}
              className="mt-3 rounded-md border border-amber-500 px-3 py-1.5 text-xs font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50 dark:text-amber-200 dark:hover:bg-amber-900/40"
            >
              Approve anyway (records what was accepted)
            </button>
          )}
        </div>
      )}

      {run.status === 'reversed' && run.reversal_reason && (
        <div className="mb-5 rounded-md bg-red-50 px-4 py-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-300">
          Reversed: {run.reversal_reason}
        </div>
      )}

      {run.lines.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No payslips yet — compute the run.
          </p>
          {/* The commonest reason a computed run is empty: nobody has a salary
              on file. Say where to fix it rather than leaving a blank table. */}
          <p className="mx-auto mt-2 max-w-md text-xs text-gray-500 dark:text-gray-400">
            An employee is skipped until a salary is set for them. Open{' '}
            <Link
              to="/admin/hr/employees"
              className="text-blue-600 hover:underline dark:text-blue-400"
            >
              Employees
            </Link>
            , pick the person, and use the <strong>Salary</strong> section to set their
            basic pay — then recompute.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                {[
                  'Employee',
                  'Present',
                  'Absent',
                  'Leave',
                  'Lates',
                  'OT',
                  'Gross',
                  'Deductions',
                  'Net',
                  '',
                ].map((h) => (
                  <th
                    key={h}
                    className="px-3 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-slate-700 dark:bg-slate-900">
              {run.lines.map((l) => (
                <tr key={l.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-3 text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {l.employee.full_name}
                    </span>
                    <div className="text-xs text-gray-500">{l.employee.employee_code}</div>
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {l.present_days}
                  </td>
                  <td className="px-3 py-3 text-sm">
                    {l.absent_days > 0 ? (
                      <span className="text-red-600 dark:text-red-400">{l.absent_days}</span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {l.paid_leave_days + l.unpaid_leave_days || '—'}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {l.late_count || '—'}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {l.overtime_minutes ? `${l.overtime_minutes}m` : '—'}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {rupees(l.gross_earnings)}
                  </td>
                  <td className="px-3 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {l.total_deductions > 0 ? rupees(l.total_deductions) : '—'}
                  </td>
                  <td className="px-3 py-3 text-sm font-semibold text-gray-900 dark:text-gray-100">
                    {rupees(l.net_payable)}
                  </td>
                  <td className="px-3 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setPayslipLineId(l.id)}
                      className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Payslip
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {payslipLineId != null && (
        <PayslipModal
          lineId={payslipLineId}
          onClose={() => setPayslipLineId(null)}
          onAdjusted={invalidate}
        />
      )}

      {showReverse && (
        <Modal
          isOpen
          onClose={() => setShowReverse(false)}
          title="Reverse this payroll run"
          size="medium"
        >
          <p className="mb-3 rounded-md bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
            This unlocks the attendance period so it can be corrected. The run stays on record
            as reversed — it is never deleted.
          </p>
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Reason *
          </label>
          <textarea
            rows={3}
            className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100"
            value={reverseReason}
            onChange={(e) => setReverseReason(e.target.value)}
            placeholder="e.g. August attendance corrected after approval"
          />
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowReverse(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={reverseReason.trim().length < 3 || reverse.isPending}
              onClick={() => reverse.mutate()}
              className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
            >
              {reverse.isPending ? 'Reversing…' : 'Reverse run'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export default PayrollRunDetail;
