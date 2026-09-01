import React, { useMemo, useState } from 'react';
import { labelWithStatus } from '../../../utils/entityStatus';
import {
  useQuery,
  useMutation,
  useQueryClient,
  keepPreviousData,
} from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Button from '../../../components/Button';
import Loader from '../../../components/Loader';
import { useHasPermission } from '../../../hooks/useHasPermission';
import { adminService } from '../../../services/api/adminService';
import RiderHrmHeader from './RiderHrmHeader';
import {
  riderSupervisorService,
  SupervisorDeliveryOrder,
  SupervisorDeliveryStatus,
  SupervisorFilterOption,
  SupervisorFilterOptions,
  SupervisorRider,
  SupervisorRiderStatus,
} from '../../../services/api/riderSupervisorService';

type Tab = 'orders' | 'riders';

const PAGE_SIZE = 25;

const ORDER_STATUS_TABS: { key: SupervisorDeliveryStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'delivered', label: 'Delivered' },
  { key: 'cancelled', label: 'Cancelled' },
];

/** Settable statuses — identical to the admin Order detail page's dropdown. */
const ORDER_STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: 'placed', label: 'Placed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

const RIDER_STATUS_TABS: { key: 'all' | SupervisorRiderStatus; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'on_break', label: 'On break' },
  { key: 'off', label: 'Off' },
];

const fmtDateTime = (iso: string | null): string =>
  iso ? new Date(iso).toLocaleString() : '—';

const fmtMoney = (n: number | null | undefined): string =>
  n == null
    ? '—'
    : `Rs ${Number(n).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;

const orderStatusClasses = (status: string): string => {
  if (status === 'completed')
    return 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300';
  if (status === 'cancelled')
    return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
};

const RIDER_STATUS_META: Record<
  SupervisorRiderStatus,
  { label: string; classes: string }
> = {
  active: {
    label: 'Active',
    classes: 'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-300',
  },
  on_break: {
    label: 'On break',
    classes: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  },
  off: {
    label: 'Off',
    classes: 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-300',
  },
};

const Pill: React.FC<{
  active: boolean;
  label: string;
  count?: number;
  onClick: () => void;
}> = ({ active, label, count, onClick }) => (
  <button
    type="button"
    onClick={onClick}
    className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
      active
        ? 'bg-red-600 text-white'
        : 'bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600'
    }`}
  >
    {label}
    {count != null ? (
      <span
        className={`ml-2 text-xs ${active ? 'text-white/80' : 'text-gray-400 dark:text-slate-400'}`}
      >
        {count}
      </span>
    ) : null}
  </button>
);

/** A compact filter dropdown; render only when there is more than one option. */
const FilterSelect: React.FC<{
  value: number | '';
  onChange: (v: number | '') => void;
  allLabel: string;
  options: SupervisorFilterOption[];
}> = ({ value, onChange, allLabel, options }) => (
  <select
    value={value}
    onChange={(e) => onChange(e.target.value ? Number(e.target.value) : '')}
    className="rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-2 py-1.5 text-gray-800 dark:text-slate-200 focus:ring-2 focus:ring-red-500"
    aria-label={allLabel}
  >
    <option value="">{allLabel}</option>
    {options.map((o) => (
      <option key={o.id} value={o.id}>
        {labelWithStatus(o.name, o)}
      </option>
    ))}
  </select>
);

/** Today / the role's earliest reachable day, as YYYY-MM-DD for date inputs. */
const todayIso = (): string => new Date().toISOString().slice(0, 10);
const earliestIso = (historyDays: number | null): string | undefined => {
  if (historyDays == null || historyDays <= 0) return undefined;
  const d = new Date();
  // N days inclusive of today — matches the server's CURRENT_DATE - N + 1.
  d.setDate(d.getDate() - (historyDays - 1));
  return d.toISOString().slice(0, 10);
};

