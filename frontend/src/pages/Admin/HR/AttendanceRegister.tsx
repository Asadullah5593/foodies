import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { MdOutlineFactCheck, MdWarningAmber } from 'react-icons/md';
import { hrService, RegisterRow } from '../../../services/api/hrService';
import apiClient from '../../../utils/apiClient';
import Loader from '../../../components/Loader';
import { statusBadgeClass, statusLabel } from './hrShared';

const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Flags are machine keys; these are what a manager should actually read. */
const FLAG_LABELS: Record<string, string> = {
  missing_out: 'No clock-out',
  manager_attested: 'Manager recorded',
  no_schedule: 'No shift set',
  no_photo: 'No photo',
  unclosed_break: 'Break not ended',
  adjusted: 'Corrected',
};

const minutesLabel = (m: number) =>
  m <= 0 ? '—' : `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, '0')}m`;

/**
 * Daily attendance register plus the exceptions report.
 *
 * The exceptions panel is deliberately first: a register nobody audits is just
 * a table, and without a biometric device the flags are the control.
 */
const AttendanceRegister: React.FC = () => {
  const [dateFrom, setDateFrom] = useState(isoDaysAgo(6));
  const [dateTo, setDateTo] = useState(isoDaysAgo(0));
  const [branchId, setBranchId] = useState<number | ''>('');

  const params = useMemo(
    () => ({
      date_from: dateFrom,
      date_to: dateTo,
      branch_id: branchId === '' ? undefined : Number(branchId),
    }),
    [dateFrom, dateTo, branchId],
  );

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ['hr-attendance-register', params],
    queryFn: () => hrService.getRegister(params),
  });

  const { data: report } = useQuery({
    queryKey: ['hr-attendance-exceptions', params],
    queryFn: () => hrService.getExceptionsReport(params),
  });

  const { data: branches = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['hr-branches'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/branches');
      return data ?? [];
    },
  });

  const flagsOf = (row: RegisterRow) =>
    Object.keys(row.flags ?? {}).filter((k) => row.flags[k]);

  const field =
    'rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex items-center gap-2">
        <MdOutlineFactCheck className="text-2xl text-gray-700 dark:text-gray-200" />
        <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
          Attendance register
        </h1>
      </div>

      <div className="mb-5 flex flex-wrap gap-3">
        <input
          type="date"
          className={field}
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
        />
        <input
          type="date"
          className={field}
          value={dateTo}
          onChange={(e) => setDateTo(e.target.value)}
        />
        <select
          className={field}
          value={branchId}
          onChange={(e) => setBranchId(e.target.value === '' ? '' : Number(e.target.value))}
        >
          <option value="">All branches</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </div>

      {report && (report.flagged_days.length > 0 || report.bursts.length > 0) && (
        <div className="mb-6 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div className="mb-2 flex items-center gap-2 text-amber-800 dark:text-amber-300">
            <MdWarningAmber className="text-lg" />
            <h2 className="text-sm font-semibold uppercase tracking-wide">
              Needs attention
            </h2>
          </div>
          <p className="mb-2 text-sm text-amber-900 dark:text-amber-200">
            {report.flagged_days.length} day(s) flagged
            {report.bursts.length > 0 &&
              `, ${report.bursts.length} rapid-punch burst(s)`}
            .
          </p>
          {report.bursts.length > 0 && (
            <ul className="text-xs text-amber-900 dark:text-amber-200">
              {report.bursts.map((b, i) => (
                <li key={`${b.pos_user_id}-${i}`}>
                  {/* Without a terminal registry, this is the buddy-punching
                      signal: one till session punching many people at once. */}
                  {b.punch_count} punches in one minute under till user #
                  {b.pos_user_id} at branch {b.branch_id} ({b.minute})
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {isLoading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No attendance recorded in this range.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                {['Date', 'Employee', 'Status', 'In', 'Out', 'Worked', 'Late', 'OT', 'Flags'].map(
                  (h) => (
                    <th
                      key={h}
                      className="px-4 py-3 text-left text-xs font-medium uppercase tracking-wider text-gray-500 dark:text-gray-400"
                    >
                      {h}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white dark:divide-slate-700 dark:bg-slate-900">
              {rows.map((r) => (
                <tr key={r.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-600 dark:text-gray-400">
                    {r.work_date}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {r.employee.full_name}
                    </span>
                    <div className="text-xs text-gray-500">{r.employee.employee_code}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={statusBadgeClass(r.status)}>{statusLabel(r.status)}</span>
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {r.first_in_at ? new Date(r.first_in_at).toLocaleTimeString() : '—'}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {r.last_out_at ? new Date(r.last_out_at).toLocaleTimeString() : '—'}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {minutesLabel(r.worked_minutes)}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {r.late_minutes > 0 ? (
                      <span className="text-red-600 dark:text-red-400">
                        {r.late_minutes}m
                      </span>
                    ) : (
                      <span className="text-gray-400">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                    {/* Pending OT is reported but never paid until approved. */}
                    {r.overtime_approved > 0
                      ? `${r.overtime_approved}m`
                      : r.overtime_pending > 0
                        ? `${r.overtime_pending}m pending`
                        : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap gap-1">
                      {flagsOf(r).map((f) => (
                        <span
                          key={f}
                          className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-800 dark:bg-amber-900/40 dark:text-amber-300"
                        >
                          {FLAG_LABELS[f] ?? f}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AttendanceRegister;
