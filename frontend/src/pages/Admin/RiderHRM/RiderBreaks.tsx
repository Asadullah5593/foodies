import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Card from '../../../components/Card';
import { adminService } from '../../../services/api/adminService';
import { RiderBreakSession } from '../../../types';
import RiderHrmHeader from './RiderHrmHeader';
import { inputClass, labelClass, useBranchesById, useBranches, useRiders } from './shared';

const formatDateTime = (value?: string | null) =>
  value ? new Date(value).toLocaleString() : '—';

const durationLabel = (start: string, end?: string | null) => {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : NaN;
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 'open';
  const mins = Math.max(0, Math.round((endMs - startMs) / 60000));
  return `${mins} min`;
};

const RiderBreaks: React.FC = () => {
  const [filters, setFilters] = useState({ rider_user_id: '', from: '', to: '' });

  const { data: riders } = useRiders();
  const { data: branchesList } = useBranches();
  const branchesById = useBranchesById(branchesList);

  const riderUserId = filters.rider_user_id ? Number(filters.rider_user_id) : undefined;

  const { data: breaks, isFetching } = useQuery({
    queryKey: ['rider-breaks', riderUserId, filters.from, filters.to],
    queryFn: () =>
      adminService.getRiderBreaks(riderUserId as number, {
        from: filters.from || undefined,
        to: filters.to || undefined,
      }),
    enabled: riderUserId != null,
  });

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Breaks"
        subtitle="Pause / resume history within rider shifts. Use for attendance audits and payroll adjustments."
      />

      <Card className="dark:bg-slate-800 dark:border-slate-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-gray-800 dark:text-slate-100">
            Break History
          </h2>
          <span className="text-xs text-gray-500 dark:text-slate-400">
            newest first
          </span>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={labelClass}>Rider</label>
            <select
              value={filters.rider_user_id}
              onChange={(e) => setFilters((prev) => ({ ...prev, rider_user_id: e.target.value }))}
              className={inputClass}
            >
              <option value="">Select rider</option>
              {(riders ?? []).map((rider) => (
                <option key={rider.id} value={rider.id}>
                  {rider.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className={labelClass}>From</label>
            <input
              type="date"
              value={filters.from}
              onChange={(e) => setFilters((prev) => ({ ...prev, from: e.target.value }))}
              className={inputClass}
            />
          </div>
          <div>
            <label className={labelClass}>To</label>
            <input
              type="date"
              value={filters.to}
              onChange={(e) => setFilters((prev) => ({ ...prev, to: e.target.value }))}
              className={inputClass}
            />
          </div>
        </div>

        <div className="mt-6 border-t border-gray-200 dark:border-slate-700 pt-4 space-y-3">
          {riderUserId == null ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              Select a rider to view their break history.
            </p>
          ) : isFetching ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">Loading breaks…</p>
          ) : (breaks ?? []).length === 0 ? (
            <p className="text-sm text-gray-500 dark:text-slate-400">
              No breaks recorded for this rider in the selected range.
            </p>
          ) : (
            (breaks ?? []).map((entry: RiderBreakSession) => {
              const branch = entry.branch_id != null ? branchesById.get(entry.branch_id) : undefined;
              return (
                <div
                  key={entry.id}
                  className="rounded-lg border border-gray-200 dark:border-slate-700 p-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div>
                    <p className="font-medium text-gray-900 dark:text-slate-100">
                      {formatDateTime(entry.started_at)} → {formatDateTime(entry.ended_at)}
                    </p>
                    <p className="text-sm text-gray-500 dark:text-slate-400">
                      {branch?.name ?? (entry.branch_id != null ? `Branch #${entry.branch_id}` : 'No branch')}
                      {entry.reason ? ` · ${entry.reason}` : ''}
                    </p>
                  </div>
                  <span
                    className={`text-xs font-medium ${entry.ended_at ? 'text-gray-500 dark:text-slate-400' : 'text-amber-600 dark:text-amber-400'}`}
                  >
                    {entry.ended_at ? durationLabel(entry.started_at, entry.ended_at) : 'on break'}
                  </span>
                </div>
              );
            })
          )}
        </div>
      </Card>
    </div>
  );
};

export default RiderBreaks;
