import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { MdPayments } from 'react-icons/md';
import { hrService, PayrollStatus } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import Modal from '../../../components/Modal';

const STATUS_CLASS: Record<PayrollStatus, string> = {
  draft: 'bg-gray-200 text-gray-700 dark:bg-slate-700 dark:text-gray-300',
  computed: 'bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300',
  pending_approval:
    'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300',
  approved: 'bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300',
  paid: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300',
  reversed: 'bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-300',
};

const monthBounds = (yyyyMm: string) => {
  const [y, m] = yyyyMm.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return {
    period_from: `${yyyyMm}-01`,
    period_to: `${yyyyMm}-${String(last).padStart(2, '0')}`,
  };
};

const rupees = (n: number) => `Rs. ${Number(n).toLocaleString('en-US')}`;

/**
 * Payroll runs.
 *
 * A run is a state machine, not a button: draft → computed → approved → paid,
 * with reversal the only way back. Approving locks the attendance period, which
 * is why the detail screen shows the preflight before offering it.
 */
const Payroll: React.FC = () => {
  const queryClient = useQueryClient();
  const canRun = useHasPermission('payroll:run');
  const [showCreate, setShowCreate] = useState(false);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));

  const { data: runs = [], isLoading } = useQuery({
    queryKey: ['hr-payroll-runs'],
    queryFn: () => hrService.listPayrollRuns(),
  });

  const create = useMutation({
    mutationFn: () => hrService.createPayrollRun(monthBounds(month)),
    onSuccess: () => {
      toast.success('Payroll run created — compute it next');
      queryClient.invalidateQueries({ queryKey: ['hr-payroll-runs'] });
      setShowCreate(false);
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not create the run';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const field =
    'w-full rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MdPayments className="text-2xl text-gray-700 dark:text-gray-200" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">Payroll</h1>
        </div>
        {canRun && (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            New run
          </button>
        )}
      </div>

      {isLoading ? (
        <Loader />
      ) : runs.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No payroll runs yet.
            {canRun && ' Create one for a month to get started.'}
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                {['Period', 'Branch', 'Status', 'Computed', 'Approved', ''].map((h) => (
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
              {runs.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="whitespace-nowrap px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                    {r.periodFrom} → {r.periodTo}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {r.branch?.name ?? 'All branches'}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_CLASS[r.status]}`}
                    >
                      {r.status.replace('_', ' ')}
                    </span>
                    {r.status === 'reversed' && r.reversalReason && (
                      <div className="mt-1 max-w-xs text-xs text-gray-500">
                        {r.reversalReason}
                      </div>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {r.computedAt ? new Date(r.computedAt).toLocaleDateString() : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {r.approvedAt
                      ? `${new Date(r.approvedAt).toLocaleDateString()}${r.approver ? ` · ${r.approver.name}` : ''}`
                      : '—'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/admin/hr/payroll/${r.id}`}
                      className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <Modal isOpen onClose={() => setShowCreate(false)} title="New payroll run" size="small">
          <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">
            Month
          </label>
          <input
            type="month"
            className={field}
            value={month}
            onChange={(e) => setMonth(e.target.value)}
          />
          <p className="mt-2 text-xs text-gray-500 dark:text-gray-400">
            Covers {monthBounds(month).period_from} to {monthBounds(month).period_to}. Every
            branch in your scope is included. Nothing is paid until you compute and approve.
          </p>
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setShowCreate(false)}
              className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-800"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={create.isPending}
              onClick={() => create.mutate()}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
            >
              {create.isPending ? 'Creating…' : 'Create run'}
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
};

export { rupees, STATUS_CLASS };
export default Payroll;
