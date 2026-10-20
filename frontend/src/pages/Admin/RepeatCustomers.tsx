import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { MdOutlineRepeat } from 'react-icons/md';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api';
import SearchableSelect from '../../components/SearchableSelect';
import FetchingOverlay from '../../components/FetchingOverlay';
import { Branch, RepeatCustomerRow, RepeatCustomersReport } from '../../types';
import { useResultsRefreshing } from '../../components/useResultsRefreshing';
import { useHasPermission } from '../../hooks/useHasPermission';
import { useSensitivePageView } from '../../hooks/useSensitivePageView';
import { recordBeacon } from '../../utils/activityBeacon';
import { customerOrdersPath } from '../../utils/customerOrdersPath';
import { isEntityInactive } from '../../utils/entityStatus';
import { prettyDay } from '../../utils/voucherText';
import { defaultRange } from './dashboard/dateRanges';

const PAGE_SIZE = 25;

type SortKey = 'days' | 'spend' | 'name';

const money = (n: number): string =>
  `Rs. ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** What the row is called on screen, in the CSV and on paper. */
const customerName = (r: RepeatCustomerRow): string => r.name ?? r.phone ?? `Customer #${r.customer_id}`;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

const selectTrigger =
  'flex w-full items-center justify-between gap-2 rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-2.5 text-left text-[13.5px] text-[#1F2430] outline-none transition hover:border-[#D3D7DE] focus:border-[#DC2A2A]';
const fieldInput =
  'w-full rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-2.5 text-[13.5px] text-[#1F2430] outline-none transition hover:border-[#D3D7DE] focus:border-[#DC2A2A]';
const filterLabel = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]';
const th = 'px-4 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]';
const td = 'px-4 py-2.5 text-[13.5px] text-gray-700';
const num = 'text-right tabular-nums';

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
 * Reports → Repeat Customers.
 *
 * Customers who ordered on two or more DIFFERENT days in the range. Several
 * orders on one day are one visit, so the number is days, not orders.
 * Cancelled orders are left out; spend is the total of the orders counted.
 * Each name opens the Orders page on that customer, narrowed to the same
 * range, branch and brand, so the list there shows the days counted here.
 *
 * The filters live in the URL: going back from a customer's orders lands on
 * the same report, not a reset one.
 */
