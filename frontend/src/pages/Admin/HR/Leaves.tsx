import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdEventBusy, MdCheck, MdClose } from 'react-icons/md';
import { hrService, LeaveRequestRow } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import LeaveRequestModal from './LeaveRequestModal';

const STATUS_TABS = ['pending', 'approved', 'rejected', 'cancelled'] as const;

const statusClass = (status: string) => {
  const base = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';
  if (status === 'approved')
    return `${base} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300`;
  if (status === 'pending')
    return `${base} bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300`;
  return `${base} bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-gray-300`;
};

/**
 * Leave requests and approvals.
 *
 * Approving writes leave_paid / leave_unpaid into the attendance register, so
 * the outcome shown here is the same record payroll will read. A request that
 * overruns the balance is part paid and part unpaid rather than refused — days
 * beyond quota are unpaid by policy, and refusing just moves the argument
 * somewhere payroll cannot see it.
 */
const Leaves: React.FC = () => {
  const queryClient = useQueryClient();
  const canApprove = useHasPermission('leaves:approve');
  const canRequest = useHasPermission('leaves:request');
  const [status, setStatus] = useState<(typeof STATUS_TABS)[number]>('pending');
  const [showCreate, setShowCreate] = useState(false);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-leaves', status],
    queryFn: () => hrService.listLeaves({ status }),
  });

  const decide = useMutation({
    mutationFn: ({
      id,
      decision,
    }: {
      id: number;
      decision: 'approved' | 'rejected';
    }) => hrService.decideLeave(id, decision),
    onSuccess: (result) => {
      if (result.status === 'approved') {
        // Surfacing the split matters: "approved" alone hides that some of the
        // days will not be paid.
        toast.success(
          `Approved — ${result.paid_days ?? 0} paid, ${result.unpaid_days ?? 0} unpaid`,
        );
        if (result.locked_days) {
          toast(
            `${result.locked_days} day(s) fell inside an approved payroll period and were left unchanged.`,
            { icon: '🔒' },
          );
        }
      } else {
        toast.success('Request rejected');
      }
      queryClient.invalidateQueries({ queryKey: ['hr-leaves'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not update the request';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const dayRange = (r: LeaveRequestRow) =>
    r.fromDate === r.toDate ? r.fromDate : `${r.fromDate} → ${r.toDate}`;

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MdEventBusy className="text-2xl text-gray-700 dark:text-gray-200" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Leaves</h1>
        </div>
        {canRequest && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New request
          </button>
        )}
      </div>

      <div className="mb-4 flex flex-wrap gap-2">
        {STATUS_TABS.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setStatus(tab)}
            className={`rounded-full px-3 py-1.5 text-sm capitalize ${
              status === tab
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-300'
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      {isLoading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No {status} leave requests.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                {['Employee', 'Type', 'Dates', 'Days', 'Reason', 'Status', ''].map((h) => (
                  <th
                    key={h}
                    className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-slate-700 dark:bg-slate-900">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-4 py-3 text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {r.employee?.fullName ?? '—'}
                    </span>
                    <div className="text-xs text-gray-500">{r.employee?.employeeCode}</div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {r.leaveType?.name ?? '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {dayRange(r)}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {Number(r.totalDays)}
                    {r.status === 'approved' && Number(r.unpaidDays) > 0 && (
                      <div className="text-xs text-amber-600 dark:text-amber-400">
                        {Number(r.paidDays)} paid · {Number(r.unpaidDays)} unpaid
                      </div>
                    )}
                  </td>
                  <td className="max-w-xs truncate px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {r.reason ?? '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={statusClass(r.status)}>{r.status}</span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    {canApprove && r.status === 'pending' && (
                      <div className="flex justify-end gap-2">
                        <button
                          type="button"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: r.id, decision: 'approved' })}
                          className="rounded p-1 text-green-600 hover:bg-green-50 disabled:opacity-40 dark:hover:bg-green-900/20"
                          title="Approve"
                        >
                          <MdCheck />
                        </button>
                        <button
                          type="button"
                          disabled={decide.isPending}
                          onClick={() => decide.mutate({ id: r.id, decision: 'rejected' })}
                          className="rounded p-1 text-red-600 hover:bg-red-50 disabled:opacity-40 dark:hover:bg-red-900/20"
                          title="Reject"
                        >
                          <MdClose />
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && <LeaveRequestModal onClose={() => setShowCreate(false)} />}
    </div>
  );
};

export default Leaves;
