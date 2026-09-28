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
import ActivityLogDetails from './ActivityLogDetails';
import { useSensitivePageView } from '../../hooks/useSensitivePageView';
import {
  ACTOR_STYLES,
  OUTCOME_HINTS,
  OUTCOME_STYLES,
  actorTypeLabel,
  areaLabel,
  daysAgoIso,
  describeActivity,
  describeGroup,
  formatDay,
  formatWhen,
  groupActivity,
  hasRecord,
  outcomeLabel,
  recordTypeLabel,
  relativeWhen,
} from './activityLogText';

const PAGE_SIZE = 25;

const todayIso = () => daysAgoIso(0);

/** One label style for every filter, so the bar reads as a single row. */
const LABEL = 'mb-1.5 block text-[12.5px] font-semibold text-[#4B5563]';
const INPUT =
  'h-10 w-full rounded-lg border border-[#D5D9E0] bg-white px-3 text-[14px] text-[#20242C] placeholder:text-[#9AA1AD] focus:border-[#DC2A2A] focus:outline-none focus:ring-2 focus:ring-[#DC2A2A]/20';
const SELECT_TRIGGER =
  'h-10 w-full rounded-lg border border-[#D5D9E0] bg-white px-3 text-[14px] text-[#20242C] text-left flex items-center justify-between gap-2 focus:border-[#DC2A2A] focus:outline-none focus:ring-2 focus:ring-[#DC2A2A]/20';

const PERIODS: Array<{ label: string; from: () => string; to: () => string }> = [
  { label: 'Today', from: todayIso, to: todayIso },
  { label: 'Yesterday', from: () => daysAgoIso(1), to: () => daysAgoIso(1) },
  { label: 'Last 7 days', from: () => daysAgoIso(7), to: todayIso },
  { label: 'Last 30 days', from: () => daysAgoIso(30), to: todayIso },
];

const Chevron: React.FC<{ open?: boolean }> = ({ open }) => (
  <svg
    className={`h-4 w-4 text-[#9AA1AD] transition-transform ${open ? 'rotate-90' : ''}`}
    fill="none"
    stroke="currentColor"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
  </svg>
);

/**
 * Oversight → Activity Log.
 *
 * Read-only by construction: there is no edit or delete control anywhere on this
 * screen, and the API exposes none. Filters live in the URL so an investigation
 * can be shared as a link.
 */