const RepeatCustomers: React.FC = () => {
  useSensitivePageView('repeat-customers');
  const canOpenOrders = useHasPermission('orders:view');
  const [searchParams, setSearchParams] = useSearchParams();
  const fallback = useMemo(() => defaultRange(), []);

  const fromParam = searchParams.get('date_from') ?? '';
  const toParam = searchParams.get('date_to') ?? '';
  const dateFrom = YMD.test(fromParam) ? fromParam : fallback.from;
  const dateTo = YMD.test(toParam) ? toParam : fallback.to;
  const branchId = /^\d+$/.test(searchParams.get('branch_id') ?? '') ? Number(searchParams.get('branch_id')) : null;
  const brandId = /^\d+$/.test(searchParams.get('brand_id') ?? '') ? Number(searchParams.get('brand_id')) : null;
  const search = searchParams.get('q') ?? '';

  const [sortKey, setSortKey] = useState<SortKey>('days');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [page, setPage] = useState(1);
  const [printing, setPrinting] = useState(false);

  /** Replace, not push: typing in the search box must not fill the back button. */
  const setParam = (key: string, value: string | null) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(key, value);
    else next.delete(key);
    setSearchParams(next, { replace: true });
  };

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

  const reportKey = ['repeat-customers-report', dateFrom, dateTo, branchId, brandId];
  const { data, isLoading, isError, isFetching } = useQuery<RepeatCustomersReport>({
    queryKey: reportKey,
    queryFn: () =>
      adminService.getRepeatCustomers({ date_from: dateFrom, date_to: dateTo, branch_id: branchId, brand_id: brandId }),
    placeholderData: keepPreviousData,
  });
  const refreshing = useResultsRefreshing(reportKey, isFetching);

  // A new selection starts on its first page.
  useEffect(() => setPage(1), [dateFrom, dateTo, branchId, brandId, search, sortKey, sortDir]);

  const rows = useMemo(() => {
    const term = search.trim().toLowerCase();
    // Phones are stored as 03XXXXXXXXX; let "0300 123-4567" find them too.
    const digits = term.replace(/[\s-]/g, '');
    const matched = term
      ? (data?.rows ?? []).filter(
          (r) =>
            (r.name ?? '').toLowerCase().includes(term) ||
            (digits.length > 0 && (r.phone ?? '').includes(digits)),
        )
      : (data?.rows ?? []);
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
  }, [data, search, sortKey, sortDir]);

  // The tiles describe what the table lists, so a search narrows them too.
  const customerCount = rows.length;
  const spendTotal = Math.round(rows.reduce((sum, r) => sum + r.spend, 0) * 100) / 100;

  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;
  const pageRows = rows.slice(pageStart, pageStart + PAGE_SIZE);

  const rangeText = dateFrom === dateTo ? prettyDay(dateFrom) : `${prettyDay(dateFrom)} – ${prettyDay(dateTo)}`;
  const scopeText = [
    branchId != null ? ((branches ?? []).find((b) => b.id === branchId)?.name ?? 'One branch') : 'All branches',
    brandId != null ? ((brands ?? []).find((b) => b.id === brandId)?.name ?? 'One brand') : 'All brands',
  ].join(' · ');

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortKey(key);
      setSortDir(key === 'name' ? 'asc' : 'desc');
    }
  };
  const sortArrow = (key: SortKey) => (sortKey === key ? (sortDir === 'desc' ? ' ▾' : ' ▴') : '');
  const ariaSort = (key: SortKey): 'ascending' | 'descending' | 'none' =>
    sortKey === key ? (sortDir === 'asc' ? 'ascending' : 'descending') : 'none';

  // Same range as the report, so the list there shows the days counted here
  // (the Orders page drops its date chip for the whole history).
  const ordersLink = (r: RepeatCustomerRow): string => {
    const path = customerOrdersPath({ id: r.customer_id, name: r.name, phone: r.phone ?? '' }, { brandId, branchId });
    return `${path}&${new URLSearchParams({ date_from: dateFrom, date_to: dateTo }).toString()}`;
  };

  const exportCsv = () => {
    const cell = (v: string | number | null) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      ['Customer', 'Phone', 'Days ordered', 'Spend'].join(','),
      ...rows.map((r) => [customerName(r), r.phone, r.days, r.spend.toFixed(2)].map(cell).join(',')),
    ];
    // A download never reaches the server, so this is the only place it can
    // be recorded — and this file is a list of customer phone numbers.
    recordBeacon({ action: 'client.export', subject: 'repeat-customers' });
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `repeat-customers_${dateFrom}_to_${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const printReport = () => {
    recordBeacon({ action: 'client.print', subject: 'repeat-customers' });
    setPrinting(true);
  };

  const sortHeader = (key: SortKey, label: string, alignRight: boolean) => (
    <th className={`${th} ${alignRight ? num : ''}`} aria-sort={ariaSort(key)}>
      <button
        type="button"
        onClick={() => toggleSort(key)}
        className="font-bold uppercase tracking-[0.05em] hover:text-gray-600"
      >
        {label}
        {sortArrow(key)}
      </button>
    </th>
  );

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-12">
      {/* Header */}
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
        <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl bg-red-50 text-red-600">
          <MdOutlineRepeat size={24} />
        </span>
        <div className="min-w-[240px] flex-1">
          <h1 className="mb-1.5 text-2xl font-extrabold tracking-tight text-gray-800 sm:text-[28px]">
            Repeat Customers
          </h1>
          <p className="max-w-[760px] text-[14px] leading-relaxed text-gray-500">
            Customers who ordered on two or more different days in the range. Several orders on the same day count as
            one day. Cancelled orders are left out, and spend is the total of the orders counted. Click a name to see
            those orders.
          </p>
        </div>
        <div className="flex flex-none gap-2">
          <button
            type="button"
            onClick={printReport}
            disabled={rows.length === 0}
            className="rounded-[11px] border-[1.5px] border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Print
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="rounded-[11px] bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-5 grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className={filterLabel}>Search</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setParam('q', e.target.value)}
            placeholder="Name or phone"
            className={fieldInput}
          />
        </label>
        <label className="block">
          <span className={filterLabel}>From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setParam('date_from', e.target.value || null)}
            className={fieldInput}
          />
        </label>
        <label className="block">
          <span className={filterLabel}>To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setParam('date_to', e.target.value || null)}
            className={fieldInput}
          />
        </label>
        <div>
          <span className={filterLabel}>Branch</span>
          <SearchableSelect
            value={branchId != null ? String(branchId) : ''}
            onChange={(v) => setParam('branch_id', v || null)}
            options={[
              { value: '', label: 'All branches' },
              ...(branches ?? []).map((b) => ({ value: String(b.id), label: b.name, inactive: isEntityInactive(b) })),
            ]}
            triggerClassName={selectTrigger}
            searchPlaceholder="Search branches…"
            ariaLabel="Branch"
          />
        </div>
        <div>
          <span className={filterLabel}>Brand</span>
          <SearchableSelect
            value={brandId != null ? String(brandId) : ''}
            onChange={(v) => setParam('brand_id', v || null)}
            options={[
              { value: '', label: 'All brands' },
              ...(brands ?? []).map((b) => ({ value: String(b.id), label: b.name, inactive: isEntityInactive(b) })),
            ]}
            triggerClassName={selectTrigger}
            searchPlaceholder="Search brands…"
            ariaLabel="Brand"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading…</div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-red-600">Failed to load the repeat customers report.</p>
      ) : (
        <FetchingOverlay active={refreshing} label="Updating report…">
          {/* Summary */}
          <div className="mb-5 grid grid-cols-2 gap-3">
            {(
              [
                ['Repeat customers', customerCount.toLocaleString('en-US'), 'Ordered on 2 or more different days'],
                ['Their spend', money(spendTotal), 'Total of the orders counted'],
              ] as Array<[string, string, string]>
            ).map(([label, value, hint]) => (
              <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]">{label}</div>
                <div className="mt-1.5 text-[22px] font-extrabold tracking-tight text-gray-800">{value}</div>
                <div className="mt-0.5 text-[12px] text-gray-400">{hint}</div>
              </div>
            ))}
          </div>

          {rows.length === 0 ? (
            <div className="rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
              <p className="text-[15px] font-semibold text-gray-700">
                {search.trim()
                  ? 'No repeat customer matches this search'
                  : 'No customer ordered on more than one day in this range'}
              </p>
              <p className="mt-1 text-[13px] text-gray-500">Try a wider date range or clear the filters.</p>
            </div>
          ) : (
            <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
              <h2 className="border-b border-gray-100 px-4 py-3 text-[14px] font-bold text-gray-800">
                Customers
                <span className="ml-2 text-[12px] font-normal text-gray-400">
                  {rangeText} · {scopeText}
                </span>
              </h2>
              <div className="overflow-x-auto">
                <table className="min-w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      {sortHeader('name', 'Customer', false)}
                      {sortHeader('days', 'Days ordered', true)}
                      {sortHeader('spend', 'Spend', true)}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {pageRows.map((r) => (
                      <tr key={r.customer_id}>
                        <td className={td}>
                          {canOpenOrders ? (
                            <Link to={ordersLink(r)} className="font-semibold text-red-600 hover:underline">
                              {customerName(r)}
                            </Link>
                          ) : (
                            <span className="font-semibold text-gray-800">{customerName(r)}</span>
                          )}
                          {r.name && r.phone && (
                            <span className="block text-[11.5px] text-gray-400">{r.phone}</span>
                          )}
                        </td>
                        <td className={`${td} ${num} font-semibold text-gray-800`}>{r.days}</td>
                        <td className={`${td} ${num} whitespace-nowrap`}>{money(r.spend)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 px-4 py-3 text-[13px] text-gray-600">
                <span className="tabular-nums">
                  Showing {pageStart + 1}–{pageStart + pageRows.length} of {rows.length}
                </span>
                {totalPages > 1 && (
                  <div className="flex items-center gap-2">
                    <span className="tabular-nums">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button
                      type="button"
                      disabled={currentPage <= 1}
                      onClick={() => setPage(currentPage - 1)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Previous
                    </button>
                    <button
                      type="button"
                      disabled={currentPage >= totalPages}
                      onClick={() => setPage(currentPage + 1)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Next
                    </button>
                  </div>
                )}
              </div>
            </section>
          )}
        </FetchingOverlay>
      )}

      {/* The printed sheet: every customer in the current list, in the order on screen. */}
      {printing &&
        createPortal(
          <div id="rc-print-root">
            <style>{PRINT_CSS}</style>
            <h1>Repeat Customers</h1>
            <p className="rc-sub">
              {rangeText} · {scopeText}
              {search.trim() ? ` · Search: “${search.trim()}”` : ''} · {customerCount}{' '}
              {customerCount === 1 ? 'customer' : 'customers'} · {money(spendTotal)} spent
            </p>
            <table>
              <thead>
                <tr>
                  <th>#</th>
                  <th>Customer</th>
                  <th>Phone</th>
                  <th className="rc-r">Days ordered</th>
                  <th className="rc-r">Spend</th>
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
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={4}>Total</td>
                  <td className="rc-r">{money(spendTotal)}</td>
                </tr>
              </tfoot>
            </table>
            <p className="rc-foot">
              A repeat customer ordered on two or more different days in the range; several orders on one day count as
              one. Cancelled orders are left out.
            </p>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default RepeatCustomers;
