import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdOutlineAccountBalanceWallet } from 'react-icons/md';
import { AdvanceRow, hrService } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import AdvanceModal from './AdvanceModal';
import { rupees } from './Payroll';

const badge = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';

export const advanceStatusClass = (status: string) => {
  if (status === 'active')
    return `${badge} bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300`;
  if (status === 'settled')
    return `${badge} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300`;
  return `${badge} bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-gray-300`;
};

export const advanceStatusLabel = (status: string) =>
  status === 'written_off' ? 'Written off' : status.charAt(0).toUpperCase() + status.slice(1);

/** Decimals arrive as strings from TypeORM. */
export const num = (v: string | number | null | undefined) => Number(v ?? 0);

/**
 * Salary advances.
 *
 * Recovery is automatic — payroll takes one instalment per approved run and the
 * whole outstanding balance on a leaver's final payslip. Nothing on this screen
 * deducts anything; it records the advance and lets someone write off what will
 * never come back. A write-off is a decision recorded here rather than a payslip
 * waiver, because forgiving it inside payroll would hide that real money was
 * given up.
 */
const Advances: React.FC = () => {
  const queryClient = useQueryClient();
  const canAdjust = useHasPermission('payroll:adjust');
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'active' | 'all'>('active');

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-advances'],
    queryFn: () => hrService.listAdvances(),
  });

  const writeOff = useMutation({
    mutationFn: ({ id, reason }: { id: number; reason: string }) =>
      hrService.writeOffAdvance(id, reason),
    onSuccess: () => {
      toast.success('Written off — the balance will no longer be recovered');
      queryClient.invalidateQueries({ queryKey: ['hr-advances'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not write off the advance';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const visible = useMemo(
    () => (statusFilter === 'all' ? rows : rows.filter((r) => r.status === 'active')),
    [rows, statusFilter],
  );

  const outstanding = rows
    .filter((r) => r.status === 'active')
    .reduce((sum, r) => sum + num(r.outstandingAmount), 0);

  const onWriteOff = (row: AdvanceRow) => {
    const reason = window.prompt(
      `Write off ${rupees(num(row.outstandingAmount))} outstanding for ${
        row.employee?.fullName ?? 'this employee'
      }? Give a reason — it is recorded on the audit trail.`,
    );
    if (!reason || reason.trim().length < 3) return;
    writeOff.mutate({ id: row.id, reason: reason.trim() });
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MdOutlineAccountBalanceWallet className="text-2xl text-gray-700 dark:text-gray-200" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Salary advances
          </h1>
        </div>
        {canAdjust && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Record an advance
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div className="flex gap-2">
          {(['active', 'all'] as const).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setStatusFilter(f)}
              className={`rounded-full px-3 py-1.5 text-sm capitalize ${
                statusFilter === f
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-300'
              }`}
            >
              {f}
            </button>
          ))}
        </div>
        <p className="text-sm text-gray-600 dark:text-gray-400">
          Outstanding across active advances:{' '}
          <span className="font-semibold text-gray-900 dark:text-gray-100">
            {rupees(outstanding)}
          </span>
        </p>
      </div>

      {isLoading ? (
        <Loader />
      ) : visible.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            {statusFilter === 'active'
              ? 'No advances are being recovered right now.'
              : 'No advances recorded.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Disbursed</th>
                <th className="px-3 py-2 text-right">Principal</th>
                <th className="px-3 py-2 text-right">Instalment</th>
                <th className="px-3 py-2">Recovered</th>
                <th className="px-3 py-2 text-right">Outstanding</th>
                <th className="px-3 py-2">Status</th>
                {canAdjust && <th className="px-3 py-2 text-right">Action</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
              {visible.map((r, i) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">{i + 1}</td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {r.employee?.fullName ?? '—'}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {r.employee?.employeeCode}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    {r.disbursedOn ?? '—'}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200">
                    {rupees(num(r.principalAmount))}
                  </td>
                  <td className="px-3 py-2 text-right text-gray-800 dark:text-gray-200">
                    {rupees(num(r.installmentAmount))}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                    {r.installmentsPaid} of {r.installmentsTotal}
                  </td>
                  <td className="px-3 py-2 text-right font-medium text-gray-900 dark:text-gray-100">
                    {rupees(num(r.outstandingAmount))}
                  </td>
                  <td className="px-3 py-2">
                    <span className={advanceStatusClass(r.status)}>
                      {advanceStatusLabel(r.status)}
                    </span>
                    {r.note && (
                      <div className="mt-1 max-w-[16rem] text-xs text-gray-500 dark:text-gray-400">
                        {r.note}
                      </div>
                    )}
                  </td>
                  {canAdjust && (
                    <td className="px-3 py-2 text-right">
                      {r.status === 'active' && (
                        <button
                          type="button"
                          onClick={() => onWriteOff(r)}
                          disabled={writeOff.isPending}
                          className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-400 dark:hover:bg-red-900/20"
                        >
                          Write off
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <AdvanceModal onClose={() => setShowCreate(false)} />}
    </div>
  );
};

export default Advances;
