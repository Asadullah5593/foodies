import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import {
  activityLogService,
  type ActivityLogDetail,
  type ActivityLogRow,
} from '../../services/api/activityLogService';
import Card from '../../components/Card';
import PaginationBar from '../../components/PaginationBar';
import SearchableSelect from '../../components/SearchableSelect';
import ActivityLogSettingsPanel, {
  CaptureStateBanner,
} from './ActivityLogSettings';
import { useSensitivePageView } from '../../hooks/useSensitivePageView';

const PAGE_SIZE = 25;

const OUTCOME_STYLES: Record<string, string> = {
  success: 'bg-emerald-50 text-emerald-700 border-emerald-200',
  denied: 'bg-amber-50 text-amber-700 border-amber-200',
  failed: 'bg-orange-50 text-orange-700 border-orange-200',
  error: 'bg-red-50 text-red-700 border-red-200',
};

const ACTOR_STYLES: Record<string, string> = {
  staff: 'bg-blue-50 text-blue-700',
  rider: 'bg-violet-50 text-violet-700',
  customer: 'bg-teal-50 text-teal-700',
  kiosk: 'bg-slate-100 text-slate-600',
  anonymous: 'bg-rose-50 text-rose-700',
  system: 'bg-gray-100 text-gray-600',
};

const todayIso = () => new Date().toISOString().split('T')[0];
const daysAgoIso = (n: number) =>
  new Date(Date.now() - n * 86_400_000).toISOString().split('T')[0];

const formatWhen = (iso: string) =>
  new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

/** "4m ago" reads faster than a timestamp when scanning for what just happened. */
const relativeWhen = (iso: string): string => {
  const seconds = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  return `${Math.floor(days / 30)}mo ago`;
};

/** A plain-English sentence for a row, so the table reads without decoding. */
const plainEnglish = (row: ActivityLogRow): string => {
  const who = row.actor_label ?? 'Someone';
  const what = row.action.split('.').slice(1).join(' ') || row.action;
  const subject = row.entity_label
    ? `"${row.entity_label}"`
    : row.entity_type
      ? `${row.entity_type.replace(/_/g, ' ')}${row.entity_id ? ` #${row.entity_id}` : ''}`
      : '';
  const verb =
    row.outcome === 'denied'
      ? 'was refused'
      : row.outcome === 'failed'
        ? 'failed to'
        : '';
  const noun = row.action.split('.')[0].replace(/_/g, ' ');
  return [who, verb, what, subject && `${subject}`, !subject && noun]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ');
};

/** Renders a diff value, keeping `[redacted]` visibly removed rather than absent. */
const DiffValue: React.FC<{ value: unknown }> = ({ value }) => {
  // Opening this screen is itself worth recording — see the hook.
  useSensitivePageView('activity-log');
  if (value === null || value === undefined) {
    return <span className="text-gray-400">—</span>;
  }
  const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (text === '[redacted]' || text === '[changed]') {
    return (
      <span className="rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-500">
        {text}
      </span>
    );
  }
  return <span className="font-mono text-xs">{text}</span>;
};

/**
 * A set-valued change (a role's permissions, most importantly) read as what was
 * added and removed. Two 119-item JSON blobs side by side are technically the
 * same information and practically unreadable — this is the difference between
 * "the permissions changed" and "they granted themselves refunds".
 */
const SetDiff: React.FC<{ before: unknown[]; after: unknown[] }> = ({ before, after }) => {
  const beforeSet = before.map(String);
  const afterSet = after.map(String);
  const added = afterSet.filter((v) => !beforeSet.includes(v));
  const removed = beforeSet.filter((v) => !afterSet.includes(v));

  if (!added.length && !removed.length) {
    return <span className="text-xs text-gray-400">reordered only</span>;
  }
  return (
    <div className="flex flex-wrap gap-1">
      {added.map((v) => (
        <span
          key={`+${v}`}
          className="rounded bg-emerald-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-emerald-700"
        >
          + {v}
        </span>
      ))}
      {removed.map((v) => (
        <span
          key={`-${v}`}
          className="rounded bg-rose-50 px-1.5 py-0.5 font-mono text-[11px] font-semibold text-rose-700"
        >
          − {v}
        </span>
      ))}
    </div>
  );
};

