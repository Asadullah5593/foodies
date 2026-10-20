import React, { useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api';
import SearchableSelect from '../../components/SearchableSelect';
import FetchingOverlay from '../../components/FetchingOverlay';
import { Branch, RepeatedCustomerRow, RepeatedCustomersReport } from '../../types';
import { useResultsRefreshing } from '../../components/useResultsRefreshing';
import { useHasPermission } from '../../hooks/useHasPermission';
import { useSensitivePageView } from '../../hooks/useSensitivePageView';
import { recordBeacon } from '../../utils/activityBeacon';
import { customerOrdersPath } from '../../utils/customerOrdersPath';
import { nameInitials } from '../../utils/customerDisplay';
import { isEntityInactive } from '../../utils/entityStatus';
import { prettyDay } from '../../utils/voucherText';
import { addDays, defaultRange, toIso } from './dashboard/dateRanges';

const PAGE_SIZE = 25;

type SortKey = 'days' | 'spend' | 'name';

/** The Orders page's statuses, in the same order; '' = every status (the default). */
const STATUS_OPTIONS = [
  { value: '', label: 'All statuses' },
  { value: 'placed', label: 'Placed' },
  { value: 'accepted', label: 'Accepted' },
  { value: 'preparing', label: 'Preparing' },
  { value: 'ready', label: 'Ready' },
  { value: 'completed', label: 'Completed' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Quick ranges ending today; "Custom" is lit whenever the dates match none of them. */
const PRESET_DAYS = [
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
];

/** "How often they come back": how many customers fall in each band of days. */
const DAY_BANDS: Array<{ label: string; spoken: string; test: (days: number) => boolean }> = [
  { label: '2 days', spoken: '2 days', test: (d) => d === 2 },
  { label: '3 days', spoken: '3 days', test: (d) => d === 3 },
  { label: '4–5', spoken: '4 to 5 days', test: (d) => d >= 4 && d <= 5 },
  { label: '6+', spoken: '6 or more days', test: (d) => d >= 6 },
];

/** One square per day ordered, up to this many; the number beside them is always exact. */
const MAX_DAY_DOTS = 10;

/** Avatar colours, picked by customer id so a customer keeps theirs across sorts. */
const AVATAR_TONES = [
  'bg-[#FCEEEE] text-[#DC2A2A] dark:bg-red-500/15 dark:text-red-300',
  'bg-[#EAF1FF] text-[#2563EB] dark:bg-blue-500/15 dark:text-blue-300',
  'bg-[#F1EAFB] text-[#7C3AED] dark:bg-violet-500/15 dark:text-violet-300',
  'bg-[#FFF3E0] text-[#B45309] dark:bg-amber-500/15 dark:text-amber-300',
  'bg-[#EAF7EE] text-[#16A34A] dark:bg-emerald-500/15 dark:text-emerald-300',
];

const money = (n: number): string =>
  `Rs. ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the row is called on screen, in the CSV and on paper. */
const customerName = (r: RepeatedCustomerRow): string => r.name ?? r.phone ?? `Customer #${r.customer_id}`;

const avgPerDay = (r: RepeatedCustomerRow): number => (r.days > 0 ? r.spend / r.days : 0);

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const selectTrigger =
  'flex w-full items-center justify-between gap-2 rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-[11px] py-[9px] text-left text-[13px] text-[#1F2430] outline-none transition hover:border-[#D3D7DE] focus:border-[#DC2A2A] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100';
const card = 'border border-[#ECEDF0] bg-white dark:border-slate-700 dark:bg-slate-800';
const headLabel = 'text-[10.5px] font-bold uppercase tracking-[.06em] text-[#9AA1AD] dark:text-slate-400';
/** Phones: rank · customer · chevron, figures on a second line. md+: the design's six columns. */
const rowGrid =
  'grid grid-cols-[24px_minmax(0,1fr)_16px] items-center gap-x-3 gap-y-2 px-4 py-3 md:grid-cols-[36px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_110px_24px] md:gap-x-[14px] md:px-5 md:py-[14px]';

/**
 * Print stylesheet, mounted only while a print is in flight, so it cannot
 * affect how any other screen prints (receipts in particular). The sheet is
 * portalled to <body> as #rc-print-root and everything else is hidden.
 */
const PRINT_CSS = `
#rc-print-root { display: none; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body > *:not(#rc-print-root) { display: none !important; }
  #rc-print-root { display: block !important; font: 9.5pt/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; }
  #rc-print-root h1 { font-size: 16pt; font-weight: 800; margin: 0 0 1mm; }
  #rc-print-root .rc-sub { font-size: 9pt; color: #444; margin: 0 0 4mm; padding-bottom: 3mm; border-bottom: 1.5pt solid #111; }
  #rc-print-root table { width: 100%; border-collapse: collapse; }
  #rc-print-root thead { display: table-header-group; }
  #rc-print-root tr { break-inside: avoid; page-break-inside: avoid; }
  #rc-print-root th { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; text-align: left; padding: 1.6mm 2mm; border-bottom: 1pt solid #111; background: #F2F3F5; }
  #rc-print-root td { font-size: 9pt; padding: 1.4mm 2mm; border-bottom: 0.5pt solid #DDE0E5; }
  #rc-print-root .rc-r { text-align: right; font-variant-numeric: tabular-nums; }
  #rc-print-root tfoot td { font-weight: 800; border-top: 1pt solid #111; border-bottom: none; }
  #rc-print-root .rc-foot { margin-top: 4mm; font-size: 7.5pt; color: #666; }
}
`;

/**
 * Reports → Repeated Customers.
 *
 * Customers who ordered on two or more DIFFERENT days in the range. Several
 * orders on one day are one visit, so the number is days, not orders.
 * Every order status counts unless the Order status filter picks one; spend
 * never includes cancelled orders. Each row opens the Orders page on that
 * customer, narrowed to the same range, branch, brand and status, so the list
 * there shows the days counted here.
 *
 * The tiles describe the whole report; the search box only narrows the list
 * (and the CSV, print and footer total, which follow the list).
 *
 * The filters live in the URL: going back from a customer's orders lands on
 * the same report, not a reset one.
 */
const RepeatedCustomers: React.FC = () => {
  useSensitivePageView('repeated-customers');
  const canOpenOrders = useHasPermission('orders:view');
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = useMemo(() => defaultRange(), []);
  const fromInput = useRef<HTMLInputElement>(null);

  const fromParam = searchParams.get('date_from') ?? '';
  const toParam = searchParams.get('date_to') ?? '';
  const dateFrom = YMD.test(fromParam) ? fromParam : fallback.from;
  const dateTo = YMD.test(toParam) ? toParam : fallback.to;
  const branchId = /^\d+$/.test(searchParams.get('branch_id') ?? '') ? Number(searchParams.get('branch_id')) : null;
  const brandId = /^\d+$/.test(searchParams.get('brand_id') ?? '') ? Number(searchParams.get('brand_id')) : null;
  const search = searchParams.get('q') ?? '';
  const statusParam = searchParams.get('status') ?? '';
  const status = STATUS_OPTIONS.some((o) => o.value === statusParam) ? statusParam : '';

  const [sortKey, setSortKey] = useState<SortKey>('days');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [printing, setPrinting] = useState(false);

  /** Replace, not push: typing in the search box must not fill the back button. */
  const setParams = (updates: Record<string, string | null>) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(updates)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    setSearchParams(next, { replace: true });
  };
  const setParam = (key: string, value: string | null) => setParams({ [key]: value });

  // The sheet is only in the DOM while a print is in flight.
  useEffect(() => {
    if (!printing) return;
    const done = () => setPrinting(false);
    window.addEventListener('afterprint', done);
    const timer = window.setTimeout(() => window.print(), 0);
    return () => {
      window.removeEventListener('afterprint', done);
      window.clearTimeout(timer);
    };
  }, [printing]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await apiClient.get<Branch[]>('/admin/branches')).data,
  });
  // Brand-locked users get only their own brands back.
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => (await apiClient.get<Array<{ id: number; name: string }>>('/admin/brands')).data,
  });

  const reportKey = ['repeated-customers-report', dateFrom, dateTo, branchId, brandId, status];
  const { data, isLoading, isError, isFetching } = useQuery<RepeatedCustomersReport>({
    queryKey: reportKey,
    queryFn: () =>
      adminService.getRepeatedCustomers({
        date_from: dateFrom,
        date_to: dateTo,
        branch_id: branchId,
        brand_id: brandId,
        status: status || null,
      }),
    placeholderData: keepPreviousData,
  });
  const refreshing = useResultsRefreshing(reportKey, isFetching);

  // A new selection starts on its first page.
  useEffect(() => setPage(1), [dateFrom, dateTo, branchId, brandId, status, search, sortKey, sortDir]);

  const allRows = useMemo(() => data?.rows ?? [], [data]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    // Phones are stored as 03XXXXXXXXX; let "0300 123-4567" find them too.
    const digits = term.replace(/[\s-]/g, '');
    const matched = term
      ? allRows.filter(
          (r) =>
            (r.name ?? '').toLowerCase().includes(term) ||
            (digits.length > 0 && (r.phone ?? '').includes(digits)),
        )
      : allRows;
    // The server already sends most days first; only another order needs work.
    if (sortKey === 'days' && sortDir === 'desc') return matched;
    const sign = sortDir === 'asc' ? 1 : -1;
    return [...matched].sort((a, b) => {
      const diff =
        sortKey === 'name'
          ? customerName(a).localeCompare(customerName(b), undefined, { sensitivity: 'base' })
          : a[sortKey] - b[sortKey];
      return diff !== 0 ? sign * diff : a.customer_id - b.customer_id;
    });
  }, [allRows, search, sortKey, sortDir]);

  const round2 = (n: number) => Math.round(n * 100) / 100;
  // Tiles: the whole report. Footer total, CSV and print: the list as filtered.
  const reportCount = allRows.length;
  const reportSpend = round2(allRows.reduce((sum, r) => sum + r.spend, 0));
  const reportDays = allRows.reduce((sum, r) => sum + r.days, 0);
  const listedSpend = round2(rows.reduce((sum, r) => sum + r.spend, 0));
  const maxSpend = Math.max(0, ...allRows.map((r) => r.spend));
  const bands = DAY_BANDS.map((b) => ({ ...b, n: allRows.filter((r) => b.test(r.days)).length }));
  const bandMax = Math.max(1, ...bands.map((b) => b.n));

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  const rangeText = dateFrom === dateTo ? prettyDay(dateFrom) : `${prettyDay(dateFrom)} – ${prettyDay(dateTo)}`;
  const scopeText = [
    branchId != null ? ((branches ?? []).find((b) => b.id === branchId)?.name ?? 'One branch') : 'All branches',
    brandId != null ? ((brands ?? []).find((b) => b.id === brandId)?.name ?? 'One brand') : 'All brands',
    STATUS_OPTIONS.find((o) => o.value === status)?.label ?? 'All statuses',
  ].join(' · ');

  const today = toIso(new Date());
  const presets = PRESET_DAYS.map((p) => ({ ...p, from: toIso(addDays(new Date(), -(p.days - 1))), to: today }));
  const activePreset = presets.find((p) => p.from === dateFrom && p.to === dateTo)?.label ?? 'Custom';

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };
  /** The design's "Sort by" buttons: the biggest first. */
  const sortBy = (key: 'days' | 'spend') => {
    setSortKey(key);
    setSortDir('desc');
  };
  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 'desc' ? ' ▾' : ' ▴') : '');

  // Same range and status as the report, so the list there shows the days
  // counted here (the Orders page drops its date chip for the whole history).
  const ordersLink = (r: RepeatedCustomerRow): string => {
    const path = customerOrdersPath(
      { id: r.customer_id, name: r.name, phone: r.phone ?? '' },
      { brandId, branchId, status: status || undefined },
    );
    return `${path}&${new URLSearchParams({ date_from: dateFrom, date_to: dateTo }).toString()}`;
  };

  const exportCsv = () => {
    const cell = (v: string | number | null) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ['Customer', 'Phone', 'Days ordered', 'Spend', 'Avg per day'].join(','),
      ...rows.map((r) =>
        [customerName(r), r.phone, r.days, r.spend.toFixed(2), avgPerDay(r).toFixed(2)].map(cell).join(','),
      ),
    ];
    // A download never reaches the server, so this is the only place it can
    // be recorded — and this file is a list of customer phone numbers.
    recordBeacon({ action: 'client.export', subject: 'repeated-customers' });
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `repeated-customers_${dateFrom}_to_${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    recordBeacon({ action: 'client.print', subject: 'repeated-customers' });
    setPrinting(true);
  };

  const headSort = (key: SortKey, label: string, className = '') => (
    <button
      type="button"
      onClick={() => toggleSort(key)}
      className={`${headLabel} hover:text-[#5A6473] dark:hover:text-slate-200 ${className}`}
    >
      {label}
      {sortArrow(key)}
    </button>
  );

  /** One customer: a link to their orders when the viewer can open Orders. */
  const rowBody = (r: RepeatedCustomerRow, rank: number) => (
    <>
      <span
        className={`text-[13px] font-extrabold tabular-nums ${
          rank <= 3 ? 'text-[#DC2A2A] dark:text-red-400' : 'text-[#B6BCC6] dark:text-slate-500'
        }`}
      >
        {rank}
      </span>
      <div className="flex min-w-0 items-center gap-[11px]">
        <span
          aria-hidden="true"
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-full text-xs font-extrabold ${
            AVATAR_TONES[r.customer_id % AVATAR_TONES.length]
          }`}
        >
          {nameInitials(r.name)}
        </span>
        <div className="min-w-0">
          <div data-testid="rc-name" className="truncate text-sm font-bold text-[#20242C] dark:text-slate-100">
            {customerName(r)}
          </div>
          {r.name && r.phone && (
            <div className="text-xs tabular-nums text-[#9AA1AD] dark:text-slate-400">{r.phone}</div>
          )}
        </div>
      </div>
      {/* Chevron third in the markup (top-right on phones), last in the md+ grid. */}
      <span
        aria-hidden="true"
        className={`justify-self-end text-[#C9CED6] dark:text-slate-500 md:order-last ${canOpenOrders ? '' : 'invisible'}`}
      >
        <svg width="14" height="14" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
          <path d="M4.5 3l3 3-3 3" />
        </svg>
      </span>
      {/* Phones: one line of figures under the name. md+: three grid columns. */}
      <div className="col-span-2 col-start-2 flex flex-wrap items-center gap-x-4 gap-y-1 md:contents">
        <div className="flex items-center gap-2.5">
          <div aria-hidden="true" className="hidden max-w-[150px] flex-wrap gap-[3px] md:flex">
            {Array.from({ length: Math.min(r.days, MAX_DAY_DOTS) }, (_, k) => (
              <span key={k} className="h-3 w-3 rounded-[3px] bg-[#DC2A2A] dark:bg-red-400" />
            ))}
          </div>
          <span className="text-sm font-extrabold tabular-nums text-[#20242C] dark:text-slate-100">
            {r.days}
            <span className="font-semibold text-[#8A92A0] dark:text-slate-400 md:hidden"> days</span>
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          <div aria-hidden="true" className="hidden h-2 max-w-[150px] flex-1 overflow-hidden rounded bg-[#F3F4F6] dark:bg-slate-700 md:block">
            <span
              className="block h-full rounded bg-[#1F2430] dark:bg-slate-300"
              style={{ width: `${maxSpend > 0 ? Math.round((r.spend / maxSpend) * 100) : 0}%` }}
            />
          </div>
          <span className="whitespace-nowrap text-sm font-extrabold tabular-nums text-[#20242C] dark:text-slate-100">
            {money(r.spend)}
          </span>
        </div>
        <span className="whitespace-nowrap text-[13px] tabular-nums text-[#5A6473] dark:text-slate-300 md:text-right">
          {money(avgPerDay(r))}
          <span className="md:hidden">/day</span>
        </span>
      </div>
    </>
  );

  return (
    <div className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-6 text-[#1F2430] dark:text-slate-100 sm:px-6 lg:px-9 lg:pt-8">
      {/* Header */}
      <div className="mb-5 flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="text-xs font-bold text-[#9AA1AD] dark:text-slate-400">Reports</div>
          <h1 className="mt-1 text-[26px] font-extrabold tracking-[-0.02em] text-[#1F2430] dark:text-slate-100">
            Repeated Customers
          </h1>
          <p className="mt-1.5 text-[13.5px] text-[#6B7280] dark:text-slate-400">
            People who ordered on 2+ different days. Same-day orders count once; spend excludes cancelled orders.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={printReport}
            disabled={rows.length === 0}
            className="rounded-[11px] border-[1.5px] border-[#E2E5EA] bg-white px-4 py-2.5 text-[13.5px] font-bold text-[#374151] transition hover:bg-[#F9FAFB] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            Print
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="rounded-[11px] bg-[#DC2A2A] px-4 py-2.5 text-[13.5px] font-bold text-white shadow-[0_4px_12px_rgba(220,42,42,.22)] transition hover:bg-[#C21F1F] disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className={`mb-4 flex flex-wrap items-center gap-2 rounded-[14px] px-3 py-2.5 ${card}`}>
        <div className="flex items-center gap-1.5 rounded-[10px] border-[1.5px] border-[#E2E5EA] px-2.5 dark:border-slate-600">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#9AA1AD" strokeWidth="1.6" aria-hidden="true">
            <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
            <path d="M2.5 6.5h11M5.5 2v3M10.5 2v3" />
          </svg>
          <input
            ref={fromInput}
            type="date"
            aria-label="From date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setParam('date_from', e.target.value || null)}
            className="border-none bg-transparent py-[9px] text-[13px] outline-none dark:text-slate-100"
          />
          <span className="text-[#B6BCC6]" aria-hidden="true">
            →
          </span>
          <input
            type="date"
            aria-label="To date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setParam('date_to', e.target.value || null)}
            className="border-none bg-transparent py-[9px] text-[13px] outline-none dark:text-slate-100"
          />
        </div>
        <div className="flex gap-1">
          {presets.map((p) => (
            <button
              key={p.label}
              type="button"
              aria-pressed={activePreset === p.label}
              onClick={() => setParams({ date_from: p.from, date_to: p.to })}
              className={`rounded-[9px] px-[11px] py-2 text-[12.5px] font-bold ${
                activePreset === p.label
                  ? 'bg-[#FCEEEE] text-[#DC2A2A] dark:bg-red-500/15 dark:text-red-300'
                  : 'text-[#5A6473] hover:bg-[#F3F4F6] dark:text-slate-300 dark:hover:bg-slate-700'
              }`}
            >
              {p.label}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={activePreset === 'Custom'}
            onClick={() => fromInput.current?.focus()}
            className={`rounded-[9px] px-[11px] py-2 text-[12.5px] font-bold ${
              activePreset === 'Custom'
                ? 'bg-[#FCEEEE] text-[#DC2A2A] dark:bg-red-500/15 dark:text-red-300'
                : 'text-[#5A6473] hover:bg-[#F3F4F6] dark:text-slate-300 dark:hover:bg-slate-700'
            }`}
          >
            Custom
          </button>
        </div>
        <span aria-hidden="true" className="mx-1 hidden h-[26px] w-px bg-[#ECEDF0] dark:bg-slate-700 sm:block" />
        <SearchableSelect
          ariaLabel="Branch"
          searchPlaceholder="Search branches…"
          triggerClassName={selectTrigger}
          minWidth="min-w-[140px]"
          className="flex-none"
          value={branchId != null ? String(branchId) : ''}
          onChange={(v) => setParam('branch_id', v || null)}
          options={[
            { value: '', label: 'All branches' },
            ...(branches ?? []).map((b) => ({ value: String(b.id), label: b.name, inactive: isEntityInactive(b) })),
          ]}
        />
        <SearchableSelect
          ariaLabel="Brand"
          searchPlaceholder="Search brands…"
          triggerClassName={selectTrigger}
          minWidth="min-w-[130px]"
          className="flex-none"
          value={brandId != null ? String(brandId) : ''}
          onChange={(v) => setParam('brand_id', v || null)}
          options={[
            { value: '', label: 'All brands' },
            ...(brands ?? []).map((b) => ({ value: String(b.id), label: b.name, inactive: isEntityInactive(b) })),
          ]}
        />
        <SearchableSelect
          ariaLabel="Order status"
          searchPlaceholder="Search statuses…"
          triggerClassName={selectTrigger}
          minWidth="min-w-[140px]"
          className="flex-none"
          value={status}
          onChange={(v) => setParam('status', v || null)}
          options={STATUS_OPTIONS}
        />
        <div className="flex min-w-[180px] flex-1 items-center gap-2 rounded-[10px] border-[1.5px] border-[#E2E5EA] px-[11px] dark:border-slate-600">
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="#9AA1AD" strokeWidth="1.7" strokeLinecap="round" aria-hidden="true">
            <circle cx="7" cy="7" r="4.5" />
            <path d="M10.5 10.5L14 14" />
          </svg>
          <input
            type="search"
            aria-label="Search customers"
            value={search}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Name or phone"
            className="flex-1 border-none bg-transparent py-[9px] text-[13px] outline-none placeholder:text-[#A9AFB9] dark:text-slate-100"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading…</div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-red-600">Failed to load the repeated customers report.</p>
      ) : (
        <FetchingOverlay active={refreshing} label="Updating report…">
          {/* Summary */}
          <div className="mb-4 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-3">
            {(
              [
                ['Repeated customers', reportCount.toLocaleString('en-US'), 'ordered on 2+ days'],
                ['Their spend', money(reportSpend), 'cancelled orders excluded'],
                [
                  'Avg spend per customer',
                  money(reportCount ? reportSpend / reportCount : 0),
                  `${(reportCount ? reportDays / reportCount : 0).toFixed(1)} days each on average`,
                ],
              ] as Array<[string, string, string]>
            ).map(([label, value, sub]) => (
              <div key={label} className={`rounded-[14px] px-[18px] py-4 ${card}`}>
                <div className="text-xs font-semibold text-[#8A92A0] dark:text-slate-400">{label}</div>
                <div className="mt-1.5 whitespace-nowrap text-[26px] font-extrabold tracking-[-0.02em] tabular-nums text-[#1F2430] dark:text-slate-100">
                  {value}
                </div>
                <div className="mt-[3px] text-xs text-[#9AA1AD] dark:text-slate-400">{sub}</div>
              </div>
            ))}
            <div className={`rounded-[14px] px-[18px] py-4 ${card}`}>
              <div className="text-xs font-semibold text-[#8A92A0] dark:text-slate-400">How often they come back</div>
              <div
                role="img"
                aria-label={`Customers by days ordered: ${bands.map((b) => `${b.spoken}: ${b.n}`).join(', ')}`}
              >
                <div className="mt-2.5 flex h-[62px] items-end gap-2.5">
                  {bands.map((b, i) => (
                    <div key={b.label} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                      <span className="text-[11px] font-extrabold text-[#374151] dark:text-slate-200">{b.n}</span>
                      <span
                        className={`w-full rounded-t-[5px] rounded-b-[2px] ${
                          i === 0 ? 'bg-[#F2B8B8] dark:bg-red-300/40' : 'bg-[#DC2A2A] dark:bg-red-400'
                        }`}
                        style={{ height: `${Math.max(4, Math.round((b.n / bandMax) * 44))}px` }}
                      />
                    </div>
                  ))}
                </div>
                <div className="mt-[5px] flex gap-2.5">
                  {bands.map((b) => (
                    <span key={b.label} className="flex-1 text-center text-[10.5px] text-[#9AA1AD] dark:text-slate-400">
                      {b.label}
                    </span>
                  ))}
                </div>
              </div>
            </div>
          </div>

          {/* Customers */}
          <section className={`overflow-hidden rounded-2xl ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#F1F2F5] px-5 py-3.5 dark:border-slate-700">
              <div className="flex flex-wrap items-baseline gap-x-2.5">
                <h2 className="text-[15px] font-extrabold">Customers</h2>
                <span className="text-[12.5px] text-[#9AA1AD] dark:text-slate-400">
                  {rangeText} · {scopeText} · {rows.length} of {reportCount}
                </span>
              </div>
              <div className="flex items-center gap-1.5 text-[12.5px] text-[#8A92A0] dark:text-slate-400">
                Sort by
                {(
                  [
                    ['days', 'Days ordered'],
                    ['spend', 'Spend'],
                  ] as Array<['days' | 'spend', string]>
                ).map(([key, label]) => {
                  const on = sortKey === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-pressed={on}
                      aria-label={`Sort by ${label.toLowerCase()}`}
                      onClick={() => sortBy(key)}
                      className={`rounded-lg border-[1.5px] px-[11px] py-1.5 text-[12.5px] font-bold ${
                        on
                          ? 'border-[#1F2430] bg-[#1F2430] text-white dark:border-slate-200 dark:bg-slate-200 dark:text-slate-900'
                          : 'border-[#E2E5EA] bg-white text-[#5A6473] hover:bg-[#F9FAFB] dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            {rows.length === 0 ? (
              <div className="px-6 py-9 text-center">
                <p className="text-[13.5px] font-semibold text-[#5A6473] dark:text-slate-300">
                  {search.trim()
                    ? 'No repeated customer matches this search'
                    : 'No customer ordered on more than one day in this range'}
                </p>
                <p className="mt-1 text-[13px] text-[#9AA1AD] dark:text-slate-400">
                  Try a wider date range or clear the filters.
                </p>
              </div>
            ) : (
              <>
                <div className="hidden grid-cols-[36px_minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.1fr)_110px_24px] gap-x-[14px] border-b border-[#F1F2F5] bg-[#FBFBFC] px-5 py-[11px] dark:border-slate-700 dark:bg-slate-900/40 md:grid">
                  <span className={headLabel}>#</span>
                  {headSort('name', 'Customer', 'text-left')}
                  {headSort('days', 'Days ordered', 'text-left')}
                  {headSort('spend', 'Spend', 'text-left')}
                  <span className={`${headLabel} text-right`}>Avg per day</span>
                  <span />
                </div>
                {pageRows.map((r, i) =>
                  canOpenOrders ? (
                    <Link
                      key={r.customer_id}
                      to={ordersLink(r)}
                      data-testid="rc-row"
                      className={`${rowGrid} border-b border-[#F4F5F7] text-inherit transition hover:bg-[#FCFAFA] dark:border-slate-700/70 dark:hover:bg-slate-700/40`}
                    >
                      {rowBody(r, pageStart + i + 1)}
                    </Link>
                  ) : (
                    <div
                      key={r.customer_id}
                      data-testid="rc-row"
                      className={`${rowGrid} border-b border-[#F4F5F7] dark:border-slate-700/70`}
                    >
                      {rowBody(r, pageStart + i + 1)}
                    </div>
                  ),
                )}
              </>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3 bg-[#FBFBFC] px-5 py-[13px] dark:bg-slate-900/40">
              <span className="text-[12.5px] text-[#8A92A0] dark:text-slate-400">
                {rows.length > PAGE_SIZE
                  ? `Showing ${pageStart + 1}–${pageStart + pageRows.length} of ${rows.length}`
                  : canOpenOrders && rows.length > 0
                    ? 'Click a customer to see their orders'
                    : ''}
              </span>
              {totalPages > 1 && (
                <div className="flex items-center gap-2 text-[13px] text-[#5A6473] dark:text-slate-300">
                  <span className="tabular-nums">
                    Page {currentPage} of {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={currentPage <= 1}
                    onClick={() => setPage(currentPage - 1)}
                    className="rounded-lg border-[1.5px] border-[#E2E5EA] bg-white px-3 py-1.5 font-semibold hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
                  >
                    Previous
                  </button>
                  <button
                    type="button"
                    disabled={currentPage >= totalPages}
                    onClick={() => setPage(currentPage + 1)}
                    className="rounded-lg border-[1.5px] border-[#E2E5EA] bg-white px-3 py-1.5 font-semibold hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-50 dark:border-slate-600 dark:bg-slate-800 dark:hover:bg-slate-700"
                  >
                    Next
                  </button>
                </div>
              )}
              <span className="text-[13px] text-[#8A92A0] dark:text-slate-400">
                Total
                <span className="ml-1.5 text-[15px] font-black tabular-nums text-[#20242C] dark:text-slate-100">
                  {money(listedSpend)}
                </span>
              </span>
            </div>
          </section>
        </FetchingOverlay>
      )}

      {/* The printed sheet: every customer in the current list, in the order on screen. */}
      {printing &&
        createPortal(
          <div id="rc-print-root">
            <style>{PRINT_CSS}</style>
            <h1>Repeated Customers</h1>
            <p className="rc-sub">
              {rangeText} · {scopeText}
              {search.trim() ? ` · Search: “${search.trim()}”` : ''} · {rows.length}{' '}
              {rows.length === 1 ? 'customer' : 'customers'} · {money(listedSpend)} spent
            </p>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th className="rc-r">Days ordered</th>
                  <th className="rc-r">Spend</th>
                  <th className="rc-r">Avg per day</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.customer_id}>
                    <td>{i + 1}</td>
                    <td>{customerName(r)}</td>
                    <td>{r.phone ?? ''}</td>
                    <td className="rc-r">{r.days}</td>
                    <td className="rc-r">{money(r.spend)}</td>
                    <td className="rc-r">{money(avgPerDay(r))}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="rc-r">{money(listedSpend)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            <p className="rc-foot">
              A repeated customer ordered on two or more different days in the range; several orders on one day count as
              one. Spend leaves out cancelled orders.
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default RepeatedCustomers;
