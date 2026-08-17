import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { MdOutlineRateReview, MdSync, MdWarningAmber } from 'react-icons/md';
import { hrService, ReviewCycleRow } from '../../../services/api/hrService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import Loader from '../../../components/Loader';
import AdHocReviewModal from './AdHocReviewModal';

const TABS = [
  { key: 'due', label: 'Due' },
  { key: 'in_progress', label: 'In progress' },
  { key: 'submitted', label: 'Awaiting approval' },
  { key: 'completed', label: 'Completed' },
  { key: 'all', label: 'All' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

const CYCLE_LABELS: Record<string, string> = {
  probation_3m: 'Probation (3 months)',
  quarterly: 'Quarterly',
  ad_hoc: 'Ad-hoc',
};

const AD_HOC_REASON_LABELS: Record<string, string> = {
  promotion_consideration: 'Promotion consideration',
  performance_concern: 'Performance concern',
  post_training_assessment: 'Post-training assessment',
  disciplinary: 'Disciplinary',
  pre_exit: 'Pre-exit',
};

const badge = 'inline-flex rounded-full px-2 py-0.5 text-xs font-medium';

const statusClass = (status: string) => {
  if (status === 'completed')
    return `${badge} bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-300`;
  if (status === 'submitted')
    return `${badge} bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-300`;
  if (status === 'in_progress')
    return `${badge} bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300`;
  if (status === 'skipped')
    return `${badge} bg-gray-200 text-gray-600 dark:bg-slate-700 dark:text-gray-400`;
  return `${badge} bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-gray-300`;
};

// The cycle column already carries a "Scheduled" badge for origin, so the raw
// 'scheduled' status is renamed here — two columns reading "Scheduled" for
// different things is how a reviewer misreads the queue.
const statusLabel = (status: string) => {
  if (status === 'scheduled') return 'Not started';
  if (status === 'in_progress') return 'In progress';
  return status.charAt(0).toUpperCase() + status.slice(1);
};

/**
 * Review queue.
 *
 * Scheduled and ad-hoc cycles share this list but never share a lane: the
 * "Scheduled"/"Ad-hoc" badge comes from `is_scheduled`, and the counts in the
 * header deliberately count scheduled cycles only. Opening ad-hoc reviews must
 * not make the cadence look better or worse than it is (docs/HRM.md §13.1).
 */
const Reviews: React.FC = () => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const canConduct = useHasPermission('reviews:conduct');
  const canApprove = useHasPermission('reviews:approve');
  const canAdHoc = useHasPermission('reviews:initiate-adhoc');

  const [tab, setTab] = useState<TabKey>('due');
  const [showAdHoc, setShowAdHoc] = useState(false);

  // One fetch, filtered client-side: the queue is per-tenant and small, and a
  // single list keeps the header counts consistent with the rows on screen.
  const { data: cycles = [], isLoading } = useQuery({
    queryKey: ['hr-review-cycles'],
    queryFn: () => hrService.listReviewCycles(),
  });

  const sync = useMutation({
    mutationFn: () => hrService.syncReviewCycles(),
    onSuccess: (result) => {
      toast.success(
        result.created === 0
          ? 'Nothing new was due'
          : `${result.created} review(s) scheduled across ${result.employees} employee(s)`,
      );
      queryClient.invalidateQueries({ queryKey: ['hr-review-cycles'] });
    },
    onError: (err: unknown) => {
      const message =
        (err as { response?: { data?: { message?: string | string[] } } })?.response?.data
          ?.message ?? 'Could not generate the schedule';
      toast.error(Array.isArray(message) ? message[0] : message);
    },
  });

  const rows = useMemo(() => {
    if (tab === 'all') return cycles;
    if (tab === 'due')
      return cycles.filter((c) => c.status === 'scheduled');
    if (tab === 'completed')
      return cycles.filter((c) => ['completed', 'skipped'].includes(c.status));
    return cycles.filter((c) => c.status === tab);
  }, [cycles, tab]);

  const overdueScheduled = cycles.filter((c) => c.overdue && c.is_scheduled).length;
  const overdueAdHoc = cycles.filter((c) => c.overdue && !c.is_scheduled).length;

  const open = (cycle: ReviewCycleRow) => {
    if (!canConduct) {
      toast.error('You do not have permission to open review forms');
      return;
    }
    navigate(`/admin/hr/reviews/${cycle.id}`);
  };

  return (
    <div className="p-4 md:p-6">
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <MdOutlineRateReview className="text-2xl text-gray-700 dark:text-gray-200" />
          <h1 className="text-xl font-semibold text-gray-900 dark:text-gray-100">
            Performance reviews
          </h1>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAdHoc && (
            <button
              type="button"
              onClick={() => setShowAdHoc(true)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-800"
            >
              Start a review
            </button>
          )}
          {canApprove && (
            <button
              type="button"
              onClick={() => sync.mutate()}
              disabled={sync.isPending}
              className="inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-60"
            >
              <MdSync className={sync.isPending ? 'animate-spin' : ''} />
              {sync.isPending ? 'Checking…' : 'Generate due reviews'}
            </button>
          )}
        </div>
      </div>

      {overdueScheduled > 0 && (
        <div className="mb-4 flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-200">
          <MdWarningAmber className="mt-0.5 shrink-0 text-lg" />
          <p>
            {overdueScheduled} scheduled review
            {overdueScheduled === 1 ? ' is' : 's are'} past due
            {overdueAdHoc > 0 && `, plus ${overdueAdHoc} ad-hoc`}. A missed cycle does not
            move the next one — the cadence stays anchored to the joining date.
          </p>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => {
          const count =
            t.key === 'all'
              ? cycles.length
              : t.key === 'due'
                ? cycles.filter((c) => c.status === 'scheduled').length
                : t.key === 'completed'
                  ? cycles.filter((c) => ['completed', 'skipped'].includes(c.status)).length
                  : cycles.filter((c) => c.status === t.key).length;
          return (
            <button
              key={t.key}
              type="button"
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3 py-1.5 text-sm ${
                tab === t.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-800 dark:text-gray-300'
              }`}
            >
              {t.label} ({count})
            </button>
          );
        })}
      </div>

      {isLoading ? (
        <Loader />
      ) : rows.length === 0 ? (
        <div className="rounded-md border border-dashed border-gray-300 p-8 text-center dark:border-slate-600">
          <p className="text-sm text-gray-600 dark:text-gray-400">
            No reviews in this list.
          </p>
          {tab === 'due' && canApprove && (
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-500">
              Cycles appear here two weeks before they fall due. "Generate due reviews"
              runs the same check the nightly job does.
            </p>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-gray-200 dark:border-slate-700">
          <table className="min-w-full divide-y divide-gray-200 text-sm dark:divide-slate-700">
            <thead className="bg-gray-50 dark:bg-slate-800">
              <tr className="text-left text-xs uppercase tracking-wide text-gray-500 dark:text-gray-400">
                <th className="px-3 py-2">#</th>
                <th className="px-3 py-2">Employee</th>
                <th className="px-3 py-2">Cycle</th>
                <th className="px-3 py-2">Period</th>
                <th className="px-3 py-2">Due</th>
                <th className="px-3 py-2">Reviewer</th>
                <th className="px-3 py-2">Status</th>
                <th className="px-3 py-2 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-slate-700 dark:bg-slate-900">
              {rows.map((c, index) => (
                <tr key={c.id} className="hover:bg-gray-50 dark:hover:bg-slate-800">
                  <td className="px-3 py-2 text-gray-500 dark:text-gray-400">
                    {index + 1}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-medium text-gray-900 dark:text-gray-100">
                      {c.employee.full_name}
                    </div>
                    <div className="text-xs text-gray-500 dark:text-gray-400">
                      {c.employee.employee_code}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div className="text-gray-800 dark:text-gray-200">
                      {/* For an ad-hoc row the reason is the useful line — the
                          badge below already says it is ad-hoc. */}
                      {c.is_scheduled
                        ? `${CYCLE_LABELS[c.cycle_type] ?? c.cycle_type}${
                            c.sequence_no != null ? ` · #${c.sequence_no}` : ''
                          }`
                        : (c.ad_hoc_reason &&
                            (AD_HOC_REASON_LABELS[c.ad_hoc_reason] ?? c.ad_hoc_reason)) ||
                          'Out of cycle'}
                    </div>
                    <span
                      className={
                        c.is_scheduled
                          ? `${badge} mt-1 bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300`
                          : `${badge} mt-1 bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-300`
                      }
                      title={
                        c.is_scheduled
                          ? 'Part of the fixed cadence'
                          : 'Raised out of cycle — does not affect the cadence'
                      }
                    >
                      {c.is_scheduled ? 'Scheduled' : 'Ad-hoc'}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap text-gray-600 dark:text-gray-300">
                    {c.period_from} → {c.period_to}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    <span
                      className={
                        c.overdue
                          ? 'font-medium text-red-600 dark:text-red-400'
                          : 'text-gray-600 dark:text-gray-300'
                      }
                    >
                      {c.due_date}
                    </span>
                    {c.overdue && (
                      <div className="text-xs text-red-500 dark:text-red-400">Overdue</div>
                    )}
                  </td>
                  <td className="px-3 py-2 text-gray-600 dark:text-gray-300">
                    {c.reviewer?.name ?? '—'}
                  </td>
                  <td className="px-3 py-2">
                    <span className={statusClass(c.status)}>{statusLabel(c.status)}</span>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <button
                      type="button"
                      onClick={() => open(c)}
                      className="rounded-md border border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-700 hover:bg-gray-100 dark:border-slate-600 dark:text-gray-200 dark:hover:bg-slate-700"
                    >
                      {['completed', 'skipped'].includes(c.status)
                        ? 'View'
                        : c.status === 'submitted'
                          ? 'Review & approve'
                          : 'Open form'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showAdHoc && <AdHocReviewModal onClose={() => setShowAdHoc(false)} />}
    </div>
  );
};

export default Reviews;
