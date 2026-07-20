import React, { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import { useHasPermission } from '../../../hooks/useHasPermission';
import { adminService } from '../../../services/api/adminService';
import { RiderPayrollRun } from '../../../types';
import { formatCurrency } from '../../../utils/currency';
import RiderHrmHeader from './RiderHrmHeader';
import { inputClass, labelClass, useBranches } from './shared';

const RiderPayroll: React.FC = () => {
  const queryClient = useQueryClient();
  const canRun = useHasPermission('rider-payroll:run');
  const canReverse = useHasPermission('rider-payroll:reverse');

  const [payrollForm, setPayrollForm] = useState({
    from: '',
    to: '',
    branch_id: '',
    timely_minutes: '45',
    expected_monthly_minutes: '12480',
  });

  const { data: branchesList } = useBranches();

  const { data: payrollRuns } = useQuery({
    queryKey: ['rider-payroll-runs'],
    queryFn: () => adminService.getPayrollRuns(),
  });

  const runPayrollMutation = useMutation({
    mutationFn: () =>
      adminService.runPayroll({
        from: payrollForm.from,
        to: payrollForm.to,
        branch_id: payrollForm.branch_id ? Number(payrollForm.branch_id) : undefined,
        timely_minutes: payrollForm.timely_minutes ? Number(payrollForm.timely_minutes) : undefined,
        expected_monthly_minutes: payrollForm.expected_monthly_minutes
          ? Number(payrollForm.expected_monthly_minutes)
          : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-payroll-runs'] });
      toast.success('Payroll run created');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to run payroll');
    },
  });

  const reversePayrollMutation = useMutation({
    mutationFn: (runId: number) => adminService.reversePayrollRun(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['rider-payroll-runs'] });
      toast.success('Payroll run reversed');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to reverse payroll run');
    },
  });

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Payroll Runs"
        subtitle="Combine attendance, completed rides, timely deliveries and ratings against the active compensation plan to produce per-rider payroll for a period. Finalize or reverse."
      />

      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
            Payroll Runs
          </h2>
          <span className="text-xs text-gray-500 dark:text-slate-400">
            custom date range
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelClass}>From</label>
            <input
              type="date"
              value={payrollForm.from}
              onChange={(e) => setPayrollForm((prev) => ({ ...prev, from: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>To</label>
            <input
              type="date"
              value={payrollForm.to}
              onChange={(e) => setPayrollForm((prev) => ({ ...prev, to: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>Branch scope</label>
            <select
              value={payrollForm.branch_id}
              onChange={(e) => setPayrollForm((prev) => ({ ...prev, branch_id: e.target.value }))}
              className={inputClass}
            >
              <option value="">All branches</option>
              {(branchesList ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>Timely minutes</label>
            <input
              type="number"
              value={payrollForm.timely_minutes}
              onChange={(e) =>
                setPayrollForm((prev) => ({ ...prev, timely_minutes: e.target.value }))
              }
              className={inputClass}
            />
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          {canRun && <Button
            variant="primary"
            isLoading={runPayrollMutation.isPending}
            disabled={!payrollForm.from || !payrollForm.to}
            onClick={() => runPayrollMutation.mutate()}
          >
            Run payroll
          </Button>}
        </div>
        <div className="mt-6 border-t border-gray-200 dark:border-slate-700 pt-4 space-y-3">
          {(payrollRuns ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              No payroll runs yet.
            </p>
          ) : (
            (payrollRuns ?? []).map((run: RiderPayrollRun) => (
              <div
                key={run.id}
                className="rounded-lg border border-gray-200 dark:border-slate-700 p-3"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="font-medium text-gray-900 dark:text-slate-100">
                      {run.period_from} to {run.period_to}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-slate-400">
                      {run.rider_count ?? 0} riders · {formatCurrency(Number(run.total_amount ?? 0))}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className={`text-xs font-medium ${run.status === 'finalized' ? 'text-emerald-600 dark:text-emerald-400' : run.status === 'reversed' ? 'text-amber-600 dark:text-amber-400' : 'text-gray-500 dark:text-slate-400'}`}>
                      {run.status}
                    </span>
                    {run.status === 'finalized' && canReverse && (
                      <Button
                        size="small"
                        variant="outline"
                        isLoading={reversePayrollMutation.isPending}
                        onClick={() => reversePayrollMutation.mutate(run.id)}
                      >
                        Reverse
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </Card>
    </div>
  );
};

export default RiderPayroll;
