import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { adminService } from '../../services/api';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import { useHasPermission, useHasRestriction } from '../../hooks/useHasPermission';
import Modal from '../../components/Modal';
import PaginationBar from '../../components/PaginationBar';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import { useTypeaheadSuggestions } from '../../hooks/useTypeaheadSuggestions';
import TypeaheadDropdown from '../../components/TypeaheadDropdown';
import {
  CUSTOMER_SOURCES,
  CUSTOMER_SOURCE_BADGE,
  CUSTOMER_SOURCE_LABEL,
  customerSourceLabel,
} from '../../utils/customerSources';
import { useSensitivePageView } from '../../hooks/useSensitivePageView';
import { LoyaltyPointsCell } from '../../components/LoyaltyWallets';
import HoverReveal, { HOVER_CUE } from '../../components/HoverReveal';
import RowActionsMenu, { type RowAction } from '../../components/RowActionsMenu';
import CustomerVouchersModal from '../../components/CustomerVouchersModal';
import CustomerFormModal from '../../components/CustomerFormModal';
import { useAuth } from '../../contexts/AuthContext';
import { canAccessPath } from '../../lib/pathPermissions';
import { NO_TOTALS_PERMISSION } from '../../lib/orderStatusPermissions';
import { customerOrdersPath } from '../../utils/customerOrdersPath';
import { formatRs, nameInitials } from '../../utils/customerDisplay';
import { daysAgoLabel, formatDay } from '../../utils/dateDisplay';
import {
  type CustomerFilters,
  type CustomerRow,
  type SortDir,
  type SortKey,
  FILTER_PARAM,
  LAST_ORDER_OPTIONS,
  ORDERS_OPTIONS,
  POINTS_OPTIONS,
  SEGMENTS,
  SORT_KEYS,
  activeFilterCount,
  customerStatus,
  defaultSortDir,
  filterCustomers,
  filtersFromParams,
  moreFilterCount,
  optionsFrom,
  segmentCounts,
  sortCustomers,
} from '../../utils/customerFilters';
import { cu, STATUS_TEXT } from './customersUi';

type Customer = CustomerRow;

const PAGE_SIZE_OPTIONS = [10, 25, 50, 100];
const DEFAULT_TABLE_PAGE_SIZE = 25;

/** The two-way arrow in a sortable heading; the lit half is the current direction. */
const SortIcon: React.FC<{ state: 'none' | 'asc' | 'desc' }> = ({ state }) => (
  <svg width="8" height="12" viewBox="0 0 8 12" aria-hidden="true" className="flex-none">
    <path d="M4 0.5 7.5 5h-7z" fill="currentColor" opacity={state === 'asc' ? 1 : state === 'none' ? 0.55 : 0.2} />
    <path d="M4 11.5 0.5 7h7z" fill="currentColor" opacity={state === 'desc' ? 1 : state === 'none' ? 0.55 : 0.2} />
  </svg>
);

// The actions stay pinned to the right edge while the other columns scroll
// sideways: on a narrow screen they would otherwise be the first thing lost.
const stickyCls = 'sticky right-0 z-[1] shadow-[-8px_0_8px_-8px_rgba(15,23,42,.14)]';

/**
 * A cell holding a list of names: the first, and a "+N more" that lists them
 * all on hover. The dotted underline is what tells the user to hover.
 */
const NameList: React.FC<{ items?: { id: number; name: string }[]; noun: 'brand' | 'branch' }> = ({ items, noun }) => {
  const list = items ?? [];
  if (list.length === 0) return <span className={cu.faint}>—</span>;
  const plural = noun === 'brand' ? 'brands' : 'branches';
  return (
    <div className="flex min-w-0 items-center gap-1.5">
      <span className={`truncate text-[13px] ${noun === 'brand' ? cu.text : cu.soft}`}>{list[0].name}</span>
      {list.length > 1 && (
        <HoverReveal
          heading={`${noun === 'brand' ? 'Brands' : 'Branches'} (${list.length})`}
          label={`Show all ${list.length} ${plural}`}
          className={`flex-none whitespace-nowrap text-[11.5px] font-bold ${cu.soft}`}
          content={
            <ul className="flex flex-col gap-1.5">
              {list.map((b) => (
                <li key={b.id} className={`text-[12.5px] ${cu.text}`}>{b.name}</li>
              ))}
            </ul>
          }
        >
          +{list.length - 1} more
        </HoverReveal>
      )}
    </div>
  );
};