/** A date-range picker bounded by the role's history window. */
const DateRangeFilter: React.FC<{
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  historyDays: number | null;
}> = ({ from, to, onFrom, onTo, historyDays }) => {
  const min = earliestIso(historyDays);
  const max = todayIso();
  const cls =
    'rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-sm px-2 py-1.5 text-gray-800 dark:text-slate-200 focus:ring-2 focus:ring-red-500';
  return (
    <div className="flex items-center gap-1.5">
      <input
        type="date"
        value={from}
        min={min}
        max={to || max}
        onChange={(e) => onFrom(e.target.value)}
        className={cls}
        aria-label="Orders placed from"
      />
      <span className="text-xs text-gray-500 dark:text-slate-400">to</span>
      <input
        type="date"
        value={to}
        min={from || min}
        max={max}
        onChange={(e) => onTo(e.target.value)}
        className={cls}
        aria-label="Orders placed to"
      />
      {(from || to) && (
        <button
          type="button"
          onClick={() => {
            onFrom('');
            onTo('');
          }}
          className="text-xs font-medium text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200 underline"
        >
          Clear
        </button>
      )}
    </div>
  );
};

const thClass =
  'px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 whitespace-nowrap';
const tdClass = 'px-3 py-2 text-sm text-gray-800 dark:text-slate-200 whitespace-nowrap';

/* ── Delivery orders tab ─────────────────────────────────────────────────── */

