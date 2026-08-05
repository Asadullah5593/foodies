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

/** Renders a diff value, keeping `[redacted]` visibly removed rather than absent. */
const DiffValue: React.FC<{ value: unknown }> = ({ value }) => {
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

  const filters = useMemo(
    () => ({
      date_from: params.get('date_from') ?? daysAgoIso(7),
      date_to: params.get('date_to') ?? todayIso(),
      outcome: params.get('outcome') ?? '',
      action_group: params.get('action_group') ?? '',
      actor_user_id: params.get('actor_user_id') ?? '',
      actor_type: params.get('actor_type') ?? '',
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
    <div className="mx-auto max-w-[1500px] p-6">
      <div className="mb-5">
        <div className="mb-1 text-xs font-semibold text-gray-400">Reports</div>
        <h1 className="text-2xl font-bold text-gray-800">Activity Log</h1>
        <p className="mt-1 text-sm text-gray-500">
          Who did what, when, from where — and what the value was before. Append-only:
          entries cannot be edited or deleted from this screen.
        </p>
      </div>

      <Card className="mb-4 p-4">
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
                className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                  OUTCOME_STYLES[outcome] ?? 'border-gray-200 bg-gray-50 text-gray-600'
                } ${filters.outcome === outcome ? 'ring-2 ring-offset-1' : ''}`}
              >
                {outcome}: {count}
              </button>
            ))}
          </div>
        )}
      </Card>

      <Card className="overflow-hidden p-0">
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
                <tr className="border-b border-gray-200 bg-gray-50 text-left text-xs uppercase tracking-wide text-gray-500">
                  <th className="px-4 py-2.5">When</th>
                  <th className="px-4 py-2.5">Who</th>
                  <th className="px-4 py-2.5">Action</th>
                  <th className="px-4 py-2.5">Record</th>
                  <th className="px-4 py-2.5">Outcome</th>
                  <th className="px-4 py-2.5">From</th>
                  <th className="px-4 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr
                    key={row.id}
                    onClick={() => setSelected(row)}
                    className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-gray-50"
                  >
                    <td className="whitespace-nowrap px-4 py-2.5 tabular-nums text-gray-600">
                      {formatWhen(row.created_at)}
                    </td>
                    <td className="px-4 py-2.5">
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
                    <td className="px-4 py-2.5">
                      <span className="font-mono text-xs text-gray-800">{row.action}</span>
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
                    <td className="px-4 py-2.5 text-gray-600">
                      {row.entity_label ??
                        (row.entity_type
                          ? `${row.entity_type}${row.entity_id ? ` #${row.entity_id}` : ''}`
                          : '—')}
                    </td>
                    <td className="px-4 py-2.5">
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
                    <td className="px-4 py-2.5 font-mono text-xs text-gray-500">
                      {row.ip ?? '—'}
                    </td>
                    <td className="px-4 py-2.5 text-right text-xs text-blue-600">View</td>
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
            className="border-t border-gray-100 px-4 py-3"
          />
        )}
      </Card>

      {selected && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/30">
          <div className="h-full w-full max-w-2xl overflow-y-auto bg-white shadow-xl">
            <div className="flex items-start justify-between border-b border-gray-200 p-5">
              <div>
                <div className="font-mono text-sm font-bold text-gray-800">
                  {selected.action}
                </div>
                <div className="mt-1 text-xs text-gray-500">
                  {formatWhen(selected.created_at)} · {selected.http_method}{' '}
                  {selected.route}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelected(null)}
                aria-label="Close"
                className="rounded-lg px-3 py-1 text-gray-500 hover:bg-gray-100"
              >
                ✕
              </button>
            </div>

            <div className="space-y-5 p-5">
              <section>
                <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                  Who
                </h3>
                <div className="rounded-lg bg-gray-50 p-3 text-sm">
                  <div className="font-medium text-gray-800">
                    {selected.actor_label ?? 'Unknown'}{' '}
                    <span className="text-xs text-gray-500">({selected.actor_type})</span>
                  </div>
                  <div className="mt-1 text-xs text-gray-600">
                    {/* Labelled explicitly: roles are edited over time */}
                    Role at the time of the action:{' '}
                    {selected.actor_role_names?.length
                      ? selected.actor_role_names.join(', ')
                      : selected.actor_is_super_admin
                        ? 'super admin (unrestricted)'
                        : 'none recorded'}
                  </div>
                  <div className="mt-1 text-xs text-gray-500">
                    IP {selected.ip ?? '—'} · request {selected.request_id ?? '—'}
                  </div>
                </div>
              </section>

              {detail?.changes && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                    What changed
                  </h3>
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-xs text-gray-500">
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
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                    Request
                    {detail.payload_truncated && (
                      <span className="ml-2 font-normal normal-case text-gray-400">
                        (truncated)
                      </span>
                    )}
                  </h3>
                  <pre className="overflow-x-auto rounded-lg bg-gray-900 p-3 text-xs text-gray-100">
                    {JSON.stringify(detail.request_body, null, 2)}
                  </pre>
                </section>
              )}

              {related && related.length > 1 && (
                <section>
                  <h3 className="mb-2 text-xs font-bold uppercase tracking-wide text-gray-500">
                    Same request
                  </h3>
                  <ul className="space-y-1 text-xs">
                    {related.map((r) => (
                      <li key={r.id} className="flex justify-between rounded bg-gray-50 px-2 py-1">
                        <span className="font-mono">{r.action}</span>
                        <span className="text-gray-500">{r.outcome}</span>
                      </li>
                    ))}
                  </ul>
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