const Customers: React.FC = () => {
  // Opening this screen is itself worth recording — see the hook.
  useSensitivePageView('customers');
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const canCreate = useHasPermission('customers:create');
  const canEdit = useHasPermission('customers:edit');
  const canDelete = useHasPermission('customers:delete');
  // The history lives in the Orders module, so it is only offered to someone
  // who can open it — and it shows them what Orders would anyway.
  const { user } = useAuth();
  const canViewOrders = canAccessPath(user, '/admin/orders');
  // `orders:view:no-totals` takes money aggregates away; the server sends no
  // spend figure to such an account, so there is nothing to show or filter on.
  const hideTotals = useHasRestriction(NO_TOTALS_PERMISSION);

  // Filters and sort live in the URL, so a narrowed view can be shared.
  const [searchParams, setSearchParams] = useSearchParams();
  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);
  const sortRaw = searchParams.get('sort') ?? '';
  const sortKey: SortKey | '' = (SORT_KEYS as string[]).includes(sortRaw) ? (sortRaw as SortKey) : '';
  const sortDir: SortDir = searchParams.get('dir') === 'asc' ? 'asc' : searchParams.get('dir') === 'desc' ? 'desc' : sortKey ? defaultSortDir(sortKey) : 'desc';

  const setParams = (changes: Record<string, string>) => {
    const p = new URLSearchParams(searchParams);
    for (const [k, v] of Object.entries(changes)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    setSearchParams(p, { replace: true });
  };
  const setFilter = (key: keyof CustomerFilters, value: string) => setParams({ [FILTER_PARAM[key]]: value });

  // The search box types freely and reaches the URL once typing settles.
  const [searchText, setSearchText] = useState(filters.q);
  const debouncedSearch = useDebouncedValue(searchText, 300);
  useEffect(() => {
    if (debouncedSearch !== filters.q) setFilter('q', debouncedSearch);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearch]);

  // The less-used filters sit behind "More filters". A link that carries one
  // opens the panel, so a filter is never applied out of sight.
  const [showMore, setShowMore] = useState(() => moreFilterCount(filters) > 0);
  const hiddenCount = moreFilterCount(filters);

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(DEFAULT_TABLE_PAGE_SIZE);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Customer | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Customer | null>(null);
  const [vouchersFor, setVouchersFor] = useState<Customer | null>(null);

  const { data: customers, isLoading } = useQuery<Customer[]>({
    queryKey: ['customers'],
    queryFn: adminService.getCustomers,
  });
  const all = useMemo(() => (customers ?? []) as Customer[], [customers]);

  const deleteMutation = useMutation({
    mutationFn: (id: number) => adminService.deleteCustomer(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setDeleteTarget(null);
      toast.success('Customer removed');
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.message || 'Failed to delete customer');
    },
  });

  const brandOptions = useMemo(() => optionsFrom(all, (c) => c.brands), [all]);
  const branchOptions = useMemo(() => optionsFrom(all, (c) => c.branches), [all]);

  /** How many customers came from each channel (before any filter). */
  const sourceCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const c of all) {
      const key = c.source ?? 'pos';
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [all]);

  const filtered = useMemo(
    () => sortCustomers(filterCustomers(all, filters), sortKey, sortDir),
    [all, filters, sortKey, sortDir],
  );
  const chipCounts = useMemo(() => segmentCounts(all, filters), [all, filters]);

  const customerNameTypeahead = useTypeaheadSuggestions({
    query: debouncedSearch,
    options: all
      .map((c) => ({ id: String(c.id), label: (c.name ?? '').trim() }))
      .filter((o) => o.label !== ''),
    minChars: 2,
    limit: 8,
  });

  const pageRows = useMemo(() => {
    const start = (page - 1) * pageSize;
    return filtered.slice(start, start + pageSize);
  }, [filtered, page, pageSize]);
  const filterKey = searchParams.toString();
  useEffect(() => setPage(1), [filterKey, pageSize]);

  const activeCount = activeFilterCount(filters) + (sortKey ? 1 : 0);
  const clearAll = () => {
    setSearchText('');
    setSearchParams({}, { replace: true });
  };

  /** Header click: first click sorts the natural way, second flips, third clears. */
  const toggleSort = (key: SortKey) => {
    if (sortKey !== key) return setParams({ sort: key, dir: defaultSortDir(key) });
    if (sortDir === defaultSortDir(key)) return setParams({ sort: key, dir: sortDir === 'asc' ? 'desc' : 'asc' });
    return setParams({ sort: '', dir: '' });
  };

  // A plain render helper, not a component: defining a component in here would
  // give it a new identity each render and remount the header (losing focus).
  const sortHeader = (k: SortKey, text: string, align: 'left' | 'right' = 'left') => {
    const active = sortKey === k;
    return (
      <th
        key={k}
        scope="col"
        aria-sort={active ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none'}
        className={`${cu.th} ${align === 'right' ? 'text-right' : ''}`}
      >
        <button
          type="button"
          onClick={() => toggleSort(k)}
          title="Sort by this column"
          className={`inline-flex items-center gap-1.5 uppercase tracking-[.06em] hover:text-[#5A6473] dark:hover:text-slate-200 ${active ? 'text-[#20242C] dark:text-slate-100' : ''}`}
        >
          {text}
          <SortIcon state={active ? sortDir : 'none'} />
        </button>
      </th>
    );
  };

  const profilePath = (c: Customer) => `/admin/customers/${c.id}`;

  const actionsFor = (c: Customer): RowAction[] => [
    ...(canViewOrders ? [{ label: 'Orders', onSelect: () => navigate(customerOrdersPath(c)) }] : []),
    { label: 'Vouchers', onSelect: () => setVouchersFor(c) },
    ...(canEdit ? [{ label: 'Edit', onSelect: () => { setEditing(c); setShowForm(true); } }] : []),
    ...(canDelete ? [{ label: 'Delete', danger: true, onSelect: () => setDeleteTarget(c) }] : []),
  ];

  if (isLoading) {
    return <Loader fullScreen text="Loading customers..." />;
  }

  return (
    <div className={cu.page}>
      {/* Heading */}
      <div className="mb-5 flex flex-wrap items-end justify-between gap-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-x-[11px]">
            <h1 className="text-[27px] font-extrabold tracking-[-.02em] text-[#1F2430] dark:text-slate-100">Customers</h1>
            <span className={`text-[13.5px] ${cu.muted}`} data-testid="customer-count">
              {filtered.length === all.length
                ? `${all.length.toLocaleString('en-US')} ${all.length === 1 ? 'customer' : 'customers'}`
                : `${filtered.length.toLocaleString('en-US')} of ${all.length.toLocaleString('en-US')} customers`}
            </span>
          </div>
          <p className={`mt-1.5 text-[13px] ${cu.muted}`}>
            Completed and cancelled orders are counted separately; spend is completed orders only. Click a customer to see their full profile.
          </p>
        </div>
        {canCreate && (
          <button
            type="button"
            onClick={() => { setEditing(null); setShowForm(true); }}
            className={`${cu.btnPrimary} flex-none shadow-[0_4px_12px_rgba(220,42,42,.24)]`}
          >
            + Add customer
          </button>
        )}
      </div>

      {/* Filters */}
      <div className={`${cu.card} rounded-[14px] px-3.5 py-3`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative flex min-w-[240px] flex-1 items-center gap-[9px] rounded-[10px] border-[1.5px] border-[#EEEFF2] bg-[#F6F7F9] px-3 focus-within:border-[#DC2A2A] dark:border-slate-600 dark:bg-slate-700/60">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="flex-none text-[#9AA1AD]" aria-hidden="true">
              <circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="14" y2="14" />
            </svg>
            <input
              type="text"
              aria-label="Search"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              onFocus={() => customerNameTypeahead.setOpen(true)}
              onKeyDown={(e) => {
                const suggestions = customerNameTypeahead.suggestions;
                if (!suggestions.length) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  customerNameTypeahead.setActiveIndex(Math.min(customerNameTypeahead.activeIndex + 1, suggestions.length - 1));
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  customerNameTypeahead.setActiveIndex(Math.max(customerNameTypeahead.activeIndex - 1, 0));
                } else if (e.key === 'Enter') {
                  e.preventDefault();
                  const opt = suggestions[customerNameTypeahead.activeIndex];
                  if (opt?.label) setSearchText(opt.label);
                  customerNameTypeahead.setOpen(false);
                } else if (e.key === 'Escape') {
                  customerNameTypeahead.setOpen(false);
                }
              }}
              placeholder="Search name, phone or email…"
              className="min-w-0 flex-1 border-none bg-transparent py-2.5 text-[13.5px] text-[#1F2430] outline-none placeholder:text-[#A9AFB9] dark:text-slate-100 dark:placeholder:text-slate-500"
            />
            <TypeaheadDropdown
              open={customerNameTypeahead.open && searchText.trim().length >= 2}
              suggestions={customerNameTypeahead.suggestions}
              activeIndex={customerNameTypeahead.activeIndex}
              onHoverIndex={customerNameTypeahead.setActiveIndex}
              onSelect={(opt) => {
                setSearchText(opt.label);
                customerNameTypeahead.setOpen(false);
              }}
              onClose={() => customerNameTypeahead.setOpen(false)}
            />
          </div>

          {/* Where they registered — every channel, each with its head count. */}
          <div role="group" aria-label="Source" className="flex flex-wrap gap-0.5 rounded-[10px] bg-[#F3F4F6] p-[3px] dark:bg-slate-700">
            {[{ value: '', label: 'All', count: all.length }, ...CUSTOMER_SOURCES.map((s) => ({ value: s as string, label: CUSTOMER_SOURCE_LABEL[s], count: sourceCounts[s] ?? 0 }))].map((s) => {
              const on = filters.source === s.value;
              return (
                <button
                  key={s.value || 'all'}
                  type="button"
                  aria-pressed={on}
                  aria-label={`${s.label} (${s.count})`}
                  onClick={() => setFilter('source', s.value)}
                  className={`whitespace-nowrap rounded-[8px] px-[13px] py-[7px] text-[12.5px] font-bold ${
                    on
                      ? 'bg-white text-[#20242C] shadow-[0_1px_3px_rgba(15,23,42,.12)] dark:bg-slate-900 dark:text-slate-100'
                      : 'text-[#8A92A0] hover:text-[#5A6473] dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  {s.label}
                  <span className="ml-1.5 font-semibold tabular-nums opacity-70">{s.count}</span>
                </button>
              );
            })}
          </div>

          <select aria-label="Brand" value={filters.brand} onChange={(e) => setFilter('brand', e.target.value)} className={`${cu.input} !w-auto cursor-pointer`}>
            <option value="">All brands</option>
            {brandOptions.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>
          <select aria-label="Branch" value={filters.branch} onChange={(e) => setFilter('branch', e.target.value)} className={`${cu.input} !w-auto cursor-pointer`}>
            <option value="">All branches</option>
            {branchOptions.map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
          </select>

          <button
            type="button"
            aria-expanded={showMore}
            aria-controls="customer-more-filters"
            onClick={() => setShowMore((v) => !v)}
            className={`inline-flex items-center gap-2 whitespace-nowrap rounded-[10px] border-[1.5px] px-3.5 py-2.5 text-[13px] font-bold ${
              showMore || hiddenCount > 0
                ? 'border-[#DC2A2A] bg-[#FCEEEE] text-[#B5121B] dark:border-red-500 dark:bg-red-900/30 dark:text-red-300'
                : 'border-[#E2E5EA] bg-white text-[#374151] hover:bg-[#F3F4F6] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700'
            }`}
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" aria-hidden="true">
              <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
            </svg>
            More filters
            {hiddenCount > 0 && (
              <span data-testid="more-filters-count" className="rounded-full bg-[#DC2A2A] px-[7px] py-px text-[11px] font-extrabold text-white">
                {hiddenCount}
              </span>
            )}
          </button>

          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearAll}
              className="whitespace-nowrap rounded-[10px] px-3 py-2.5 text-[13px] font-bold text-[#B5121B] hover:bg-[#FCEEEE] dark:text-red-300 dark:hover:bg-red-900/30"
            >
              Clear ({activeCount})
            </button>
          )}
        </div>

        {showMore && (
          <div
            id="customer-more-filters"
            className="mt-[13px] grid grid-cols-2 gap-x-3.5 gap-y-3 border-t border-[#F1F2F5] pt-3.5 md:grid-cols-4 dark:border-slate-700"
          >
            <div>
              <label htmlFor="cust-points" className={cu.fieldLabel}>Points</label>
              <select id="cust-points" value={filters.points} onChange={(e) => setFilter('points', e.target.value)} className={`${cu.input} cursor-pointer`}>
                {POINTS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cust-min-points" className={cu.fieldLabel}>Min points</label>
              <input id="cust-min-points" type="number" min={0} inputMode="numeric" value={filters.minPoints} onChange={(e) => setFilter('minPoints', e.target.value)} placeholder="e.g. 1000" className={cu.input} />
            </div>
            <div>
              <label htmlFor="cust-last-order" className={cu.fieldLabel}>Last order</label>
              <select id="cust-last-order" value={filters.lastOrder} onChange={(e) => setFilter('lastOrder', e.target.value)} className={`${cu.input} cursor-pointer`}>
                {LAST_ORDER_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cust-orders" className={cu.fieldLabel}>Completed orders</label>
              <select id="cust-orders" value={filters.orders} onChange={(e) => setFilter('orders', e.target.value)} className={`${cu.input} cursor-pointer`}>
                {ORDERS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <label htmlFor="cust-min-orders" className={cu.fieldLabel}>Min orders</label>
              <input id="cust-min-orders" type="number" min={0} inputMode="numeric" value={filters.minOrders} onChange={(e) => setFilter('minOrders', e.target.value)} placeholder="e.g. 5" className={cu.input} />
            </div>
            {!hideTotals && (
              <div>
                <label htmlFor="cust-min-spend" className={cu.fieldLabel}>Min spend (Rs.)</label>
                <input id="cust-min-spend" type="number" min={0} inputMode="numeric" value={filters.minSpend} onChange={(e) => setFilter('minSpend', e.target.value)} placeholder="e.g. 10000" className={cu.input} />
              </div>
            )}
            <div>
              <label htmlFor="cust-reg-from" className={cu.fieldLabel}>Registered from</label>
              <input id="cust-reg-from" type="date" value={filters.regFrom} max={filters.regTo || undefined} onChange={(e) => setFilter('regFrom', e.target.value)} className={cu.input} />
            </div>
            <div>
              <label htmlFor="cust-reg-to" className={cu.fieldLabel}>Registered to</label>
              <input id="cust-reg-to" type="date" value={filters.regTo} min={filters.regFrom || undefined} onChange={(e) => setFilter('regTo', e.target.value)} className={cu.input} />
            </div>
          </div>
        )}
      </div>

      {/* Quick picks — each with how many customers it would show. */}
      <div className="mb-3 mt-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <div role="group" aria-label="Quick filters" className="flex flex-wrap items-center gap-2">
          {SEGMENTS.map((g) => {
            const on = filters.segment === g.key;
            return (
              <button
                key={g.key || 'all'}
                type="button"
                aria-pressed={on}
                aria-label={`${g.label} (${chipCounts[g.key]})`}
                onClick={() => setFilter('segment', g.key)}
                className={`inline-flex items-center gap-2 whitespace-nowrap rounded-full border-[1.5px] px-3.5 py-2 text-[12.5px] font-bold ${
                  on
                    ? 'border-[#1F2430] bg-[#1F2430] text-white dark:border-slate-100 dark:bg-slate-100 dark:text-slate-900'
                    : 'border-[#E2E5EA] bg-white text-[#5A6473] hover:border-[#C7CCD6] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:border-slate-500'
                }`}
              >
                {g.label}
                <span
                  className={`rounded-full px-[7px] py-px text-[11px] font-extrabold tabular-nums ${
                    on ? 'bg-white/[.18] text-white dark:bg-slate-900/20 dark:text-slate-900' : 'bg-[#F1F2F5] text-[#8A92A0] dark:bg-slate-700 dark:text-slate-400'
                  }`}
                >
                  {chipCounts[g.key]}
                </span>
              </button>
            );
          })}
        </div>
        {/* Says, right above the table, what the dotted underline in it is for. */}
        <p className={`text-[12.5px] ${cu.muted}`} data-testid="hover-hint">
          <span className={`font-semibold ${cu.soft} ${HOVER_CUE}`}>Dotted underline</span>
          {' '}= hover to see every brand, branch or point balance
        </p>
      </div>

      {all.length === 0 ? (
        <div className={`${cu.card} rounded-[16px] p-12 text-center text-[14px] ${cu.muted}`}>No customers yet. Add one to use in POS.</div>
      ) : filtered.length === 0 ? (
        <div className={`${cu.card} rounded-[16px] p-12 text-center text-[14px] ${cu.muted}`}>No customers match these filters.</div>
      ) : (
        <>
          <div className="overflow-x-auto rounded-[16px] border border-[#ECEDF0] bg-white shadow-[0_10px_30px_rgba(15,23,42,.05)] dark:border-slate-700 dark:bg-slate-800">
            <table className="min-w-full border-collapse">
              <thead>
                <tr className={cu.headRow}>
                  {sortHeader('name', 'Customer')}
                  <th scope="col" className={cu.th}>Phone</th>
                  <th scope="col" className={cu.th}>Source</th>
                  {sortHeader('points', 'Points')}
                  {sortHeader('completed', 'Completed', 'right')}
                  {sortHeader('cancelled', 'Cancelled', 'right')}
                  {!hideTotals && sortHeader('spent', 'Spent', 'right')}
                  {sortHeader('last_order', 'Last order')}
                  {/* Last, so on a narrow screen these are what scrolls away,
                      not the figures. */}
                  <th scope="col" className={cu.th}>Brands</th>
                  <th scope="col" className={cu.th}>Branches</th>
                  <th scope="col" className={`${cu.th} ${stickyCls} bg-[#FBFBFC] text-right dark:bg-slate-900`}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((c) => {
                  const stats = c.orderStats;
                  const completed = stats?.completed_count ?? 0;
                  const cancelled = stats?.cancelled_count ?? 0;
                  const label = c.name?.trim() || c.phone;
                  const status = customerStatus(stats?.last_order_at);
                  return (
                    <tr
                      key={c.id}
                      data-testid={`customer-row-${c.id}`}
                      onClick={() => navigate(profilePath(c))}
                      className={`group cursor-pointer hover:bg-[#FCFCFD] dark:hover:bg-slate-700/40 ${cu.row}`}
                    >
                      <td className={cu.td}>
                        <div className="flex min-w-0 items-center gap-[11px]">
                          <span aria-hidden="true" className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-full bg-[#F1F2F5] text-[13px] font-extrabold text-[#5A6473] dark:bg-slate-700 dark:text-slate-300">
                            {nameInitials(c.name, 1)}
                          </span>
                          {/* A real link, so the profile is reachable by keyboard
                              and opens in a new tab like any other. */}
                          <Link
                            to={profilePath(c)}
                            onClick={(e) => e.stopPropagation()}
                            title={c.name ?? undefined}
                            className={`max-w-[13rem] truncate text-[14px] font-bold hover:text-[#B5121B] dark:hover:text-red-300 ${c.name?.trim() ? cu.strong : cu.muted}`}
                          >
                            {c.name?.trim() || 'No name'}
                          </Link>
                        </div>
                      </td>
                      <td className={`${cu.td} whitespace-nowrap text-[13px] tabular-nums ${cu.soft}`}>{c.phone}</td>
                      <td className={cu.td}>
                        <span
                          className={`inline-block whitespace-nowrap rounded-[7px] px-[9px] py-1 text-[11px] font-bold ${
                            CUSTOMER_SOURCE_BADGE[String(c.source ?? 'pos')] ?? CUSTOMER_SOURCE_BADGE.pos
                          }`}
                        >
                          {customerSourceLabel(c.source ?? 'pos')}
                        </span>
                      </td>
                      <td className={cu.td} onClick={(e) => e.stopPropagation()}>
                        <LoyaltyPointsCell wallets={c.loyaltyWallets} />
                      </td>
                      <td className={`${cu.td} text-right text-[14px] font-bold tabular-nums ${completed > 0 ? cu.strong : cu.faint}`}>{completed}</td>
                      <td className={`${cu.td} text-right text-[14px] tabular-nums ${cancelled > 0 ? `font-bold ${cu.danger}` : cu.faint}`}>{cancelled}</td>
                      {!hideTotals && (
                        <td className={`${cu.td} whitespace-nowrap text-right text-[13.5px] font-bold tabular-nums ${stats?.spent != null && completed > 0 ? cu.strong : cu.faint}`}>
                          {stats?.spent != null && completed > 0 ? formatRs(stats.spent) : '—'}
                        </td>
                      )}
                      <td className={cu.td}>
                        <div className={`whitespace-nowrap text-[13px] font-semibold ${stats?.last_order_at ? cu.text : STATUS_TEXT.never}`}>
                          {stats?.last_order_at ? formatDay(stats.last_order_at) : 'Never'}
                        </div>
                        {stats?.last_order_at && (
                          <div className={`mt-0.5 whitespace-nowrap text-[11.5px] font-bold ${STATUS_TEXT[status.key]}`}>
                            {daysAgoLabel(stats.last_order_at)}
                          </div>
                        )}
                      </td>
                      {/* Hovering "+N more" must not open the profile on a tap. */}
                      <td className={`${cu.td} max-w-[14rem]`} onClick={(e) => e.stopPropagation()}>
                        <NameList items={c.brands} noun="brand" />
                      </td>
                      <td className={`${cu.td} max-w-[13rem]`} onClick={(e) => e.stopPropagation()}>
                        <NameList items={c.branches} noun="branch" />
                      </td>
                      {/* Using a row's menu must not also open its profile. */}
                      <td
                        className={`${cu.td} ${stickyCls} bg-white text-right group-hover:bg-[#FCFCFD] dark:bg-slate-800 dark:group-hover:bg-slate-700`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <RowActionsMenu actions={actionsFor(c)} ariaLabel={`Actions for ${label}`} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <PaginationBar
            totalCount={filtered.length}
            page={page}
            pageSize={pageSize}
            onPageChange={setPage}
            itemLabel="customers"
            pageSizeOptions={PAGE_SIZE_OPTIONS}
            onPageSizeChange={setPageSize}
          />
        </>
      )}

      <CustomerVouchersModal customer={vouchersFor} onClose={() => setVouchersFor(null)} />

      <CustomerFormModal
        isOpen={showForm}
        customer={editing}
        onClose={() => { setShowForm(false); setEditing(null); }}
      />

      <Modal isOpen={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete customer">
        {deleteTarget && (
          <div className="space-y-4">
            <p className="text-gray-700 dark:text-slate-200">
              Remove <strong>{deleteTarget.name ?? '—'}</strong> ({deleteTarget.phone})? This cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setDeleteTarget(null)}>Cancel</Button>
              <Button variant="danger" onClick={() => deleteMutation.mutate(deleteTarget.id)} isLoading={deleteMutation.isPending}>
                Delete
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Customers;