/**
 * Reports → Activity Log.
 *
 * Read-only by construction: there is no edit or delete control anywhere on this
 * screen, and the API exposes none. Filters live in the URL so an investigation
 * can be shared as a link.
 */
const ActivityLog: React.FC = () => {
  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<ActivityLogRow | null>(null);
  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');

  // Record lens: arriving from a History link asks "everything that ever
  // happened to this record", so the window opens to a year rather than the
  // week the time lens defaults to. The server allows it because
  // (entity_type, entity_id) is selective enough to afford the wider range.
  const isRecordLens = params.get('entity_id') != null;

  const filters = useMemo(
    () => ({
      date_from:
        params.get('date_from') ??
        (params.get('entity_id') != null ? daysAgoIso(365) : daysAgoIso(7)),
      date_to: params.get('date_to') ?? todayIso(),
      outcome: params.get('outcome') ?? '',
      action_group: params.get('action_group') ?? '',
      actor_user_id: params.get('actor_user_id') ?? '',
      actor_type: params.get('actor_type') ?? '',
      entity_type: params.get('entity_type') ?? '',
      entity_id: params.get('entity_id') ?? '',
      search: params.get('search') ?? '',
      page: Number(params.get('page') ?? 1),
    }),
    [params]
  );

  const setFilter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page') next.delete('page');
    setParams(next, { replace: true });
  };

  // Debounced search, so typing does not fire a query per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => {
      if (searchInput !== filters.search) setFilter('search', searchInput);
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const { data: options } = useQuery({
    queryKey: ['activityLogOptions'],
    queryFn: () => activityLogService.filterOptions(),
    staleTime: 5 * 60 * 1000,
  });

  const { data, isLoading, isError, error } = useQuery({
    queryKey: ['activityLog', filters],
    queryFn: () =>
      activityLogService.list({
        date_from: filters.date_from,
        date_to: filters.date_to,
        outcome: filters.outcome || undefined,
        action_group: filters.action_group || undefined,
        actor_user_id: filters.actor_user_id ? Number(filters.actor_user_id) : undefined,
        actor_type: filters.actor_type || undefined,
        entity_type: filters.entity_type || undefined,
        entity_id: filters.entity_id || undefined,
        search: filters.search || undefined,
        page: filters.page,
        page_size: PAGE_SIZE,
      }),
    placeholderData: keepPreviousData,
  });

  const { data: detail } = useQuery<ActivityLogDetail>({
    queryKey: ['activityLogDetail', selected?.id, selected?.created_at],
    queryFn: () => activityLogService.detail(selected!.id, selected!.created_at),
    enabled: selected != null,
  });

  const { data: related } = useQuery({
    queryKey: ['activityLogRelated', selected?.request_id, selected?.created_at],
    queryFn: () =>
      activityLogService.related(selected!.request_id!, selected!.created_at),
    enabled: selected?.request_id != null,
  });

  const rows = data?.data ?? [];
  const rangeError =
    isError && (error as { response?: { status?: number } })?.response?.status === 400;

  return (
    <div className="mx-auto max-w-[1500px] px-9 pb-20 pt-8 text-[#1F2430]">
      <div className="mb-[22px] flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="mb-[5px] text-xs font-semibold text-[#9AA1AD]">Oversight</div>
        {isRecordLens ? (
          <>
            <h1 className="mb-1.5 text-[27px] font-extrabold tracking-[-0.02em]">
              {params.get('entity_label') || filters.entity_type.replace(/_/g, ' ')}
              {params.get('entity_label') ? '' : ` #${filters.entity_id}`}
            </h1>
            <p className="text-[13.5px] text-[#8A92A0]">
              Full history of this record, newest first · last 12 months
            </p>
            <button
              type="button"
              onClick={() => setParams(new URLSearchParams(), { replace: true })}
              className="mt-2.5 inline-flex items-center gap-1.5 rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6]"
            >
              ← All activity
            </button>
          </>
        ) : (
          <>
            <h1 className="mb-1.5 text-[27px] font-extrabold tracking-[-0.02em]">
              Activity Log
            </h1>
            <p className="text-[13.5px] text-[#8A92A0]">
              Who did what, when and from where — append-only, and nothing here can be
              edited or deleted
            </p>
          </>
        )}
        </div>
        <ActivityLogSettingsPanel />
      </div>

      <CaptureStateBanner />

      <Card className="mb-[18px] rounded-2xl border border-[#ECEDF0] p-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              From
            </label>
            <input
              type="date"
              aria-label="From date"
              value={filters.date_from}
              onChange={(e) => setFilter('date_from', e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              To
            </label>
            <input
              type="date"
              aria-label="To date"
              value={filters.date_to}
              onChange={(e) => setFilter('date_to', e.target.value)}
              className="rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <SearchableSelect
            ariaLabel="Outcome"
            label="Outcome"
            minWidth="min-w-[150px]"
            value={filters.outcome}
            onChange={(v) => setFilter('outcome', v)}
            options={[
              { value: '', label: 'Any outcome' },
              ...(options?.outcomes ?? []).map((o) => ({ value: o, label: o })),
            ]}
          />
          <SearchableSelect
            ariaLabel="Area"
            label="Area"
            minWidth="min-w-[150px]"
            value={filters.action_group}
            onChange={(v) => setFilter('action_group', v)}
            options={[
              { value: '', label: 'All areas' },
              ...(options?.action_groups ?? []).map((g) => ({ value: g, label: g })),
            ]}
          />
          <SearchableSelect
            ariaLabel="Who"
            label="Who"
            minWidth="min-w-[180px]"
            value={filters.actor_user_id}
            onChange={(v) => setFilter('actor_user_id', v)}
            options={[
              { value: '', label: 'Anyone' },
              ...(options?.actors ?? []).map((a) => ({
                value: String(a.actor_user_id),
                label: a.actor_label ?? `user#${a.actor_user_id}`,
              })),
            ]}
          />
          <div className="min-w-[220px] flex-1">
            <label className="mb-1 block text-xs font-semibold uppercase tracking-wide text-gray-500">
              Search
            </label>
            <input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Person, action, route or record…"
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSearchInput('');
              setParams(new URLSearchParams(), { replace: true });
            }}
            className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-200"
          >
            Clear
          </button>
        </div>

        {data && (
          <div className="mt-3 flex flex-wrap gap-2 border-t border-gray-100 pt-3">
            {Object.entries(data.outcome_counts).map(([outcome, count]) => (
              <button
                key={outcome}
                type="button"
                onClick={() =>
                  setFilter('outcome', filters.outcome === outcome ? '' : outcome)
                }
                className={`rounded-full border px-3.5 py-1 text-xs font-bold transition ${
                  OUTCOME_STYLES[outcome] ?? 'border-gray-200 bg-gray-50 text-gray-600'
                } ${filters.outcome === outcome ? 'ring-2 ring-[#DC2A2A]/30 ring-offset-1' : 'hover:brightness-95'}`}
              >
                {outcome}: {count}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden rounded-2xl border border-[#ECEDF0] p-0 shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        {rangeError ? (
          <div className="p-8 text-center text-sm text-amber-700">
            {(error as { response?: { data?: { message?: string } } })?.response?.data
              ?.message ?? 'That date range is too wide.'}
          </div>
        ) : isError ? (
          <div className="p-8 text-center text-sm text-red-600">
            Could not load the activity log.
          </div>
        ) : isLoading ? (
          <div className="p-8 text-center text-sm text-gray-500">Loading activity…</div>
        ) : rows.length === 0 ? (
          <div className="p-8 text-center text-sm text-gray-500">
            No activity matches these filters.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[#F1F2F5] bg-[#FBFBFC] text-left text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]">
                  <th className="px-5 py-[11px]">When</th>
                  <th className="px-5 py-[11px]">Who</th>
                  <th className="px-5 py-[11px]">What happened</th>
                  <th className="px-5 py-[11px]">Record</th>
                  <th className="px-5 py-[11px]">Outcome</th>
                  <th className="px-5 py-[11px]">From</th>
                  <th className="px-5 py-[11px]" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className="cursor-pointer border-b border-[#F4F5F7] last:border-0 hover:bg-[#FBFBFC]"
                  >
                    <td className="whitespace-nowrap px-5 py-3 text-gray-600">
                      <div className="text-xs font-medium text-gray-700">
                        {relativeWhen(row.created_at)}
                      </div>
                      <div className="text-[11px] tabular-nums text-gray-400">
                        {formatWhen(row.created_at)}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="font-medium text-gray-800">
                        {row.actor_label ?? '—'}
                      </div>
                      <div className="mt-0.5 flex items-center gap-1.5">
                        <span
                          className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                            ACTOR_STYLES[row.actor_type] ?? 'bg-gray-100 text-gray-600'
                          }`}
                        >
                          {row.actor_type}
                        </span>
                        {/* Role AT THE TIME of the action, not today's role */}
                        {(row.actor_role_names ?? []).map((r) => (
                          <span key={r} className="text-[10px] text-gray-500">
                            {r}
                          </span>
                        ))}
                        {row.actor_is_super_admin && (
                          <span className="text-[10px] font-semibold text-purple-600">
                            super admin
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="text-[13px] text-gray-800">
                        {plainEnglish(row)}
                      </div>
                      <span className="font-mono text-[11px] text-gray-400">{row.action}</span>
                      {row.changed_fields && row.changed_fields.length > 0 && (
                        <span className="ml-2 rounded bg-indigo-50 px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700">
                          {row.changed_fields.length} changed
                        </span>
                      )}
                      {row.diff_expected &&
                        (!row.changed_fields || row.changed_fields.length === 0) && (
                          <span
                            className="ml-2 text-[10px] text-gray-400"
                            title="This route should record a before/after but none was captured — missing instrumentation."
                          >
                            no diff
                          </span>
                        )}
                    </td>
                    <td className="px-5 py-3 text-gray-600">
                      {row.entity_label ??
                        (row.entity_type
                          ? `${row.entity_type}${row.entity_id ? ` #${row.entity_id}` : ''}`
                          : '—')}
                    </td>
                    <td className="px-5 py-3">
                      <span
                        className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${
                          OUTCOME_STYLES[row.outcome] ??
                          'border-gray-200 bg-gray-50 text-gray-600'
                        }`}
                      >
                        {row.outcome}
                      </span>
                      {row.status_code != null && (
                        <span className="ml-1.5 text-xs text-gray-400">
                          {row.status_code}
                        </span>
                      )}
                    </td>
                    <td className="px-5 py-3 font-mono text-xs text-gray-500">
                      {row.ip ?? '—'}
                    </td>
                    <td className="px-5 py-3 text-right text-xs font-semibold text-[#DC2A2A]">
                      Details →
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.total > 0 && (
          <PaginationBar
            totalCount={data.total}
            page={data.page}
            pageSize={data.page_size}
            onPageChange={(p) => setFilter('page', String(p))}
            itemLabel="entries"
            className="border-t border-gray-100 px-5 py-3"
          />
        )}
      </Card>

      {selected && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-[1px]"
          onClick={() => setSelected(null)}
        >
          <div
            className="h-full w-full max-w-2xl overflow-y-auto bg-[#FBFBFC] shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Lead with the sentence, not the machine name: the first thing a
                reader needs is what happened, in words. */}
            <div className="sticky top-0 z-10 border-b border-[#ECEDF0] bg-white px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="mb-1.5 flex items-center gap-2">
                    <span
                      className={`rounded-full border px-2.5 py-0.5 text-[11px] font-bold ${
                        OUTCOME_STYLES[selected.outcome] ??
                        'border-gray-200 bg-gray-50 text-gray-600'
                      }`}
                    >
                      {selected.outcome}
                    </span>
                    <span className="font-mono text-[11px] text-[#9AA1AD]">
                      {selected.action}
                    </span>
                  </div>
                  <h2 className="text-[19px] font-extrabold leading-tight tracking-[-0.01em] text-[#20242C]">
                    {plainEnglish(selected)}
                  </h2>
                  <div className="mt-1.5 text-[12.5px] text-[#8A92A0]">
                    {relativeWhen(selected.created_at)} · {formatWhen(selected.created_at)}
                    {selected.duration_ms != null && ` · took ${selected.duration_ms}ms`}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setSelected(null)}
                  aria-label="Close"
                  className="flex-none rounded-lg px-3 py-1 text-xl leading-none text-[#9AA1AD] transition hover:bg-[#F3F4F6]"
                >
                  ✕
                </button>
              </div>
            </div>

            <div className="space-y-4 p-6">
              <section className="rounded-2xl border border-[#ECEDF0] bg-white p-4">
                <h3 className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]">
                  Who did it
                </h3>
                <div className="flex items-start gap-3">
                  <div className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#F3F4F6] text-sm font-bold text-[#5A6473]">
                    {(selected.actor_label ?? '?').slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 text-sm">
                    <div className="font-bold text-[#20242C]">
                      {selected.actor_label ?? 'Unknown'}
                      <span
                        className={`ml-2 rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                          ACTOR_STYLES[selected.actor_type] ??
                          'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {selected.actor_type}
                      </span>
                    </div>
                    {/* Labelled explicitly: roles are edited over time, so
                        today's role is the wrong answer for a past action. */}
                    <dl className="mt-2 grid grid-cols-[auto,1fr] gap-x-3 gap-y-1 text-[12.5px]">
                      <dt className="text-[#9AA1AD]">Role at the time</dt>
                      <dd className="font-medium text-[#374151]">
                        {selected.actor_role_names?.length
                          ? selected.actor_role_names.join(', ')
                          : selected.actor_is_super_admin
                            ? 'super admin (unrestricted)'
                            : 'none recorded'}
                      </dd>
                      <dt className="text-[#9AA1AD]">From</dt>
                      <dd className="font-mono text-[12px] text-[#374151]">
                        {selected.ip ?? '—'}
                      </dd>
                      <dt className="text-[#9AA1AD]">Request</dt>
                      <dd className="truncate font-mono text-[11px] text-[#8A92A0]">
                        {selected.request_id ?? '—'}
                      </dd>
                      <dt className="text-[#9AA1AD]">Route</dt>
                      <dd className="truncate font-mono text-[11px] text-[#8A92A0]">
                        {selected.http_method} {selected.route}
                      </dd>
                    </dl>
                  </div>
                </div>
              </section>

              {detail?.changes && (
                <section className="rounded-2xl border border-[#ECEDF0] bg-white p-4">
                  <h3 className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]">
                    What changed
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-[#F1F2F5] text-left text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]">
                        <th className="py-1.5">Field</th>
                        <th className="py-1.5">Before</th>
                        <th className="py-1.5">After</th>
                      </tr>
                    </thead>
                    <tbody>
                      {Object.entries(detail.changes).map(([field, value]) => {
                        const isSet =
                          Array.isArray(value.before) && Array.isArray(value.after);
                        return (
                          <tr
                            key={field}
                            className="border-b border-gray-100 last:border-0"
                          >
                            <td className="py-1.5 pr-3 align-top font-medium text-gray-700">
                              {field}
                            </td>
                            {isSet ? (
                              <td className="py-1.5" colSpan={2}>
                                <SetDiff
                                  before={value.before as unknown[]}
                                  after={value.after as unknown[]}
                                />
                              </td>
                            ) : (
                              <>
                                <td className="py-1.5 pr-3 align-top">
                                  <DiffValue value={value.before} />
                                </td>
                                <td className="py-1.5 align-top">
                                  <DiffValue value={value.after} />
                                </td>
                              </>
                            )}
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </section>
              )}

              {detail?.request_body && (
                <section className="rounded-2xl border border-[#ECEDF0] bg-white p-4">
                  <h3 className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]">
                    What was sent
                    {detail.payload_truncated && (
                      <span className="ml-2 font-normal normal-case text-gray-400">
                        (truncated)
                      </span>
                    )}
                  </h3>
                  <pre className="overflow-x-auto rounded-xl bg-[#20242C] p-3.5 text-[11.5px] leading-relaxed text-gray-100">
                    {JSON.stringify(detail.request_body, null, 2)}
                  </pre>
                </section>
              )}

              {related && related.length > 1 && (
                <section className="rounded-2xl border border-[#ECEDF0] bg-white p-4">
                  <h3 className="mb-3 text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]">
                    Everything else in this request
                  </h3>
                  <ul className="space-y-1.5">
                    {related.map((r) => (
                      <li
                        key={r.id}
                        className="flex items-center justify-between rounded-lg bg-[#FBFBFC] px-3 py-2 text-[12.5px]"
                      >
                        <span className="font-mono text-[#374151]">{r.action}</span>
                        <span
                          className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                            OUTCOME_STYLES[r.outcome] ??
                            'border-gray-200 bg-gray-50 text-gray-600'
                          }`}
                        >
                          {r.outcome}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {!detail?.changes && selected.diff_expected && (
                <section className="rounded-2xl border border-dashed border-[#E2E5EA] bg-white p-4 text-[12.5px] text-[#8A92A0]">
                  This route should record a before/after, but none was captured —
                  missing instrumentation rather than an unchanged record.
                </section>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default ActivityLog;
