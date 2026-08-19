import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  keepPreviousData,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { MdOutlineFactCheck, MdWarningAmber } from 'react-icons/md';
import { hrService, RegisterRow } from '../../../services/api/hrService';
import apiClient from '../../../utils/apiClient';
import Loader from '../../../components/Loader';
import { statusBadgeClass, statusLabel } from './hrShared';
import DayPunchesModal from './DayPunchesModal';
import SearchableSelect from '../../../components/SearchableSelect';
import { useHasPermission } from '../../../hooks/useHasPermission';
import FetchingOverlay from '../../../components/FetchingOverlay';

const isoDaysAgo = (days: number) =>
  new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

/** Flags are machine keys; these are what a manager should actually read. */
const FLAG_LABELS: Record<string, string> = {
  in_progress: 'On shift now',
  stray_out: 'Clock-out with no clock-in',
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
  const [punchesDayId, setPunchesDayId] = useState<number | null>(null);
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

  const queryClient = useQueryClient();
  const canApproveOt = useHasPermission('overtime:approve');

  const { data: rows = [], isLoading, isPlaceholderData: isRegisterPlaceholder } = useQuery({
    queryKey: ['hr-attendance-register', params],
    queryFn: () => hrService.getRegister(params),
    placeholderData: keepPreviousData,
  });

  const { data: report, isPlaceholderData: isReportPlaceholder } = useQuery({
    queryKey: ['hr-attendance-exceptions', params],
    queryFn: () => hrService.getExceptionsReport(params),
    placeholderData: keepPreviousData,
  });

  const { data: branches = [] } = useQuery<Array<{ id: number; name: string }>>({
    queryKey: ['hr-branches'],
    queryFn: async () => {
      const { data } = await apiClient.get('/admin/branches');
      return data ?? [];
    },
  });

  const onDecided = (label: string) => {
    toast.success(label);
    queryClient.invalidateQueries({ queryKey: ['hr-attendance-register'] });
    queryClient.invalidateQueries({ queryKey: ['hr-attendance-exceptions'] });
  };

  const failed = (fallback: string) => (err: unknown) => {
    const message =
      (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
        ?.message ?? fallback;
    toast.error(Array.isArray(message) ? message[0] : message);
  };

  const decide = useMutation({
    mutationFn: ({ dayId, approve }: { dayId: number; approve: boolean }) =>
      hrService.decideOvertime(dayId, { approve }),
    onSuccess: (r) =>
      onDecided(
        r.status === 'approved'
          ? `${r.approved_minutes}m overtime approved`
          : 'Overtime rejected',
      ),
    onError: failed('Could not record that decision'),
  });

  const decideAll = useMutation({
    mutationFn: (approve: boolean) =>
      hrService.decideOvertimeBulk({ ...params, approve }),
    onSuccess: (r) => {
      onDecided(
        r.decided === 0
          ? 'Nothing was waiting'
          : `${r.decided} day(s) decided`,
      );
      if (r.skipped.length > 0) {
        // Never silently: a day that could not be decided is one somebody still
        // has to look at.
        toast(`${r.skipped.length} day(s) skipped — ${r.skipped[0].reason}`, {
          icon: '⚠️',
          duration: 6000,
        });
      }
    },
    onError: failed('Could not decide those days'),
  });

  /** Days still waiting on somebody, inside the current filter. */
  const waitingOt = rows.filter(
    (r) => r.overtime_pending > 0 && !r.overtime_decided && !r.is_locked,
  );

  const flagsOf = (row: RegisterRow) =>
    Object.keys(row.flags ?? {}).filter((k) => row.flags[k]);

  const field =
    'rounded-md border border-gray-300 px-3 py-2 text-sm dark:border-slate-600 dark:bg-slate-800 dark:text-gray-100';

  return (
    <div className="p-4 md:p-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MdOutlineFactCheck className="text-2xl text-gray-700 dark:text-gray-200" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Attendance register
          </h1>
        </div>
        {/* The station is a separate full-screen route so a tablet can sit on it
            all day. Linking it here is how anyone finds it. */}
        <a
          href="/attendance"
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          Open attendance station
        </a>
      </div>

      <p className="mb-5 text-sm text-gray-600 dark:text-gray-400">
        What actually happened, day by day. Staff clock in and out on the{' '}
        <strong>attendance station</strong>; set each employee&apos;s PIN from their
        profile (Employees → open → Attendance credentials), and register the tablets
        under{' '}
        <Link to="/admin/hr/attendance/devices" className="text-blue-600 hover:underline">
          Attendance devices
        </Link>
        .
      </p>

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
        <div className="min-w-[200px]">
          <SearchableSelect
            ariaLabel="Branch"
            value={branchId === '' ? '' : String(branchId)}
            onChange={(v) => setBranchId(v === '' ? '' : Number(v))}
            options={[
              { value: '', label: 'All branches' },
              ...branches.map((b) => ({ value: String(b.id), label: b.name })),
            ]}
            placeholder="All branches"
            searchPlaceholder="Search branches…"
          />
        </div>
      </div>

      {waitingOt.length > 0 && (
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 dark:border-amber-800 dark:bg-amber-900/20">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-amber-800 dark:text-amber-300">
              <MdWarningAmber className="text-lg" />
              Overtime waiting
            </h2>
            <p className="mt-1 text-sm text-amber-900 dark:text-amber-200">
              {waitingOt.length} day(s) totalling{' '}
              {waitingOt.reduce((sum, r) => sum + r.overtime_pending, 0)} minutes.
              Payroll will not pay any of it, and will not let the run be approved,
              until each day is answered.
            </p>
          </div>
          {canApproveOt && (
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => decideAll.mutate(true)}
                disabled={decideAll.isPending}
                className="rounded-md bg-green-600 px-3 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-60"
              >
                {decideAll.isPending ? 'Working…' : 'Approve all'}
              </button>
              <button
                type="button"
                onClick={() => decideAll.mutate(false)}
                disabled={decideAll.isPending}
                className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-60 dark:border-slate-600 dark:bg-slate-800 dark:text-gray-200"
              >
                Reject all
              </button>
            </div>
          )}
        </div>
      )}

      {report && (report.flagged_days.length > 0 || report.bursts.length > 0) && (
        <FetchingOverlay active={isReportPlaceholder} label="Updating exceptions…" className="rounded-lg">
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
        </FetchingOverlay>
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
        <FetchingOverlay active={isRegisterPlaceholder} label="Updating register…" className="rounded-lg">
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr>
                {[
                  'Date',
                  'Employee',
                  'Status',
                  'In',
                  'Out',
                  'Worked',
                  'Late',
                  'OT',
                  'Flags',
                  '',
                ].map(
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
                    {/* Someone who has clocked in but not out yet is at work, not
                        absent. Showing the raw status here reads as an accusation. */}
                    {r.flags?.in_progress ? (
                      <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800 dark:bg-blue-900/30 dark:text-blue-300">
                        Clocked in
                      </span>
                    ) : (
                      <span className={statusBadgeClass(r.status)}>
                        {statusLabel(r.status)}
                      </span>
                    )}
                    {/* WHY it is absent or half a day. The reason comes from
                        the engine: somebody who worked 19 hours but arrived
                        four hours late is a half day because of the lateness,
                        and "only 19h worked" would read as a bug. */}
                    {(r.status === 'absent' || r.status === 'half_day') &&
                      !r.flags?.in_progress && (
                        <div className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                          {r.flags?.half_day_reason === 'late'
                            ? `${minutesLabel(r.late_minutes)} late`
                            : r.worked_minutes > 0
                              ? `only ${minutesLabel(r.worked_minutes)} worked`
                              : 'no hours recorded'}
                        </div>
                      )}
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
                    {/* Overtime is never paid until somebody confirms it, so the
                        decision belongs on the row where the day already is —
                        not on a screen nobody visits. */}
                    {r.overtime_approved > 0 ? (
                      <span className="font-medium text-green-700 dark:text-green-400">
                        {r.overtime_approved}m approved
                      </span>
                    ) : r.overtime_pending > 0 && r.overtime_decided ? (
                      <span className="text-gray-500 dark:text-gray-400">
                        {r.overtime_pending}m rejected
                      </span>
                    ) : r.overtime_pending > 0 ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-amber-700 dark:text-amber-400">
                          {r.overtime_pending}m waiting
                        </span>
                        {canApproveOt && !r.is_locked && (
                          <span className="flex gap-1">
                            <button
                              type="button"
                              onClick={() =>
                                decide.mutate({ dayId: r.id, approve: true })
                              }
                              disabled={decide.isPending}
                              className="rounded border border-green-600 px-2 py-0.5 text-xs font-medium text-green-700 hover:bg-green-50 disabled:opacity-50 dark:text-green-400 dark:hover:bg-green-900/20"
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                decide.mutate({ dayId: r.id, approve: false })
                              }
                              disabled={decide.isPending}
                              className="rounded border border-gray-300 px-2 py-0.5 text-xs text-gray-600 hover:bg-gray-50 disabled:opacity-50 dark:border-slate-600 dark:text-gray-300 dark:hover:bg-slate-700"
                            >
                              Reject
                            </button>
                          </span>
                        )}
                      </div>
                    ) : (
                      '—'
                    )}
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
                  <td className="whitespace-nowrap px-4 py-3 text-right">
                    <button
                      type="button"
                      onClick={() => setPunchesDayId(r.id)}
                      className="text-sm text-blue-600 hover:underline dark:text-blue-400"
                    >
                      Punches
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </FetchingOverlay>
      )}
      {punchesDayId != null && (
        <DayPunchesModal dayId={punchesDayId} onClose={() => setPunchesDayId(null)} />
      )}
    </div>
  );
};

export default AttendanceRegister;