const DeliveryOrdersTab: React.FC<{ filters: SupervisorFilterOptions }> = ({
  filters,
}) => {
  const queryClient = useQueryClient();
  // Order status is its own grant on this surface; the server withholds the
  // data as well, so this only decides what to render.
  const canViewStatus = useHasPermission('rider-supervisor:view-status');
  // Changing a status reuses the Orders module's permission and endpoint —
  // one rule for "who may move an order", wherever they do it. Only offered
  // alongside the status column: you cannot sanely set what you cannot see.
  const canUpdateStatus =
    useHasPermission('orders:update-status') && canViewStatus;

  const [status, setStatus] = useState<SupervisorDeliveryStatus>('all');
  const [brandId, setBrandId] = useState<number | ''>('');
  const [branchId, setBranchId] = useState<number | ''>('');
  const [riderId, setRiderId] = useState<number | ''>('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [page, setPage] = useState(1);

  const { data, isLoading, isError } = useQuery({
    queryKey: [
      'supervisor-delivery-orders',
      status,
      brandId,
      branchId,
      riderId,
      dateFrom,
      dateTo,
      page,
    ],
    queryFn: () =>
      riderSupervisorService.getDeliveryOrders({
        status,
        page,
        page_size: PAGE_SIZE,
        brand_id: brandId || undefined,
        branch_id: branchId || undefined,
        rider_id: riderId || undefined,
        date_from: dateFrom || undefined,
        date_to: dateTo || undefined,
      }),
    placeholderData: keepPreviousData,
  });

  const updateStatus = useMutation({
    mutationFn: ({ id, status: next }: { id: number; status: string }) =>
      adminService.updateOrderStatus(id, next),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supervisor-delivery-orders'] });
      toast.success('Order status updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update status');
    },
  });

  const counts = data?.counts;
  const orders: SupervisorDeliveryOrder[] = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <Card className="dark:bg-slate-800 dark:border-slate-700">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        {/* Status filter pills are part of the status permission — without it
            the buckets would reveal exactly what the hidden column shows. */}
        <div className="flex flex-wrap gap-2">
          {canViewStatus &&
            ORDER_STATUS_TABS.map((t) => (
              <Pill
                key={t.key}
                active={status === t.key}
                label={t.label}
                count={counts ? counts[t.key] : undefined}
                onClick={() => {
                  setStatus(t.key);
                  setPage(1);
                }}
              />
            ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(filters.brands ?? []).length > 1 ? (
            <FilterSelect
              value={brandId}
              onChange={(v) => {
                setBrandId(v);
                setPage(1);
              }}
              allLabel="All brands"
              options={filters.brands ?? []}
            />
          ) : null}
          {(filters.branches ?? []).length > 1 ? (
            <FilterSelect
              value={branchId}
              onChange={(v) => {
                setBranchId(v);
                setPage(1);
              }}
              allLabel="All branches"
              options={filters.branches ?? []}
            />
          ) : null}
          {(filters.riders ?? []).length > 1 ? (
            <FilterSelect
              value={riderId}
              onChange={(v) => {
                setRiderId(v);
                setPage(1);
              }}
              allLabel="All riders"
              options={filters.riders ?? []}
            />
          ) : null}
          <DateRangeFilter
            from={dateFrom}
            to={dateTo}
            onFrom={(v) => {
              setDateFrom(v);
              setPage(1);
            }}
            onTo={(v) => {
              setDateTo(v);
              setPage(1);
            }}
            historyDays={filters.history_days ?? null}
          />
          <span className="text-xs text-gray-500 dark:text-slate-400">
            {dateFrom || dateTo
              ? 'by order date'
              : filters.history_days != null
                ? `last ${filters.history_days} days`
                : 'last 30 days'}
            {filters.history_days != null && (
              <span
                className="ml-1 cursor-help underline decoration-dotted"
                title={`Your role can only access the last ${filters.history_days} days of order history.`}
              >
                (role limit)
              </span>
            )}
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader text="Loading delivery orders..." />
        </div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
          Failed to load delivery orders.
        </p>
      ) : orders.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">
          No delivery orders in this view.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead>
              <tr>
                <th className={thClass}>Order</th>
                <th className={thClass}>Placed</th>
                {canViewStatus && <th className={thClass}>Status</th>}
                <th className={thClass}>Delivery</th>
                <th className={thClass}>Rider</th>
                <th className={thClass}>Brand</th>
                <th className={thClass}>Branch</th>
                <th className={thClass}>Customer</th>
                <th className={thClass}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
              {orders.map((o) => (
                <tr key={o.id}>
                  <td className={tdClass}>
                    <span className="font-medium">{o.order_id ?? `#${o.order_number}`}</span>
                    {o.order_id ? (
                      <span className="block text-xs text-gray-400 dark:text-slate-500">
                        #{o.order_number}
                      </span>
                    ) : null}
                  </td>
                  <td className={tdClass}>{fmtDateTime(o.placed_at)}</td>
                  {canViewStatus && (
                    <td className={tdClass}>
                      {canUpdateStatus ? (
                        <select
                          value={o.status ?? ''}
                          disabled={updateStatus.isPending}
                          onChange={(e) =>
                            updateStatus.mutate({ id: o.id, status: e.target.value })
                          }
                          aria-label={`Update status for order ${o.order_id ?? o.order_number}`}
                          className={`rounded-lg border border-gray-300 dark:border-slate-600 bg-white dark:bg-slate-800 text-xs px-2 py-1 text-gray-800 dark:text-slate-200 focus:ring-2 focus:ring-red-500 disabled:opacity-50`}
                        >
                          {ORDER_STATUS_OPTIONS.map((s) => (
                            <option key={s.value} value={s.value}>
                              {s.label}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${orderStatusClasses(o.status ?? '')}`}
                        >
                          {o.status ?? '—'}
                        </span>
                      )}
                    </td>
                  )}
                  <td className={tdClass}>{o.delivery_status ?? '—'}</td>
                  <td className={tdClass}>{o.rider_name ?? '—'}</td>
                  <td className={tdClass}>{o.brand_name ?? '—'}</td>
                  <td className={tdClass}>{o.branch_name ?? '—'}</td>
                  <td className={tdClass}>
                    <span>{o.customer_name ?? '—'}</span>
                    {o.customer_phone ? (
                      <span className="block text-xs text-gray-400 dark:text-slate-500">
                        {o.customer_phone}
                      </span>
                    ) : null}
                  </td>
                  <td className={tdClass}>{fmtMoney(o.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {total > PAGE_SIZE ? (
        <div className="mt-4 flex items-center justify-between">
          <span className="text-xs text-gray-500 dark:text-slate-400">
            Page {page} of {totalPages} · {total} orders
          </span>
          <div className="flex gap-2">
            <Button
              size="small"
              variant="outline"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <Button
              size="small"
              variant="outline"
              disabled={page >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </Card>
  );
};

/* ── Riders tab ──────────────────────────────────────────────────────────── */

const RidersTab: React.FC<{ filters: SupervisorFilterOptions }> = ({ filters }) => {
  const [status, setStatus] = useState<'all' | SupervisorRiderStatus>('all');
  const [brandId, setBrandId] = useState<number | ''>('');
  const [riderId, setRiderId] = useState<number | ''>('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['supervisor-riders', brandId, riderId],
    queryFn: () =>
      riderSupervisorService.getRiders({
        brand_id: brandId || undefined,
        rider_id: riderId || undefined,
      }),
    refetchInterval: 30000,
  });

  const riders: SupervisorRider[] = useMemo(() => data ?? [], [data]);

  const counts = useMemo(
    () => ({
      all: riders.length,
      active: riders.filter((r) => r.status === 'active').length,
      on_break: riders.filter((r) => r.status === 'on_break').length,
      off: riders.filter((r) => r.status === 'off').length,
    }),
    [riders]
  );

  const visible = useMemo(
    () => (status === 'all' ? riders : riders.filter((r) => r.status === status)),
    [riders, status]
  );

  return (
    <Card className="dark:bg-slate-800 dark:border-slate-700">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between mb-4">
        <div className="flex flex-wrap gap-2">
          {RIDER_STATUS_TABS.map((t) => (
            <Pill
              key={t.key}
              active={status === t.key}
              label={t.label}
              count={counts[t.key]}
              onClick={() => setStatus(t.key)}
            />
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {(filters.brands ?? []).length > 1 ? (
            <FilterSelect
              value={brandId}
              onChange={setBrandId}
              allLabel="All brands"
              options={filters.brands ?? []}
            />
          ) : null}
          {(filters.riders ?? []).length > 1 ? (
            <FilterSelect
              value={riderId}
              onChange={setRiderId}
              allLabel="All riders"
              options={filters.riders ?? []}
            />
          ) : null}
          {/* No date filter here on purpose: this is live attendance state,
              not order history — dates would read as a period report. */}
          <span className="text-xs text-gray-500 dark:text-slate-400">
            Live roster · refreshes every 30s
          </span>
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 flex justify-center">
          <Loader text="Loading riders..." />
        </div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-red-600 dark:text-red-400">
          Failed to load riders.
        </p>
      ) : visible.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-500 dark:text-slate-400">
          No riders in this view.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-slate-700">
            <thead>
              <tr>
                <th className={thClass}>Rider</th>
                <th className={thClass}>Phone</th>
                <th className={thClass}>Email</th>
                <th className={thClass}>Status</th>
                <th className={thClass}>Brand</th>
                <th className={thClass}>Branch</th>
                <th className={thClass}>Base salary</th>
                <th className={thClass}>Last check-in</th>
                <th className={thClass}>Last check-out</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 dark:divide-slate-700/60">
              {visible.map((r) => {
                const meta = RIDER_STATUS_META[r.status];
                return (
                  <tr key={r.rider_user_id}>
                    <td className={`${tdClass} font-medium`}>{r.name}</td>
                    <td className={tdClass}>{r.phone ?? '—'}</td>
                    <td className={tdClass}>{r.email ?? '—'}</td>
                    <td className={tdClass}>
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${meta.classes}`}
                      >
                        {meta.label}
                      </span>
                      {r.status === 'on_break' && r.pause_reason ? (
                        <span className="block text-xs text-gray-400 dark:text-slate-500">
                          {r.pause_reason}
                        </span>
                      ) : null}
                    </td>
                    <td className={tdClass}>
                      {r.brands.length ? r.brands.join(', ') : '—'}
                    </td>
                    <td className={tdClass}>{r.branch_name ?? '—'}</td>
                    <td className={tdClass}>{fmtMoney(r.base_salary)}</td>
                    <td className={tdClass}>{fmtDateTime(r.last_check_in_at)}</td>
                    <td className={tdClass}>{fmtDateTime(r.last_check_out_at)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
};

/* ── Page ────────────────────────────────────────────────────────────────── */

const EMPTY_FILTERS: SupervisorFilterOptions = {
  brands: [],
  branches: [],
  riders: [],
  history_days: null,
};

const RiderSupervisor: React.FC = () => {
  const [tab, setTab] = useState<Tab>('orders');

  const { data: filters } = useQuery({
    queryKey: ['supervisor-filters'],
    queryFn: () => riderSupervisorService.getFilterOptions(),
    staleTime: 5 * 60 * 1000,
  });
  const filterOptions = filters ?? EMPTY_FILTERS;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 space-y-6">
      <RiderHrmHeader
        title="Rider Supervisor"
        subtitle="Read-only oversight — recent delivery orders and the live rider roster with attendance and base salary. Salary edits and user accounts are managed on the admin side."
      />

      <div className="flex gap-2 border-b border-gray-200 dark:border-slate-700">
        {(
          [
            { key: 'orders', label: 'Delivery orders' },
            { key: 'riders', label: 'Riders' },
          ] as { key: Tab; label: string }[]
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.key
                ? 'border-red-600 text-red-600 dark:text-red-400 dark:border-red-400'
                : 'border-transparent text-gray-500 hover:text-gray-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'orders' ? (
        <DeliveryOrdersTab filters={filterOptions} />
      ) : (
        <RidersTab filters={filterOptions} />
      )}
    </div>
  );
};

export default RiderSupervisor;