const ActivityLog: React.FC = () => {
  // Opening this screen is itself worth recording — see the hook.
  useSensitivePageView('activity-log');

  const [params, setParams] = useSearchParams();
  const [selected, setSelected] = useState<ActivityLogRow | null>(null);
  const [searchInput, setSearchInput] = useState(params.get('search') ?? '');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

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
      entity_ref: params.get('entity_ref') ?? '',
      actor_role: params.get('actor_role') ?? '',
      branch_id: params.get('branch_id') ?? '',
      brand_id: params.get('brand_id') ?? '',
      ip: params.get('ip') ?? '',
      search: params.get('search') ?? '',
      page: Number(params.get('page') ?? 1),
    }),
    [params]
  );

  const setFilters = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    Object.entries(changes).forEach(([key, value]) => {
      if (value) next.set(key, value);
      else next.delete(key);
    });
    if (!('page' in changes)) next.delete('page');
    setParams(next, { replace: true });
  };

  const setFilter = (key: string, value: string) => setFilters({ [key]: value });

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
        entity_ref: filters.entity_ref || undefined,
        actor_role: filters.actor_role || undefined,
        branch_id: filters.branch_id ? Number(filters.branch_id) : undefined,
        brand_id: filters.brand_id ? Number(filters.brand_id) : undefined,
        ip: filters.ip || undefined,
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

  const rows = useMemo(() => data?.data ?? [], [data]);
  const groups = useMemo(() => groupActivity(rows), [rows]);
  const rangeError =
    isError && (error as { response?: { status?: number } })?.response?.status === 400;

  const clearAll = () => {
    setSearchInput('');
    setParams(new URLSearchParams(), { replace: true });
  };

  const toggleGroup = (key: string) =>
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const showIp = (ip: string) => {
    setSelected(null);
    setFilter('ip', ip);
  };

  // Everything that ever happened to one record — the record lens.
  const showRecord = (row: ActivityLogRow) => {
    if (!row.entity_type || !row.entity_id) return;
    setSelected(null);
    setSearchInput('');
    const next = new URLSearchParams({
      entity_type: row.entity_type,
      entity_id: row.entity_id,
    });
    if (row.entity_label) next.set('entity_label', row.entity_label);
    setParams(next, { replace: true });
  };

  const branchNames = useMemo(
    () => new Map((options?.branches ?? []).map((b) => [b.id, b.name])),
    [options]
  );
  const brandNames = useMemo(
    () => new Map((options?.brands ?? []).map((b) => [b.id, b.name])),
    [options]
  );
  const branchName = (id: number | null) =>
    id == null ? null : (branchNames.get(id) ?? `Branch #${id}`);
  const brandName = (id: number | null) =>
    id == null ? null : (brandNames.get(id) ?? `Brand #${id}`);

  const where = (row: ActivityLogRow) => (
    <td className="px-5 py-3.5 align-top">
      {row.branch_id == null && row.brand_id == null ? (
        <span className="text-[#9AA1AD]">—</span>
      ) : (
        <>
          <div className="text-[13.5px] text-[#20242C]">
            {branchName(row.branch_id) ?? brandName(row.brand_id)}
          </div>
          {row.branch_id != null && row.brand_id != null && (
            <div className="mt-0.5 text-[12.5px] text-[#6B7280]">
              {brandName(row.brand_id)}
            </div>
          )}
        </>
      )}
    </td>
  );

  const who = (row: ActivityLogRow) => (
    <td className="px-5 py-3.5 align-top">
      <div className="text-[14px] font-semibold text-[#20242C]">
        {row.actor_label ?? actorTypeLabel(row.actor_type)}
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {/* Role AT THE TIME of the action, not today's role */}
        {(row.actor_role_names ?? []).map((r) => (
          <span key={r} className="text-[12.5px] text-[#4B5563]">
            {r}
          </span>
        ))}
        {row.actor_is_super_admin && (
          <span className="text-[12.5px] font-semibold text-purple-700">Super admin</span>
        )}
        {row.actor_type !== 'staff' && (
          <span
            className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${
              ACTOR_STYLES[row.actor_type] ?? 'bg-gray-100 text-gray-600'
            }`}
          >
            {actorTypeLabel(row.actor_type)}
          </span>
        )}
      </div>
    </td>
  );

  const when = (row: ActivityLogRow) => (
    <td className="whitespace-nowrap px-5 py-3.5 align-top">
      <div className="text-[13.5px] font-medium tabular-nums text-[#20242C]">
        {formatWhen(row.created_at)}
      </div>
      <div className="mt-0.5 text-[12.5px] text-[#6B7280]">
        {relativeWhen(row.created_at)}
      </div>
    </td>
  );

  const outcome = (row: ActivityLogRow) => (
    <td className="whitespace-nowrap px-5 py-3.5 align-top">
      <span
        title={OUTCOME_HINTS[row.outcome]}
        className={`rounded-full border px-2.5 py-0.5 text-[12px] font-semibold ${
          OUTCOME_STYLES[row.outcome] ?? 'border-gray-200 bg-gray-50 text-gray-600'
        }`}
      >
        {outcomeLabel(row.outcome)}
      </span>
    </td>
  );

  const address = (row: ActivityLogRow) => (
    <td className="whitespace-nowrap px-5 py-3.5 align-top">
      {row.ip ? (
        <button
          type="button"
          title="Show all activity from this address"
          onClick={(e) => {
            e.stopPropagation();
            showIp(row.ip!);
          }}
          className="rounded font-mono text-[13px] text-[#374151] underline decoration-[#D5D9E0] underline-offset-4 hover:text-[#DC2A2A] hover:decoration-[#DC2A2A]"
        >
          {row.ip}
        </button>
      ) : (
        <span className="text-[#9AA1AD]">—</span>
      )}
    </td>
  );

  const record = (row: ActivityLogRow) => (
    <td className="px-5 py-3.5 align-top">
      {hasRecord(row) ? (
        <>
          <div className="text-[13.5px] text-[#20242C]">
            {row.entity_label ?? `#${row.entity_id}`}
          </div>
          {row.entity_type && (
            <div className="mt-0.5 text-[12.5px] text-[#6B7280]">
              {row.entity_type.replace(/[-_]/g, ' ')}
              {row.entity_label && row.entity_id ? ` #${row.entity_id}` : ''}
            </div>
          )}
          {row.entity_type && row.entity_id && !isRecordLens && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                showRecord(row);
              }}
              className="mt-1 text-[12.5px] font-semibold text-[#DC2A2A] hover:underline"
            >
              Full history
            </button>
          )}
        </>
      ) : (
        <span className="text-[#9AA1AD]">—</span>
      )}
    </td>
  );

  const changeMarks = (row: ActivityLogRow) => (
    <>
      {row.changed_fields && row.changed_fields.length > 0 && (
        <span className="rounded bg-indigo-50 px-1.5 py-0.5 text-[11.5px] font-semibold text-indigo-700">
          {row.changed_fields.length}{' '}
          {row.changed_fields.length === 1 ? 'field changed' : 'fields changed'}
        </span>
      )}
      {row.diff_expected &&
        (!row.changed_fields || row.changed_fields.length === 0) && (
          <span
            className="text-[11.5px] text-[#9AA1AD]"
            title="This route should record a before/after but none was captured — missing instrumentation."
          >
            no diff
          </span>
        )}
    </>
  );

  return (
    <div className="mx-auto max-w-[1500px] px-9 pb-20 pt-8 text-[#1F2430]">
      <div className="mb-[22px] flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="mb-[5px] text-xs font-semibold text-[#6B7280]">Oversight</div>
          {isRecordLens ? (
            <>
              <h1 className="mb-1.5 text-[27px] font-extrabold tracking-[-0.02em]">
                {params.get('entity_label') || filters.entity_type.replace(/_/g, ' ')}
                {params.get('entity_label') ? '' : ` #${filters.entity_id}`}
              </h1>
              <p className="text-[14px] text-[#4B5563]">
                Full history of this record, newest first · last 12 months
              </p>
              <button
                type="button"
                onClick={clearAll}
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
              <p className="text-[14px] text-[#4B5563]">
                Who did what, when and from where — append-only, and nothing here can be
                edited or deleted
              </p>
            </>
          )}
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <ActivityLogSettingsPanel />
        </div>
      </div>

      <CaptureStateBanner />

      <Card className="mb-[18px] rounded-2xl border border-[#ECEDF0] p-5 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
          <div>
            <span className={LABEL}>Period</span>
            <div className="flex h-10 overflow-hidden rounded-lg border border-[#D5D9E0]">
              {PERIODS.map((period) => {
                const active =
                  filters.date_from === period.from() && filters.date_to === period.to();
                return (
                  <button
                    key={period.label}
                    type="button"
                    aria-pressed={active}
                    onClick={() =>
                      setFilters({ date_from: period.from(), date_to: period.to() })
                    }
                    className={`border-r border-[#D5D9E0] px-3.5 text-[13.5px] font-semibold transition last:border-r-0 ${
                      active
                        ? 'bg-[#20242C] text-white'
                        : 'bg-white text-[#374151] hover:bg-[#F3F4F6]'
                    }`}
                  >
                    {period.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div>
            <label className={LABEL} htmlFor="activity-from">
              From
            </label>
            <input
              id="activity-from"
              type="date"
              aria-label="From date"
              value={filters.date_from}
              max={filters.date_to}
              onChange={(e) => setFilter('date_from', e.target.value)}
              className={INPUT}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="activity-to">
              To
            </label>
            <input
              id="activity-to"
              type="date"
              aria-label="To date"
              value={filters.date_to}
              min={filters.date_from}
              onChange={(e) => setFilter('date_to', e.target.value)}
              className={INPUT}
            />
          </div>
        </div>

        {/* Who and where */}
        <div className="mt-4 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-5 lg:items-end">
          <div>
            <span className={LABEL}>Person</span>
            <SearchableSelect
              ariaLabel="Who"
              minWidth="min-w-0"
              triggerClassName={SELECT_TRIGGER}
              value={filters.actor_user_id}
              onChange={(v) => setFilter('actor_user_id', v)}
              options={[
                { value: '', label: 'Anyone' },
                ...(options?.actors ?? []).map((a) => ({
                  value: String(a.actor_user_id),
                  label: a.actor_label ?? `user#${a.actor_user_id}`,
                  inactive: a.is_active === false,
                })),
              ]}
            />
          </div>
          <div>
            <span className={LABEL}>Role at the time</span>
            <SearchableSelect
              ariaLabel="Role"
              minWidth="min-w-0"
              triggerClassName={SELECT_TRIGGER}
              value={filters.actor_role}
              onChange={(v) => setFilter('actor_role', v)}
              options={[
                { value: '', label: 'Any role' },
                ...(options?.roles ?? []).map((r) => ({
                  value: r.slugs.join(','),
                  label: r.name,
                })),
              ]}
            />
          </div>
          <div>
            <span className={LABEL}>Branch</span>
            <SearchableSelect
              ariaLabel="Branch"
              minWidth="min-w-0"
              triggerClassName={SELECT_TRIGGER}
              value={filters.branch_id}
              onChange={(v) => setFilter('branch_id', v)}
              options={[
                { value: '', label: 'All branches' },
                ...(options?.branches ?? []).map((b) => ({
                  value: String(b.id),
                  label: b.name,
                  inactive: b.is_active === false,
                })),
              ]}
            />
          </div>
          <div>
            <span className={LABEL}>Brand</span>
            <SearchableSelect
              ariaLabel="Brand"
              minWidth="min-w-0"
              triggerClassName={SELECT_TRIGGER}
              value={filters.brand_id}
              onChange={(v) => setFilter('brand_id', v)}
              options={[
                { value: '', label: 'All brands' },
                ...(options?.brands ?? []).map((b) => ({
                  value: String(b.id),
                  label: b.name,
                  inactive: b.is_active === false,
                })),
              ]}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="activity-ip">
              IP address
            </label>
            {/* Exact match, so it is applied on Enter or on leaving the box
                rather than on every keystroke of a half-typed address. */}
            <input
              id="activity-ip"
              key={filters.ip}
              defaultValue={filters.ip}
              placeholder="e.g. 101.53.234.92"
              onBlur={(e) => {
                const value = e.target.value.trim();
                if (value !== filters.ip) setFilter('ip', value);
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur();
              }}
              className={`${INPUT} font-mono`}
            />
          </div>
        </div>

        {/* What */}
        <div className="mt-3 grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2 lg:grid-cols-[1fr,1fr,1.1fr,0.9fr,1.5fr,auto] lg:items-end">
          <div>
            <span className={LABEL}>Area</span>
            <SearchableSelect
              ariaLabel="Area"
              minWidth="min-w-0"
              triggerClassName={SELECT_TRIGGER}
              value={filters.action_group}
              onChange={(v) => setFilter('action_group', v)}
              options={[
                { value: '', label: 'All areas' },
                ...(options?.action_groups ?? []).map((g) => ({
                  value: g,
                  label: areaLabel(g),
                })),
              ]}
            />
          </div>
          {!isRecordLens && (
            <>
              <div>
                <span className={LABEL}>Record type</span>
                <SearchableSelect
                  ariaLabel="Record type"
                  minWidth="min-w-0"
                  triggerClassName={SELECT_TRIGGER}
                  value={filters.entity_type}
                  onChange={(v) => setFilter('entity_type', v)}
                  options={[
                    { value: '', label: 'Any record' },
                    ...(options?.record_types ?? ['order']).map((t) => ({
                      value: t,
                      label: recordTypeLabel(t),
                    })),
                  ]}
                />
              </div>
              <div>
                <label className={LABEL} htmlFor="activity-record">
                  Record number or name
                </label>
                <input
                  id="activity-record"
                  key={filters.entity_ref}
                  defaultValue={filters.entity_ref}
                  placeholder={
                    filters.entity_type === 'order'
                      ? 'e.g. 013 or FDS-A7K2M9QX'
                      : 'e.g. 013, Pepperoni Pizza'
                  }
                  onBlur={(e) => {
                    const value = e.target.value.trim();
                    if (value !== filters.entity_ref) setFilter('entity_ref', value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur();
                  }}
                  className={INPUT}
                />
              </div>
            </>
          )}
          <div>
            <span className={LABEL}>Result</span>
            <SearchableSelect
              ariaLabel="Outcome"
              minWidth="min-w-0"
              triggerClassName={SELECT_TRIGGER}
              value={filters.outcome}
              onChange={(v) => setFilter('outcome', v)}
              options={[
                { value: '', label: 'Any result' },
                ...(options?.outcomes ?? []).map((o) => ({
                  value: o,
                  label: outcomeLabel(o),
                })),
              ]}
            />
          </div>
          <div>
            <label className={LABEL} htmlFor="activity-search">
              Search
            </label>
            <input
              id="activity-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Person, record, action or IP…"
              className={INPUT}
            />
          </div>
          <button
            type="button"
            onClick={clearAll}
            className="h-10 rounded-lg border border-[#D5D9E0] bg-white px-4 text-[13.5px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6]"
          >
            Clear filters
          </button>
        </div>

        {filters.entity_type === 'order' && filters.entity_ref && !isRecordLens && (
          <p className="mt-3 text-[12.5px] text-[#6B7280]">
            Order numbers restart every day at each branch and brand, so this finds
            order {filters.entity_ref} among orders placed in the period above. Pick a
            branch or brand to narrow it, or use “Full history” on a row to follow one
            order.
          </p>
        )}

        {data && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-[#F1F2F5] pt-4">
            <span className="mr-1 text-[13.5px] text-[#4B5563]">
              <span className="font-bold text-[#20242C]">
                {data.total.toLocaleString()}
              </span>{' '}
              {data.total === 1 ? 'entry' : 'entries'}, {formatDay(filters.date_from)} –{' '}
              {formatDay(filters.date_to)}
            </span>
            {Object.entries(data.outcome_counts).map(([key, count]) => (
              <button
                key={key}
                type="button"
                title={OUTCOME_HINTS[key]}
                aria-pressed={filters.outcome === key}
                onClick={() => setFilter('outcome', filters.outcome === key ? '' : key)}
                className={`rounded-full border px-3 py-1 text-[12.5px] font-semibold transition ${
                  OUTCOME_STYLES[key] ?? 'border-gray-200 bg-gray-50 text-gray-600'
                } ${filters.outcome === key ? 'ring-2 ring-[#DC2A2A]/40 ring-offset-1' : 'hover:brightness-95'}`}
              >
                {outcomeLabel(key)} {count.toLocaleString()}
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
                <tr className="border-b border-[#ECEDF0] bg-[#F7F8FA] text-left text-[12.5px] font-semibold text-[#4B5563]">
                  <th className="px-5 py-3">When</th>
                  <th className="px-5 py-3">Who</th>
                  <th className="px-5 py-3">What happened</th>
                  <th className="px-5 py-3">Record</th>
                  <th className="px-5 py-3">Branch / brand</th>
                  <th className="px-5 py-3">Result</th>
                  <th className="px-5 py-3">IP address</th>
                  <th className="px-5 py-3" />
                </tr>
              </thead>
              <tbody>
                {groups.map((group) => {
                  const first = group.rows[0];
                  const folded = group.rows.length > 1;
                  const isOpen = expanded.has(first.id);
                  const { title, detail: groupDetail } = describeGroup(group);
                  return (
                    <React.Fragment key={first.id}>
                      <tr
                        onClick={() =>
                          folded ? toggleGroup(first.id) : setSelected(first)
                        }
                        aria-expanded={folded ? isOpen : undefined}
                        className="cursor-pointer border-b border-[#F1F2F5] last:border-0 hover:bg-[#F7F8FA]"
                      >
                        {when(first)}
                        {who(first)}
                        <td className="px-5 py-3.5 align-top">
                          <div className="text-[14px] font-medium text-[#20242C]">
                            {title}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-2">
                            {folded ? (
                              <>
                                <span className="rounded bg-[#EEF0F3] px-1.5 py-0.5 text-[11.5px] font-semibold text-[#374151]">
                                  {group.rows.length} entries
                                </span>
                                {groupDetail && (
                                  <span className="text-[12.5px] text-[#6B7280]">
                                    {groupDetail}
                                  </span>
                                )}
                              </>
                            ) : (
                              <>
                                <span className="text-[12.5px] text-[#6B7280]">
                                  {areaLabel(first.action_group)}
                                </span>
                                {changeMarks(first)}
                              </>
                            )}
                          </div>
                        </td>
                        {folded ? (
                          <td className="px-5 py-3.5 align-top text-[#9AA1AD]">—</td>
                        ) : (
                          record(first)
                        )}
                        {where(first)}
                        {outcome(first)}
                        {address(first)}
                        <td className="px-5 py-3.5 text-right align-top">
                          <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#DC2A2A]">
                            {folded ? (isOpen ? 'Hide' : 'Show all') : 'Details'}
                            <Chevron open={folded && isOpen} />
                          </span>
                        </td>
                      </tr>
                      {folded &&
                        isOpen &&
                        group.rows.map((row) => (
                          <tr
                            key={row.id}
                            onClick={() => setSelected(row)}
                            className="cursor-pointer border-b border-[#F1F2F5] bg-[#FAFBFC] hover:bg-[#F3F4F6]"
                          >
                            <td className="whitespace-nowrap py-2.5 pl-9 pr-5 text-[12.5px] tabular-nums text-[#6B7280]">
                              {formatWhen(row.created_at)}
                            </td>
                            <td />
                            <td className="px-5 py-2.5 text-[13.5px] text-[#20242C]" colSpan={3}>
                              {describeActivity(row)}
                            </td>
                            {outcome(row)}
                            <td />
                            <td className="px-5 py-2.5 text-right">
                              <span className="inline-flex items-center gap-1 text-[12.5px] font-semibold text-[#DC2A2A]">
                                Details
                                <Chevron />
                              </span>
                            </td>
                          </tr>
                        ))}
                    </React.Fragment>
                  );
                })}
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
        <ActivityLogDetails
          selected={selected}
          detail={detail}
          related={related}
          branchName={branchName(selected.branch_id)}
          brandName={brandName(selected.brand_id)}
          onClose={() => setSelected(null)}
          onShowIp={showIp}
          onShowRecord={isRecordLens ? undefined : () => showRecord(selected)}
        />
      )}
    </div>
  );
};

export default ActivityLog;
