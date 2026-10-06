import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { MdOutlineConfirmationNumber } from 'react-icons/md';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api';
import SearchableSelect from '../../components/SearchableSelect';
import FetchingOverlay from '../../components/FetchingOverlay';
import { Branch, PrintedVoucherReport as ReportData } from '../../types';
import { useResultsRefreshing } from '../../components/useResultsRefreshing';
import { isEntityInactive } from '../../utils/entityStatus';
import { formatOrderType } from '../../utils/format';
import { prettyDay, voucherFace } from '../../utils/voucherText';

const PAGE_SIZE = 25;

const money = (n: number): string =>
  `Rs. ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const dateTime = (iso: string | null): string => (iso ? new Date(iso).toLocaleString() : '—');

const selectTrigger =
  'flex w-full items-center justify-between gap-2 rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-2.5 text-left text-[13.5px] text-[#1F2430] outline-none transition hover:border-[#D3D7DE] focus:border-[#DC2A2A]';
const dateInput =
  'w-full rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-2.5 text-[13.5px] text-[#1F2430] outline-none transition hover:border-[#D3D7DE] focus:border-[#DC2A2A]';
const filterLabel = 'mb-1.5 block text-[11px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]';
const th = 'px-3 py-2.5 text-left text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]';
const td = 'px-3 py-2.5 text-[13.5px] text-gray-700';
const num = 'text-right tabular-nums';

/**
 * Print stylesheet, mounted only while a print is in flight, so it cannot
 * affect how any other screen prints (receipts in particular). The sheet is
 * portalled to <body> as #pv-print-root and everything else is hidden.
 */
const PRINT_CSS = `
#pv-print-root { display: none; }
@media print {
  @page { size: A4 portrait; margin: 12mm; }
  body > *:not(#pv-print-root) { display: none !important; }
  #pv-print-root { display: block !important; font: 9.5pt/1.4 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; color: #111; }
  #pv-print-root h1 { font-size: 16pt; font-weight: 800; margin: 0 0 1mm; }
  #pv-print-root h2 { font-size: 10.5pt; font-weight: 800; margin: 6mm 0 2mm; }
  #pv-print-root .pv-sub { font-size: 9pt; color: #444; margin: 0 0 4mm; padding-bottom: 3mm; border-bottom: 1.5pt solid #111; }
  #pv-print-root table { width: 100%; border-collapse: collapse; }
  #pv-print-root tr { break-inside: avoid; page-break-inside: avoid; }
  #pv-print-root th { font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .04em; text-align: left; padding: 1.6mm 2mm; border-bottom: 1pt solid #111; background: #F2F3F5; }
  #pv-print-root td { font-size: 9pt; padding: 1.4mm 2mm; border-bottom: 0.5pt solid #DDE0E5; }
  #pv-print-root .pv-r { text-align: right; font-variant-numeric: tabular-nums; }
  #pv-print-root tfoot td { font-weight: 800; border-top: 1pt solid #111; border-bottom: none; }
}
`;

/**
 * Reports → Printed Vouchers.
 *
 * The system's side of counting the paper vouchers staff collected: which
 * vouchers were redeemed, at which branch, on which day, by which cashier, and
 * what they took off. Counts orders placed in the range; cancelled ones are
 * left out.
 */
const PrintedVoucherReport: React.FC = () => {
  const today = new Date().toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [branchId, setBranchId] = useState<number | null>(null);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [voucherId, setVoucherId] = useState<number | null>(null);
  const [page, setPage] = useState(1);
  const [printing, setPrinting] = useState(false);

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
  const { data: vouchers } = useQuery({
    queryKey: ['printed-vouchers'],
    queryFn: () => adminService.getPrintedVouchers(),
  });

  const reportKey = ['printed-voucher-report', dateFrom, dateTo, branchId, brandId, voucherId];
  const { data, isLoading, isError, isFetching } = useQuery<ReportData>({
    queryKey: reportKey,
    queryFn: () =>
      adminService.getPrintedVoucherReport({
        date_from: dateFrom,
        date_to: dateTo,
        branch_id: branchId,
        brand_id: brandId,
        voucher_id: voucherId,
      }),
    placeholderData: keepPreviousData,
  });
  const refreshing = useResultsRefreshing(reportKey, isFetching);

  // A new selection starts on its first page.
  useEffect(() => setPage(1), [dateFrom, dateTo, branchId, brandId, voucherId]);

  const voucherOptions = useMemo(
    () => (vouchers ?? []).filter((v) => brandId == null || v.brand_id === brandId),
    [vouchers, brandId],
  );

  const rows = data?.rows ?? [];
  const totalPages = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageRows = rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const totals = data?.totals;
  const rangeText = dateFrom === dateTo ? prettyDay(dateFrom) : `${prettyDay(dateFrom)} – ${prettyDay(dateTo)}`;
  const scopeText = [
    branchId != null ? (branches ?? []).find((b) => b.id === branchId)?.name : 'All branches',
    brandId != null ? (brands ?? []).find((b) => b.id === brandId)?.name : 'All brands',
    voucherId != null ? (vouchers ?? []).find((v) => v.id === voucherId)?.name : 'All vouchers',
  ]
    .filter(Boolean)
    .join(' · ');

  const exportCsv = () => {
    const cell = (v: string | number | null) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [
      [
        'Placed at',
        'Order ID',
        'Order number',
        'Branch',
        'Brand',
        'Voucher',
        'Order type',
        'Customer',
        'Phone',
        'Subtotal',
        'Papers',
        'Voucher discount',
        'Total charged',
        'Applied by',
        'Status',
      ].join(','),
      ...rows.map((r) =>
        [
          dateTime(r.placed_at),
          r.order_id,
          r.order_number,
          r.branch_name,
          r.brand_name,
          r.voucher_name,
          formatOrderType(r.order_type),
          r.customer_name,
          r.customer_phone,
          r.subtotal,
          r.papers,
          r.discount,
          r.total,
          r.applied_by,
          r.status,
        ]
          .map(cell)
          .join(','),
      ),
    ];
    const url = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `printed-vouchers_${dateFrom}_to_${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const hasData = (totals?.papers ?? 0) > 0 || (totals?.redemptions ?? 0) > 0;

  return (
    <div className="w-full px-4 py-6 sm:px-6 lg:px-12">
      {/* Header */}
      <div className="mb-[22px] flex flex-wrap items-start gap-4">
        <span className="flex h-[46px] w-[46px] flex-none items-center justify-center rounded-xl bg-red-50 text-red-600">
          <MdOutlineConfirmationNumber size={24} />
        </span>
        <div className="min-w-[280px] flex-1">
          <h1 className="mb-1.5 text-2xl font-extrabold tracking-tight text-gray-800 sm:text-[28px]">
            Printed Vouchers Report
          </h1>
          <p className="max-w-[760px] text-[14px] leading-relaxed text-gray-500">
            Which paper vouchers were redeemed, where, when and by whom — to check against the vouchers your staff
            collected. Counts orders placed in the range; cancelled orders are left out. Vouchers are set up under{' '}
            <Link to="/admin/printed-vouchers" className="font-semibold text-red-600 hover:underline">
              Printed Vouchers
            </Link>
            .
          </p>
        </div>
        <div className="flex flex-none gap-2">
          <button
            type="button"
            onClick={() => setPrinting(true)}
            disabled={!hasData}
            className="rounded-[11px] border-[1.5px] border-gray-300 bg-white px-4 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Print
          </button>
          <button
            type="button"
            onClick={exportCsv}
            disabled={!hasData}
            className="rounded-[11px] bg-red-600 px-4 py-2.5 text-sm font-bold text-white shadow-lg shadow-red-600/25 transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Export CSV
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-5 grid grid-cols-1 gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm sm:grid-cols-2 lg:grid-cols-5">
        <label className="block">
          <span className={filterLabel}>From</span>
          <input
            type="date"
            value={dateFrom}
            max={dateTo || undefined}
            onChange={(e) => setDateFrom(e.target.value || today)}
            className={dateInput}
          />
        </label>
        <label className="block">
          <span className={filterLabel}>To</span>
          <input
            type="date"
            value={dateTo}
            min={dateFrom || undefined}
            onChange={(e) => setDateTo(e.target.value || today)}
            className={dateInput}
          />
        </label>
        <div>
          <span className={filterLabel}>Branch</span>
          <SearchableSelect
            value={branchId != null ? String(branchId) : ''}
            onChange={(v) => setBranchId(v ? Number(v) : null)}
            options={[
              { value: '', label: 'All branches' },
              ...(branches ?? []).map((b) => ({ value: String(b.id), label: b.name, inactive: isEntityInactive(b) })),
            ]}
            triggerClassName={selectTrigger}
            ariaLabel="Branch"
          />
        </div>
        <div>
          <span className={filterLabel}>Brand</span>
          <SearchableSelect
            value={brandId != null ? String(brandId) : ''}
            onChange={(v) => {
              setBrandId(v ? Number(v) : null);
              setVoucherId(null);
            }}
            options={[
              { value: '', label: 'All brands' },
              ...(brands ?? []).map((b) => ({ value: String(b.id), label: b.name, inactive: isEntityInactive(b) })),
            ]}
            triggerClassName={selectTrigger}
            ariaLabel="Brand"
          />
        </div>
        <div>
          <span className={filterLabel}>Voucher</span>
          <SearchableSelect
            value={voucherId != null ? String(voucherId) : ''}
            onChange={(v) => setVoucherId(v ? Number(v) : null)}
            options={[
              { value: '', label: 'All vouchers' },
              ...voucherOptions.map((v) => ({
                value: String(v.id),
                label: `${v.name} (${voucherFace(v)})`,
                inactive: !v.is_active,
              })),
            ]}
            triggerClassName={selectTrigger}
            ariaLabel="Voucher"
          />
        </div>
      </div>

      {isLoading ? (
        <div className="py-12 text-center text-gray-500">Loading…</div>
      ) : isError ? (
        <p className="py-8 text-center text-sm text-red-600">Failed to load the voucher report.</p>
      ) : (
        <FetchingOverlay active={refreshing} label="Updating report…">
          {/* Summary */}
          <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
            {(
              [
                ['Vouchers collected', String(totals?.papers ?? 0), `Paper vouchers, on ${totals?.redemptions ?? 0} ${(totals?.redemptions ?? 0) === 1 ? 'order' : 'orders'}`],
                ['Discount given', money(totals?.discount ?? 0), 'What the vouchers took off'],
                ['Average per voucher', money(totals?.average_discount ?? 0), 'Discount given ÷ vouchers collected'],
                ['Charged on these orders', money(totals?.total ?? 0), 'After the voucher, tax included'],
              ] as Array<[string, string, string]>
            ).map(([label, value, hint]) => (
              <div key={label} className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
                <div className="text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]">{label}</div>
                <div className="mt-1.5 text-[22px] font-extrabold tracking-tight text-gray-800">{value}</div>
                <div className="mt-0.5 text-[12px] text-gray-400">{hint}</div>
              </div>
            ))}
          </div>

          {!hasData ? (
            <div className="rounded-2xl border-[1.5px] border-dashed border-gray-300 bg-gray-50 px-6 py-12 text-center">
              <p className="text-[15px] font-semibold text-gray-700">No vouchers were redeemed in this range</p>
              <p className="mt-1 text-[13px] text-gray-500">Try a wider date range or clear the filters.</p>
            </div>
          ) : (
            <>
              {/* By voucher */}
              <section className="mb-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <h2 className="border-b border-gray-100 px-4 py-3 text-[14px] font-bold text-gray-800">By voucher</h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={th}>Voucher</th>
                        <th className={th}>Brand</th>
                        <th className={th}>Worth</th>
                        <th className={`${th} ${num}`}>Papers</th>
                        <th className={`${th} ${num}`}>Orders</th>
                        <th className={`${th} ${num}`}>Discount given</th>
                        <th className={`${th} ${num}`}>Charged</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data!.by_voucher.map((v) => (
                        <tr key={`${v.voucher_id ?? 'deleted'}-${v.voucher_name}-${v.brand_name}`}>
                          <td className={`${td} font-semibold text-gray-800`}>
                            {v.voucher_name}
                            {v.voucher_id == null && (
                              <span className="ml-2 rounded bg-gray-100 px-1.5 py-0.5 text-[10.5px] font-bold uppercase text-gray-500">
                                Deleted
                              </span>
                            )}
                          </td>
                          <td className={td}>{v.brand_name ?? '—'}</td>
                          <td className={td}>
                            {v.voucher_type != null && v.value != null
                              ? voucherFace({ voucher_type: v.voucher_type, value: v.value })
                              : '—'}
                          </td>
                          <td className={`${td} ${num} font-semibold`}>{v.papers}</td>
                          <td className={`${td} ${num}`}>{v.redemptions}</td>
                          <td className={`${td} ${num}`}>{money(v.discount)}</td>
                          <td className={`${td} ${num}`}>{money(v.total)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50">
                        <td className={`${td} font-bold text-gray-800`} colSpan={3}>
                          Total
                        </td>
                        <td className={`${td} ${num} font-bold text-gray-800`}>{totals!.papers}</td>
                        <td className={`${td} ${num} font-bold text-gray-800`}>{totals!.redemptions}</td>
                        <td className={`${td} ${num} font-bold text-gray-800`}>{money(totals!.discount)}</td>
                        <td className={`${td} ${num} font-bold text-gray-800`}>{money(totals!.total)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </section>

              {/* By day and branch */}
              <section className="mb-5 overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <h2 className="border-b border-gray-100 px-4 py-3 text-[14px] font-bold text-gray-800">
                  By day and branch
                  <span className="ml-2 text-[12px] font-normal text-gray-400">
                    the count to match against the paper vouchers collected
                  </span>
                </h2>
                <div className="max-h-[420px] overflow-auto">
                  <table className="min-w-full">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr>
                        <th className={th}>Day</th>
                        <th className={th}>Branch</th>
                        <th className={th}>Voucher</th>
                        <th className={`${th} ${num}`}>Papers</th>
                        <th className={`${th} ${num}`}>Orders</th>
                        <th className={`${th} ${num}`}>Discount given</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {data!.by_day.map((d) => (
                        <tr key={`${d.day}-${d.branch_name}-${d.voucher_name}`}>
                          <td className={`${td} whitespace-nowrap`}>{prettyDay(d.day)}</td>
                          <td className={td}>{d.branch_name ?? '—'}</td>
                          <td className={td}>{d.voucher_name}</td>
                          <td className={`${td} ${num} font-semibold`}>{d.papers}</td>
                          <td className={`${td} ${num}`}>{d.redemptions}</td>
                          <td className={`${td} ${num}`}>{money(d.discount)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* Order by order */}
              <section className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm">
                <h2 className="border-b border-gray-100 px-4 py-3 text-[14px] font-bold text-gray-800">
                  Redemptions
                  <span className="ml-2 text-[12px] font-normal text-gray-400">
                    {rows.length} {rows.length === 1 ? 'order' : 'orders'}
                    {data!.rows_truncated ? ' shown — narrow the range to list the rest' : ''}
                  </span>
                </h2>
                <div className="overflow-x-auto">
                  <table className="min-w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className={th}>Placed</th>
                        <th className={th}>Order</th>
                        <th className={th}>Branch</th>
                        <th className={th}>Vouchers</th>
                        <th className={`${th} ${num}`}>Papers</th>
                        <th className={th}>Customer</th>
                        <th className={th}>Type</th>
                        <th className={`${th} ${num}`}>Subtotal</th>
                        <th className={`${th} ${num}`}>Voucher</th>
                        <th className={`${th} ${num}`}>Charged</th>
                        <th className={th}>Applied by</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {pageRows.map((r) => (
                        <tr key={r.id}>
                          <td className={`${td} whitespace-nowrap`}>{dateTime(r.placed_at)}</td>
                          <td className={`${td} whitespace-nowrap`}>
                            <Link to={`/admin/orders/${r.id}`} className="font-semibold text-red-600 hover:underline">
                              #{r.order_number ?? r.id}
                            </Link>
                            {r.order_id && <span className="block text-[11.5px] text-gray-400">{r.order_id}</span>}
                          </td>
                          <td className={td}>
                            {r.branch_name ?? '—'}
                            <span className="block text-[11.5px] text-gray-400">{r.brand_name ?? ''}</span>
                          </td>
                          <td className={`${td} font-semibold text-gray-800`}>{r.voucher_name}</td>
                          <td className={`${td} ${num}`}>{r.papers}</td>
                          <td className={td}>
                            {r.customer_name ?? '—'}
                            {r.customer_phone && (
                              <span className="block text-[11.5px] text-gray-400">{r.customer_phone}</span>
                            )}
                          </td>
                          <td className={`${td} whitespace-nowrap`}>{formatOrderType(r.order_type)}</td>
                          <td className={`${td} ${num}`}>{money(r.subtotal)}</td>
                          <td className={`${td} ${num} font-semibold text-amber-700`}>−{money(r.discount)}</td>
                          <td className={`${td} ${num}`}>{money(r.total)}</td>
                          <td className={td}>{r.applied_by ?? '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {totalPages > 1 && (
                  <div className="flex items-center justify-between border-t border-gray-100 px-4 py-3 text-[13px] text-gray-600">
                    <span>
                      Page {page} of {totalPages}
                    </span>
                    <div className="flex gap-2">
                      <button
                        type="button"
                        disabled={page <= 1}
                        onClick={() => setPage((p) => Math.max(1, p - 1))}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Previous
                      </button>
                      <button
                        type="button"
                        disabled={page >= totalPages}
                        onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                        className="rounded-lg border border-gray-300 bg-white px-3 py-1.5 font-semibold disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </section>
            </>
          )}
        </FetchingOverlay>
      )}

      {/* The printed sheet: the summary and the two counts, without the order list. */}
      {printing &&
        data &&
        createPortal(
          <div id="pv-print-root">
            <style>{PRINT_CSS}</style>
            <h1>Printed Vouchers Report</h1>
            <p className="pv-sub">
              {rangeText} · {scopeText} · {totals?.papers ?? 0} vouchers on {totals?.redemptions ?? 0} orders · {money(totals?.discount ?? 0)} given
            </p>
            <h2>By voucher</h2>
            <table>
              <thead>
                <tr>
                  <th>Voucher</th>
                  <th>Brand</th>
                  <th className="pv-r">Papers</th>
                  <th className="pv-r">Orders</th>
                  <th className="pv-r">Discount given</th>
                </tr>
              </thead>
              <tbody>
                {data.by_voucher.map((v) => (
                  <tr key={`${v.voucher_id ?? 'deleted'}-${v.voucher_name}-${v.brand_name}`}>
                    <td>{v.voucher_name}</td>
                    <td>{v.brand_name ?? ''}</td>
                    <td className="pv-r">{v.papers}</td>
                    <td className="pv-r">{v.redemptions}</td>
                    <td className="pv-r">{money(v.discount)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={2}>Total</td>
                  <td className="pv-r">{totals?.papers ?? 0}</td>
                  <td className="pv-r">{totals?.redemptions ?? 0}</td>
                  <td className="pv-r">{money(totals?.discount ?? 0)}</td>
                </tr>
              </tfoot>
            </table>
            <h2>By day and branch</h2>
            <table>
              <thead>
                <tr>
                  <th>Day</th>
                  <th>Branch</th>
                  <th>Voucher</th>
                  <th className="pv-r">Papers</th>
                  <th className="pv-r">Orders</th>
                  <th className="pv-r">Discount given</th>
                </tr>
              </thead>
              <tbody>
                {data.by_day.map((d) => (
                  <tr key={`${d.day}-${d.branch_name}-${d.voucher_name}`}>
                    <td>{prettyDay(d.day)}</td>
                    <td>{d.branch_name ?? ''}</td>
                    <td>{d.voucher_name}</td>
                    <td className="pv-r">{d.papers}</td>
                    <td className="pv-r">{d.redemptions}</td>
                    <td className="pv-r">{money(d.discount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>,
          document.body,
        )}
    </div>
  );
};

export default PrintedVoucherReport;
