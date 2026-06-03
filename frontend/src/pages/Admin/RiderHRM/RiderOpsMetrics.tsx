import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import Card from '../../../components/Card';
import { adminService } from '../../../services/api/adminService';
import RiderHrmHeader from './RiderHrmHeader';

const RiderOpsMetrics: React.FC = () => {
  const { data: opsMetrics } = useQuery({
    queryKey: ['rider-ops-metrics'],
    queryFn: () => adminService.getRiderOpsMetrics(),
    refetchInterval: 30000,
  });

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Dispatch & Ops Metrics"
        subtitle="Live operational counters for auto-assignment and payroll. Refreshes every 30 seconds."
      />

      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
            Dispatch & Ops Metrics
          </h2>
          <Link to="/admin/orders" className="text-sm text-red-600 dark:text-red-400 hover:underline">
            Check Orders
          </Link>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Auto-assignment success</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100">
              {opsMetrics?.counters?.auto_assignment_success ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">No eligible riders</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100">
              {opsMetrics?.counters?.auto_assignment_no_eligible_riders ?? 0}
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Assignment latency p95</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100">
              {opsMetrics?.samples?.assignment_latency_ms?.p95 ?? 0} ms
            </p>
          </div>
          <div className="rounded-lg border border-gray-200 dark:border-slate-700 p-3">
            <p className="text-xs uppercase tracking-wide text-gray-500 dark:text-slate-400">Payroll reversals</p>
            <p className="text-xl font-bold text-gray-900 dark:text-slate-100">
              {opsMetrics?.counters?.payroll_run_reversal_count ?? 0}
            </p>
          </div>
        </div>
        <div className="mt-4 text-sm text-gray-600 dark:text-slate-300 space-y-1">
          <p>Automatic assignment for a new delivery order requires: branch coordinates + radius, rider HR profile, branch rider role, checked-in status, and fresh rider heartbeat/location.</p>
          <p>For old unassigned orders, use the retry auto-assign action from the Orders page after riders are ready.</p>
        </div>
      </Card>
    </div>
  );
};

export default RiderOpsMetrics;
