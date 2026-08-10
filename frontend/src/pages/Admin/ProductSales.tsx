import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQuery } from '@tanstack/react-query';
import apiClient from '../../utils/apiClient';
import SearchableSelect from '../../components/SearchableSelect';
import { Branch } from '../../types';

/**
 * The discount stages the pricing engine runs, each carrying this row's
 * pro-rata slice of it. They sum to `discount`, so the report can say which
 * kind of discount gave the money away, not just how much went.
 */
interface DiscountBreakdown {
  promo: number;
  order: number;
  coupon: number;
  card: number;
  staff: number;
}

type DiscountKind = keyof DiscountBreakdown;

/** Short label for the table, long one for the summary strip and print. */
const DISCOUNT_TYPES: Array<{ key: DiscountKind; short: string; long: string }> = [
  { key: 'promo', short: 'Promo', long: 'Product promotion' },
  { key: 'order', short: 'Order', long: 'Order discount' },
  { key: 'coupon', short: 'Coupon', long: 'Coupon' },
  { key: 'card', short: 'Card', long: 'Bank card offer' },
  { key: 'staff', short: 'Staff', long: 'Staff discount' },
];

const EMPTY_BREAKDOWN: DiscountBreakdown = {
  promo: 0,
  order: 0,
  coupon: 0,
  card: 0,
  staff: 0,
};

/** The stages that actually contributed, biggest first. */
const kindsOf = (
  b: DiscountBreakdown | undefined
): Array<{ key: DiscountKind; short: string; long: string; amount: number }> =>
  DISCOUNT_TYPES.map((t) => ({ ...t, amount: b?.[t.key] ?? 0 }))
    .filter((t) => t.amount > 0)
    .sort((x, y) => y.amount - x.amount);

/** One split row under a product: a variant, a branch or a brand. */
interface ProductSalesChild {
  id: number | null;
  name: string;
  quantity: number;
  orders: number;
  gross_sales: number;
  discount: number;
  discount_breakdown: DiscountBreakdown;
  net_sales: number;
}

interface ProductSalesRow {
  menu_item_id: number;
  name: string;
  category_id: number | null;
  category_name: string | null;
  brand_id: number | null;
  brand_name: string | null;
  /** How many distinct branches sold it; 1 ⇒ branch_name is the whole story. */
  branch_count: number;
  branch_name: string | null;
  quantity: number;
  orders: number;
  gross_sales: number;
  discount: number;
  discount_breakdown: DiscountBreakdown;
  net_sales: number;
  children: ProductSalesChild[];
}

/** GET /admin/reports/product-sales */
interface ProductSalesReportData {
  split_by: SplitBy;
  status: string;
  date_from: string;
  date_to: string;
  totals: {
    quantity: number;
    orders: number;
    gross_sales: number;
    discount: number;
    discount_breakdown: DiscountBreakdown;
    net_sales: number;
  };
  rows: ProductSalesRow[];
}

type SplitBy = 'variant' | 'branch' | 'brand' | 'none';
type SortBy = 'quantity' | 'gross_sales' | 'net_sales' | 'orders' | 'name';

const STATUS_OPTIONS = [
  { value: 'completed', label: 'Completed only' },
  { value: 'excluding_cancelled', label: 'Excl. cancelled' },
  { value: 'all', label: 'All orders' },
];

// Branch and brand are columns on every row now, so splitting by them here
// would only repeat what the table already says.
const SPLIT_OPTIONS: Array<{ value: SplitBy; label: string }> = [
  { value: 'variant', label: 'Variant / size' },
  { value: 'none', label: 'No breakdown' },
];

const PAGE_SIZES = [10, 25, 50, 100, 0]; // 0 ⇒ show everything

/** Column widths shared by the head, every row and the totals strip. */
const GRID = '44px minmax(220px,2.1fr) 1.3fr 1fr 1fr 64px 74px 118px 152px 130px';

const money = (n: number): string =>
  `Rs. ${Number(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const prettyDay = (ymd: string, withYear: boolean): string => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) return ymd;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(withYear ? { year: 'numeric' } : {}),
  });
};

/** Trigger styling handed to SearchableSelect so its dropdowns match this page. */
const selectTrigger =
  'flex w-full items-center justify-between gap-2 rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-2.5 text-left text-[13.5px] text-[#1F2430] outline-none transition hover:border-[#D3D7DE] focus:border-[#DC2A2A]';

const headCell =
  'text-[10.5px] font-bold uppercase tracking-[0.05em] text-[#9AA1AD]';

/**
 * Print stylesheet. It is mounted only while a print is in flight, so it can
 * blank out everything except the report without touching how any other screen
 * in the app prints (the POS receipt/invoice flows in particular).
 *
 * The report itself is portalled to <body> as #ps-print-root, which is what
 * lets `body > *:not(...)` hide the app shell with `display:none` — hiding by
 * `visibility` instead would keep the shell's boxes and emit blank pages.
 */
const PRINT_CSS = `
#ps-print-root { display: none; }
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  body > *:not(#ps-print-root) { display: none !important; }
  #ps-print-root {
    display: block !important;
    font: 9pt/1.35 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    color: #111;
    -webkit-print-color-adjust: exact;
    print-color-adjust: exact;
  }
  #ps-print-root .psp-title { font-size: 17pt; font-weight: 800; margin: 0 0 2mm; letter-spacing: -0.01em; }
  #ps-print-root .psp-sub { font-size: 9pt; color: #444; margin: 0; }
  #ps-print-root .psp-meta { font-size: 8pt; color: #666; margin: 1mm 0 0; }
  #ps-print-root .psp-head { border-bottom: 1.5pt solid #111; padding-bottom: 3mm; margin-bottom: 4mm; }
  #ps-print-root .psp-kpis { display: flex; gap: 4mm; margin-bottom: 4mm; }
  #ps-print-root .psp-kpi { flex: 1; border: 0.75pt solid #CFD3DA; border-left: 2.5pt solid #111; padding: 2mm 3mm; }
  #ps-print-root .psp-kpi-l { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #666; }
  #ps-print-root .psp-kpi-v { font-size: 12pt; font-weight: 800; margin-top: 1mm; }
  #ps-print-root .psp-kpi-s { font-size: 7.5pt; color: #666; }
  #ps-print-root table { width: 100%; border-collapse: collapse; }
  #ps-print-root thead { display: table-header-group; }
  #ps-print-root tfoot { display: table-footer-group; }
  #ps-print-root tr { break-inside: avoid; page-break-inside: avoid; }
  #ps-print-root th {
    font-size: 7.5pt; font-weight: 700; text-transform: uppercase; letter-spacing: .04em;
    text-align: left; padding: 1.6mm 2mm; border-bottom: 1pt solid #111; background: #F2F3F5;
  }
  #ps-print-root td { font-size: 8.5pt; padding: 1.4mm 2mm; border-bottom: 0.5pt solid #DDE0E5; }
  #ps-print-root .psp-r { text-align: right; font-variant-numeric: tabular-nums; }
  #ps-print-root .psp-name { font-weight: 700; }
  #ps-print-root .psp-child td { color: #555; background: #FAFAFB; }
  #ps-print-root .psp-child .psp-cname { padding-left: 6mm; }
  #ps-print-root tfoot td { font-weight: 800; border-top: 1pt solid #111; border-bottom: none; padding-top: 2mm; }
  #ps-print-root .psp-dk { display: block; font-size: 6.5pt; letter-spacing: 0.02em; text-transform: uppercase; color: #8A6A2F; }
  #ps-print-root .psp-dsum { margin: 0 0 3mm; font-size: 8pt; color: #4A5160; border: 0.5pt solid #E6D9BF; background: #FCF8F0; border-radius: 1.5mm; padding: 2mm 3mm; }
  #ps-print-root .psp-dsum b { color: #8A6A2F; }
  #ps-print-root .psp-foot { margin-top: 4mm; font-size: 7.5pt; color: #666; border-top: 0.5pt solid #DDE0E5; padding-top: 2mm; }
}
`;

/**
 * Reports → Product-wise Sales.
 *
 * Gross is the sum of the sold lines (addons and modifier surcharges included).
 * Discounts live at order level only, so each product carries the slice of its
 * order's discount matching its share of that order's subtotal — see
 * ReportsService.productSales.
 */
const ProductSales: React.FC = () => {
  const today = new Date().toISOString().split('T')[0];
  const [selectedBranch, setSelectedBranch] = useState<number | null>(null);
  const [selectedBrand, setSelectedBrand] = useState<number | null>(null);
  const [categoryId, setCategoryId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState(today);
  const [dateTo, setDateTo] = useState(today);
  const [status, setStatus] = useState('completed');
  const [splitBy, setSplitBy] = useState<SplitBy>('variant');
  const [sortBy, setSortBy] = useState<SortBy>('net_sales');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [allOpen, setAllOpen] = useState(false);
  const [pageSize, setPageSize] = useState(25);
  const [page, setPage] = useState(1);
  const [printing, setPrinting] = useState(false);

  // The print report is only in the DOM while a print is in flight: React has
  // to paint it before the dialog opens, and it must come back out afterwards
  // so the page carries no hidden duplicate of every row.
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
    queryFn: async () => {
      const response = await apiClient.get<Branch[]>('/admin/branches');
      return response.data;
    },
  });

  // Brand-locked users get only their own brands back from this endpoint.
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<Array<{ id: number; name: string }>>('/admin/brands');
      return response.data;
    },
  });

  // Categories are brand-scoped: picking a brand narrows the list.
  const { data: categories } = useQuery({
    queryKey: ['reportCategories', selectedBrand],
    queryFn: async () => {
      const params = selectedBrand ? `?brand_id=${selectedBrand}` : '';
      const response = await apiClient.get<Array<{ id: number; name: string }>>(
        `/admin/categories${params}`
      );
      return response.data;
    },
  });

  const { data, isLoading, isError } = useQuery<ProductSalesReportData>({
    queryKey: [
      'productSales',
      selectedBranch,
      selectedBrand,
      categoryId,
      dateFrom,
      dateTo,
      status,
      splitBy,
      sortBy,
      sortDir,
    ],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (selectedBranch) params.append('branch_id', String(selectedBranch));
      if (selectedBrand) params.append('brand_id', String(selectedBrand));
      if (categoryId) params.append('category_id', String(categoryId));
      params.append('date_from', dateFrom);
      params.append('date_to', dateTo);
      params.append('status', status);
      params.append('split_by', splitBy);
      params.append('sort_by', sortBy);
      params.append('sort_dir', sortDir);
      const response = await apiClient.get<ProductSalesReportData>(
        `/admin/reports/product-sales?${params.toString()}`
      );
      return response.data;
    },
  });

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const term = search.trim().toLowerCase();
    if (!term) return all;
    return all.filter(
      (r) =>
        r.name.toLowerCase().includes(term) ||
        (r.category_name ?? '').toLowerCase().includes(term) ||
        (r.brand_name ?? '').toLowerCase().includes(term)
    );
  }, [data, search]);

  const totals = useMemo(() => {
    const round2 = (n: number) => Math.round(n * 100) / 100;
    // Recomputed over the *visible* rows so the strip agrees with the table
    // once the search box narrows it; order count still comes from the server,
    // which counts orders rather than lines.
    const t = rows.reduce(
      (acc, r) => {
        acc.quantity += r.quantity;
        acc.gross_sales += r.gross_sales;
        acc.discount += r.discount;
        acc.net_sales += r.net_sales;
        for (const type of DISCOUNT_TYPES)
          acc.discount_breakdown[type.key] += r.discount_breakdown?.[type.key] ?? 0;
        return acc;
      },
      {
        quantity: 0,
        gross_sales: 0,
        discount: 0,
        discount_breakdown: { ...EMPTY_BREAKDOWN },
        net_sales: 0,
      }
    );
    const filtered = search.trim().length > 0;
    return {
      quantity: t.quantity,
      gross_sales: round2(t.gross_sales),
      discount: round2(t.discount),
      discount_breakdown: DISCOUNT_TYPES.reduce(
        (acc, type) => ({ ...acc, [type.key]: round2(t.discount_breakdown[type.key]) }),
        { ...EMPTY_BREAKDOWN }
      ),
      net_sales: round2(t.net_sales),
      orders: filtered
        ? rows.reduce((a, r) => a + r.orders, 0)
        : (data?.totals.orders ?? 0),
      ordersAreLineWise: filtered,
    };
  }, [rows, data, search]);

  // Pagination is client-side: the report is a few hundred rows at most, and
  // keeping the whole set in hand is what lets the KPI strip, the totals row
  // and the CSV cover the entire selection rather than the page on screen.
  const pageCount = pageSize === 0 ? 1 : Math.max(1, Math.ceil(rows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageStart = pageSize === 0 ? 0 : (currentPage - 1) * pageSize;
  const pageRows = pageSize === 0 ? rows : rows.slice(pageStart, pageStart + pageSize);

  // Any change to what is being listed sends the reader back to page one.
  const resetPage = () => setPage(1);

  const branchName = branches?.find((b) => b.id === selectedBranch)?.name;
  const brandName = brands?.find((b) => b.id === selectedBrand)?.name;
  const sameYear = dateFrom.slice(0, 4) === dateTo.slice(0, 4);
  const rangeText =
    dateFrom === dateTo
      ? prettyDay(dateFrom, true)
      : `${prettyDay(dateFrom, !sameYear)} – ${prettyDay(dateTo, true)}`;
  const scopeText = `${branchName ?? 'All branches'} · ${brandName ?? 'all brands'}`;

  const toggleSort = (column: SortBy) => {
    resetPage();
    if (sortBy === column) {
      setSortDir((d) => (d === 'desc' ? 'asc' : 'desc'));
    } else {
      setSortBy(column);
      setSortDir(column === 'name' ? 'asc' : 'desc');
    }
  };

  const toggleRow = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAll = () => {
    const next = !allOpen;
    setAllOpen(next);
    setExpanded(next ? new Set(pageRows.map((r) => r.menu_item_id)) : new Set());
  };

  const clearFilters = () => {
    setSelectedBranch(null);
    setSelectedBrand(null);
    setCategoryId(null);
    setSearch('');
    setStatus('completed');
    setDateFrom(today);
    setDateTo(today);
    resetPage();
  };

  const branchLabel = (r: ProductSalesRow): string =>
    r.branch_count > 1 ? `${r.branch_count} branches` : (r.branch_name ?? '—');

  const exportCsv = () => {
    const splitLabel = SPLIT_OPTIONS.find((s) => s.value === splitBy)?.label ?? 'Breakdown';
    const header = [
      'Product',
      'Category',
      'Brand',
      'Branch',
      splitBy === 'none' ? '' : splitLabel,
      'Qty sold',
      'Orders',
      'Gross sales',
      'Discount',
      ...DISCOUNT_TYPES.map((t) => t.long),
      'Net sales',
    ].filter(Boolean);
    const cell = (v: string | number) => {
      const s = String(v ?? '');
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [header.join(',')];
    for (const r of rows) {
      const base = [r.name, r.category_name ?? '', r.brand_name ?? '', branchLabel(r)];
      if (splitBy !== 'none') base.push('');
      lines.push(
        [
          ...base,
          r.quantity,
          r.orders,
          r.gross_sales,
          r.discount,
          ...DISCOUNT_TYPES.map((t) => r.discount_breakdown?.[t.key] ?? 0),
          r.net_sales,
        ]
          .map(cell)
          .join(',')
      );
      if (splitBy !== 'none') {
        for (const c of r.children) {
          lines.push(
            [
              r.name,
              r.category_name ?? '',
              r.brand_name ?? '',
              branchLabel(r),
              c.name,
              c.quantity,
              c.orders,
              c.gross_sales,
              c.discount,
              ...DISCOUNT_TYPES.map((t) => c.discount_breakdown?.[t.key] ?? 0),
              c.net_sales,
            ]
              .map(cell)
              .join(',')
          );
        }
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `product-sales_${dateFrom}_to_${dateTo}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const sortArrow = (column: SortBy) =>
    sortBy === column ? (sortDir === 'desc' ? ' ▾' : ' ▴') : '';

  const discountKindsTotal = kindsOf(totals.discount_breakdown);

  const kpis = [
    {
      label: 'Items sold',
      value: String(totals.quantity),
      sub: `${totals.orders} ${totals.ordersAreLineWise ? 'orders (matched)' : 'orders'}`,
      accent: '#B6BCC6',
      valueColor: '#20242C',
    },
    {
      label: 'Gross sales',
      value: money(totals.gross_sales),
      sub: 'before discounts',
      accent: '#3B82F6',
      valueColor: '#20242C',
    },
    {
      label: 'Discount',
      value: money(totals.discount),
      sub: discountKindsTotal.length
        ? `${discountKindsTotal.length === 1 ? discountKindsTotal[0].long : `${discountKindsTotal.length} types`} · ${
            totals.gross_sales ? ((totals.discount / totals.gross_sales) * 100).toFixed(1) : '0.0'
          }% of gross`
        : 'none given',
      accent: '#E0932B',
      valueColor: '#B45309',
    },
    {
      label: 'Net sales',
      value: money(totals.net_sales),
      sub: `${money(totals.orders ? totals.net_sales / totals.orders : 0)} avg / order`,
      accent: '#22C55E',
      valueColor: '#16A34A',
    },
  ];

  const statusLabel = STATUS_OPTIONS.find((s) => s.value === status)?.label ?? status;
  const categoryLabel = categories?.find((c) => c.id === categoryId)?.name ?? 'All categories';
  const splitLabel = SPLIT_OPTIONS.find((s) => s.value === splitBy)?.label ?? '—';

  /**
   * Print report: the WHOLE filtered selection, not the page on screen, and
   * none of the app shell or the controls. Breakdown rows follow a product only
   * where the reader had it expanded, so the paper matches the screen.
   */
  const printReport = (
    <>
      <style>{PRINT_CSS}</style>
      <div id="ps-print-root">
        <div className="psp-head">
          <h1 className="psp-title">Product-wise Sales</h1>
          <p className="psp-sub">
            {rangeText} · {scopeText}
          </p>
          <p className="psp-meta">
            {categoryLabel} · {statusLabel} · Breakdown: {splitLabel}
            {search.trim() ? ` · Search: “${search.trim()}”` : ''} · {rows.length}{' '}
            {rows.length === 1 ? 'product' : 'products'} · Generated{' '}
            {new Date().toLocaleString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
              hour: '2-digit',
              minute: '2-digit',
            })}
          </p>
        </div>

        <div className="psp-kpis">
          {kpis.map((k) => (
            <div key={k.label} className="psp-kpi" style={{ borderLeftColor: k.accent }}>
              <div className="psp-kpi-l">{k.label}</div>
              <div className="psp-kpi-v">{k.value}</div>
              <div className="psp-kpi-s">{k.sub}</div>
            </div>
          ))}
        </div>

        {discountKindsTotal.length > 0 && (
          <p className="psp-dsum">
            Discount by type —{' '}
            {discountKindsTotal.map((k, i) => (
              <React.Fragment key={k.key}>
                {i > 0 ? ' · ' : ''}
                {k.long}: <b>−{money(k.amount)}</b>
              </React.Fragment>
            ))}
          </p>
        )}

        <table>
          <thead>
            <tr>
              <th>#</th>
              <th>Product</th>
              <th>Category</th>
              <th>Brand</th>
              <th>Branch</th>
              <th className="psp-r">Qty</th>
              <th className="psp-r">Orders</th>
              <th className="psp-r">Gross</th>
              <th className="psp-r">Discount</th>
              <th className="psp-r">Net</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <React.Fragment key={r.menu_item_id}>
                <tr>
                  <td>{i + 1}</td>
                  <td className="psp-name">{r.name}</td>
                  <td>{r.category_name ?? '—'}</td>
                  <td>{r.brand_name ?? '—'}</td>
                  <td>{branchLabel(r)}</td>
                  <td className="psp-r">{r.quantity}</td>
                  <td className="psp-r">{r.orders}</td>
                  <td className="psp-r">{money(r.gross_sales)}</td>
                  <td className="psp-r">
                    {r.discount > 0 ? `−${money(r.discount)}` : '—'}
                    {r.discount > 0 && (
                      <span className="psp-dk">
                        {kindsOf(r.discount_breakdown)
                          .map((k) => k.short)
                          .join(' · ')}
                      </span>
                    )}
                  </td>
                  <td className="psp-r">{money(r.net_sales)}</td>
                </tr>
                {splitBy !== 'none' &&
                  expanded.has(r.menu_item_id) &&
                  r.children.map((c) => (
                    <tr className="psp-child" key={`${r.menu_item_id}-${c.id ?? 'none'}`}>
                      <td />
                      <td className="psp-cname">{c.name}</td>
                      <td />
                      <td />
                      <td />
                      <td className="psp-r">{c.quantity}</td>
                      <td className="psp-r">{c.orders}</td>
                      <td className="psp-r">{money(c.gross_sales)}</td>
                      <td className="psp-r">
                        {c.discount > 0 ? `−${money(c.discount)}` : '—'}
                        {c.discount > 0 && (
                          <span className="psp-dk">
                            {kindsOf(c.discount_breakdown)
                              .map((k) => k.short)
                              .join(' · ')}
                          </span>
                        )}
                      </td>
                      <td className="psp-r">{money(c.net_sales)}</td>
                    </tr>
                  ))}
              </React.Fragment>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td />
              <td>Totals</td>
              <td />
              <td />
              <td />
              <td className="psp-r">{totals.quantity}</td>
              <td className="psp-r">{totals.orders}</td>
              <td className="psp-r">{money(totals.gross_sales)}</td>
              <td className="psp-r">
                {totals.discount > 0 ? `−${money(totals.discount)}` : '—'}
              </td>
              <td className="psp-r">{money(totals.net_sales)}</td>
            </tr>
          </tfoot>
        </table>

        <p className="psp-foot">
          Gross is the sum of the sold lines, addons and modifier surcharges included. Discounts are
          recorded per order, so each product carries the share of its order&apos;s discount matching
          its share of that order&apos;s subtotal.
        </p>
      </div>
    </>
  );

  return (
    <>
    <div className="mx-auto max-w-[1400px] px-9 pb-20 pt-8 text-[#1F2430]">
      {/* Header */}
      <div className="mb-[22px] flex flex-wrap items-start justify-between gap-5">
        <div>
          <div className="mb-[5px] text-xs font-semibold text-[#9AA1AD]">Reports</div>
          <h1 className="mb-1.5 text-[27px] font-extrabold tracking-[-0.02em]">
            Product-wise Sales
          </h1>
          <p className="text-[13.5px] text-[#8A92A0]">
            {rangeText} · {scopeText}
          </p>
        </div>
        <div className="flex flex-none items-center gap-2.5">
          <button
            type="button"
            onClick={exportCsv}
            disabled={rows.length === 0}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-[11px] border-[1.5px] border-[#E2E5EA] bg-white px-[17px] py-[11px] text-[13.5px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 2v8M5 7l3 3 3-3" />
              <path d="M2.5 12v1.5h11V12" />
            </svg>
            Export CSV
          </button>
          <button
            type="button"
            onClick={() => setPrinting(true)}
            className="inline-flex items-center gap-2 whitespace-nowrap rounded-[11px] bg-[#DC2A2A] px-[17px] py-[11px] text-[13.5px] font-bold text-white shadow-[0_4px_12px_rgba(220,42,42,0.24)] transition hover:bg-[#C21F1F]"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="2.5" width="10" height="11" rx="1.5" />
              <path d="M5.5 6h5M5.5 9h3" />
            </svg>
            Print report
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="mb-[18px] rounded-2xl border border-[#ECEDF0] bg-white px-4 py-3.5 shadow-[0_6px_18px_rgba(15,23,42,0.04)]">
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex min-w-[180px] flex-1 items-center gap-2.5 rounded-[10px] border-[1.5px] border-[#EEEFF2] bg-[#F6F7F9] px-3">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#9AA1AD" strokeWidth="1.7" strokeLinecap="round">
              <circle cx="7" cy="7" r="4.5" />
              <line x1="10.5" y1="10.5" x2="14" y2="14" />
            </svg>
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                resetPage();
              }}
              placeholder="Search product, category or brand…"
              className="w-full flex-1 border-none bg-transparent py-2.5 text-[13.5px] text-[#1F2430] outline-none placeholder:text-[#A9AFB9]"
            />
          </div>
          <SearchableSelect
            ariaLabel="Branch"
            searchPlaceholder="Search branches…"
            triggerClassName={selectTrigger}
            minWidth="min-w-[142px]"
            className="flex-none"
            value={selectedBranch ? String(selectedBranch) : ''}
            onChange={(v) => {
              setSelectedBranch(v ? +v : null);
              resetPage();
            }}
            options={[
              { value: '', label: 'All Branches' },
              ...(branches ?? []).map((b) => ({ value: String(b.id), label: b.name })),
            ]}
          />
          <SearchableSelect
            ariaLabel="Brand"
            searchPlaceholder="Search brands…"
            triggerClassName={selectTrigger}
            minWidth="min-w-[136px]"
            className="flex-none"
            value={selectedBrand ? String(selectedBrand) : ''}
            onChange={(v) => {
              setSelectedBrand(v ? +v : null);
              setCategoryId(null);
              resetPage();
            }}
            options={[
              { value: '', label: 'All Brands' },
              ...(brands ?? []).map((b) => ({ value: String(b.id), label: b.name })),
            ]}
          />
          <SearchableSelect
            ariaLabel="Category"
            searchPlaceholder="Search categories…"
            triggerClassName={selectTrigger}
            minWidth="min-w-[152px]"
            className="flex-none"
            value={categoryId ? String(categoryId) : ''}
            onChange={(v) => {
              setCategoryId(v ? +v : null);
              resetPage();
            }}
            options={[
              { value: '', label: 'All Categories' },
              ...(categories ?? []).map((c) => ({ value: String(c.id), label: c.name })),
            ]}
          />
          <SearchableSelect
            ariaLabel="Orders"
            searchPlaceholder="Search…"
            triggerClassName={selectTrigger}
            minWidth="min-w-[146px]"
            className="flex-none"
            value={status}
            onChange={(v) => {
              setStatus(v || 'completed');
              resetPage();
            }}
            options={STATUS_OPTIONS}
          />
          {/* Date range and Clear travel together so Clear never drops to a line
              of its own when the bar wraps. */}
          <div className="flex flex-none items-center gap-2">
            <div className="flex items-center gap-1.5 rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-2.5 py-[7px]">
              <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#9AA1AD" strokeWidth="1.6" className="flex-none">
                <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" />
                <line x1="2.5" y1="6.5" x2="13.5" y2="6.5" />
                <line x1="5.5" y1="2" x2="5.5" y2="5" />
                <line x1="10.5" y1="2" x2="10.5" y2="5" />
              </svg>
              <input
                type="date"
                aria-label="From date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  resetPage();
                }}
                className="border-none bg-transparent text-[12.5px] font-semibold text-[#374151] outline-none"
              />
              <span className="text-[#C0C5CD]">–</span>
              <input
                type="date"
                aria-label="To date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  resetPage();
                }}
                className="border-none bg-transparent text-[12.5px] font-semibold text-[#374151] outline-none"
              />
            </div>
            <button
              type="button"
              onClick={clearFilters}
              className="whitespace-nowrap rounded-[10px] bg-[#FCEEEE] px-3.5 py-2.5 text-[12.5px] font-bold text-[#DC2A2A] transition hover:bg-[#F8DADA]"
            >
              Clear
            </button>
          </div>
        </div>

        <div className="mt-[13px] flex flex-wrap items-center gap-2.5 border-t border-[#F3F4F6] pt-[13px]">
          <span className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9AA1AD]">
            Break down by
          </span>
          <div className="flex gap-[7px]">
            {SPLIT_OPTIONS.map((s) => {
              const on = splitBy === s.value;
              return (
                <button
                  key={s.value}
                  type="button"
                  onClick={() => {
                    setSplitBy(s.value);
                    setExpanded(new Set());
                    setAllOpen(false);
                  }}
                  aria-pressed={on}
                  className={
                    on
                      ? 'whitespace-nowrap rounded-full border-[1.5px] border-[#DC2A2A] bg-[#DC2A2A] px-3.5 py-2 text-[12.5px] font-bold text-white'
                      : 'whitespace-nowrap rounded-full border-[1.5px] border-[#E2E5EA] bg-white px-3.5 py-2 text-[12.5px] font-semibold text-[#5A6473] transition hover:bg-[#F6F7F9]'
                  }
                >
                  {s.label}
                </button>
              );
            })}
          </div>
          <span className="flex-1" />
          <button
            type="button"
            onClick={toggleAll}
            disabled={splitBy === 'none'}
            className="whitespace-nowrap rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-3.5 py-2 text-[12.5px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-50"
          >
            {allOpen ? 'Collapse all' : 'Expand all'}
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="mb-[18px] grid grid-cols-2 gap-3.5 lg:grid-cols-4">
        {kpis.map((k) => (
          <div
            key={k.label}
            style={{ borderLeftColor: k.accent }}
            className="rounded-[14px] border border-[#ECEDF0] border-l-[3px] bg-white px-[18px] py-4 shadow-[0_6px_18px_rgba(15,23,42,0.04)]"
          >
            <div className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-[#9AA1AD]">
              {k.label}
            </div>
            <div
              style={{ color: k.valueColor }}
              className="mt-[7px] text-[23px] font-black tracking-[-0.01em] tabular-nums"
            >
              {k.value}
            </div>
            <div className="mt-1 text-xs text-[#8A92A0]">{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Discount by type — the headline "Discount" tile only says how much;
          this says which of the system's discount kinds it came out of. */}
      {discountKindsTotal.length > 0 && (
        <div className="mb-[18px] flex flex-wrap items-center gap-2.5 rounded-[14px] border border-[#F2E4CC] bg-[#FFFBF3] px-[18px] py-3.5">
          <span className="text-[11.5px] font-bold uppercase tracking-[0.06em] text-[#B45309]">
            Discount by type
          </span>
          {discountKindsTotal.map((k) => (
            <span
              key={k.key}
              className="inline-flex items-baseline gap-1.5 rounded-full border border-[#F0DDBE] bg-white px-3 py-1"
            >
              <span className="text-[12px] font-semibold text-[#6B7280]">{k.long}</span>
              <span className="text-[13px] font-extrabold tabular-nums text-[#B45309]">
                −{money(k.amount)}
              </span>
            </span>
          ))}
        </div>
      )}

      {/* Table */}
      <div className="overflow-hidden rounded-2xl border border-[#ECEDF0] bg-white shadow-[0_10px_30px_rgba(15,23,42,0.05)]">
        <div className="flex items-center justify-between gap-3 border-b border-[#F1F2F5] px-5 py-3.5">
          <div className="flex items-baseline gap-2.5">
            <span className="text-[15px] font-bold">Products</span>
            <span className="text-[12.5px] text-[#8A92A0]">
              {rows.length} {rows.length === 1 ? 'product' : 'products'}
            </span>
          </div>
          <span className="text-xs text-[#9AA1AD]">
            Gross includes addons and modifiers · discount is each line&apos;s share of its
            order&apos;s discount
          </span>
        </div>

        <div className="overflow-x-auto">
          <div className="min-w-[1206px]">
            <div
              style={{ gridTemplateColumns: GRID }}
              className="grid gap-3 border-b border-[#F1F2F5] bg-[#FBFBFC] px-5 py-[11px]"
            >
              <span className={headCell}>#</span>
              <button type="button" onClick={() => toggleSort('name')} className={`${headCell} text-left`}>
                Product{sortArrow('name')}
              </button>
              <span className={headCell}>Category</span>
              <span className={headCell}>Brand</span>
              <span className={headCell}>Branch</span>
              <button type="button" onClick={() => toggleSort('quantity')} className={`${headCell} text-right`}>
                Qty{sortArrow('quantity')}
              </button>
              <button type="button" onClick={() => toggleSort('orders')} className={`${headCell} text-right`}>
                Orders{sortArrow('orders')}
              </button>
              <button type="button" onClick={() => toggleSort('gross_sales')} className={`${headCell} text-right`}>
                Gross{sortArrow('gross_sales')}
              </button>
              <span className={`${headCell} text-right`}>Discount</span>
              <button type="button" onClick={() => toggleSort('net_sales')} className={`${headCell} text-right`}>
                Net{sortArrow('net_sales')}
              </button>
            </div>

            {isLoading ? (
              <div className="px-12 py-12 text-center text-sm text-[#9AA1AD]">
                Loading product sales…
              </div>
            ) : isError ? (
              <div className="px-12 py-12 text-center text-sm text-[#DC2A2A]">
                Could not load product sales.
              </div>
            ) : rows.length === 0 ? (
              <div className="px-12 py-12 text-center text-sm text-[#9AA1AD]">
                No products match these filters.
              </div>
            ) : (
              pageRows.map((r, i) => {
                const isOpen = splitBy !== 'none' && expanded.has(r.menu_item_id);
                const expandable = splitBy !== 'none' && r.children.length > 0;
                return (
                  <div key={r.menu_item_id}>
                    <div
                      onClick={expandable ? () => toggleRow(r.menu_item_id) : undefined}
                      style={{ gridTemplateColumns: GRID }}
                      className={`grid items-center gap-3 border-b border-[#F4F5F7] px-5 py-[13px] ${
                        isOpen ? 'bg-[#FFFCFB]' : 'bg-white'
                      } ${expandable ? 'cursor-pointer' : ''}`}
                    >
                      <span className="text-xs font-extrabold tabular-nums text-[#B6BCC6]">
                        {pageStart + i + 1}
                      </span>
                      <div className="flex min-w-0 items-center gap-2">
                        {expandable ? (
                          <button
                            type="button"
                            aria-expanded={isOpen}
                            aria-label={`Toggle ${r.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleRow(r.menu_item_id);
                            }}
                            className="flex h-5 w-5 flex-none items-center justify-center rounded-md bg-[#F3F4F6] text-[#8A92A0]"
                          >
                            <svg
                              width="11"
                              height="11"
                              viewBox="0 0 12 12"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="2"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(-90deg)' }}
                              className="transition-transform"
                            >
                              <path d="M3 4.5l3 3 3-3" />
                            </svg>
                          </button>
                        ) : (
                          <span className="w-5 flex-none" />
                        )}
                        <span className="truncate text-sm font-bold text-[#20242C]">{r.name}</span>
                        {r.discount > 0 && (
                          <span
                            title={kindsOf(r.discount_breakdown)
                              .map((k) => `${k.long}: −${money(k.amount)}`)
                              .join('\n')}
                            className="flex-none rounded-md bg-[#FFF6E6] px-[7px] py-0.5 text-[10px] font-extrabold text-[#B45309]"
                          >
                            {kindsOf(r.discount_breakdown)[0]?.short ?? 'Discounted'}
                            {kindsOf(r.discount_breakdown).length > 1
                              ? ` +${kindsOf(r.discount_breakdown).length - 1}`
                              : ''}
                          </span>
                        )}
                      </div>
                      <span className="truncate text-[12.5px] text-[#6B7280]">
                        {r.category_name ?? '—'}
                      </span>
                      <span className="truncate text-[12.5px] text-[#6B7280]">
                        {r.brand_name ?? '—'}
                      </span>
                      <span className="truncate text-[12.5px] text-[#6B7280]">{branchLabel(r)}</span>
                      <span className="text-right text-[13.5px] font-bold tabular-nums">
                        {r.quantity}
                      </span>
                      <span className="text-right text-[13.5px] tabular-nums text-[#5A6473]">
                        {r.orders}
                      </span>
                      <span className="text-right text-[13.5px] tabular-nums text-[#374151]">
                        {money(r.gross_sales)}
                      </span>
                      <span className="min-w-0 text-right">
                        <span
                          className={`block text-[13.5px] tabular-nums ${
                            r.discount > 0 ? 'font-bold text-[#B45309]' : 'text-[#C0C5CD]'
                          }`}
                        >
                          {r.discount > 0 ? `−${money(r.discount)}` : '—'}
                        </span>
                        {r.discount > 0 && (
                          <span
                            title={kindsOf(r.discount_breakdown)
                              .map((k) => `${k.long}: −${money(k.amount)}`)
                              .join('\n')}
                            className="block truncate text-[10.5px] font-semibold uppercase tracking-[0.04em] text-[#B99A63]"
                          >
                            {kindsOf(r.discount_breakdown)
                              .map((k) => k.short)
                              .join(' · ')}
                          </span>
                        )}
                      </span>
                      <span className="text-right text-[14.5px] font-extrabold tabular-nums text-[#20242C]">
                        {money(r.net_sales)}
                      </span>
                    </div>

                    {isOpen &&
                      r.children.map((c) => (
                        <div
                          key={`${r.menu_item_id}-${c.id ?? 'none'}`}
                          style={{ gridTemplateColumns: GRID }}
                          className="grid items-center gap-3 border-t border-[#F1F2F5] bg-[#FBFBFC] px-5 py-2.5"
                        >
                          <span />
                          <div className="flex min-w-0 items-center gap-2.5 pl-7">
                            <span className="h-[5px] w-[5px] flex-none rounded-full bg-[#C7CCD6]" />
                            <span className="truncate text-[13px] font-semibold text-[#5A6473]">
                              {c.name}
                            </span>
                          </div>
                          <span />
                          <span />
                          <span />
                          <span className="text-right text-[12.5px] tabular-nums text-[#5A6473]">
                            {c.quantity}
                          </span>
                          <span className="text-right text-[12.5px] tabular-nums text-[#8A92A0]">
                            {c.orders}
                          </span>
                          <span className="text-right text-[12.5px] tabular-nums text-[#5A6473]">
                            {money(c.gross_sales)}
                          </span>
                          <span className="min-w-0 text-right">
                            <span
                              className={`block text-[12.5px] tabular-nums ${
                                c.discount > 0 ? 'text-[#B45309]' : 'text-[#C0C5CD]'
                              }`}
                            >
                              {c.discount > 0 ? `−${money(c.discount)}` : '—'}
                            </span>
                            {c.discount > 0 && (
                              <span
                                title={kindsOf(c.discount_breakdown)
                                  .map((k) => `${k.long}: −${money(k.amount)}`)
                                  .join('\n')}
                                className="block truncate text-[10px] font-semibold uppercase tracking-[0.04em] text-[#C2A672]"
                              >
                                {kindsOf(c.discount_breakdown)
                                  .map((k) => k.short)
                                  .join(' · ')}
                              </span>
                            )}
                          </span>
                          <span className="text-right text-[13px] font-bold tabular-nums text-[#374151]">
                            {money(c.net_sales)}
                          </span>
                        </div>
                      ))}
                  </div>
                );
              })
            )}

            <div
              style={{ gridTemplateColumns: GRID }}
              className="grid items-center gap-3 border-t border-[#EFF0F3] bg-[#FBFBFC] px-5 py-3.5"
            >
              <span />
              <span className="text-[13px] font-extrabold text-[#20242C]">Totals</span>
              <span />
              <span />
              <span />
              <span className="text-right text-[13.5px] font-extrabold tabular-nums">
                {totals.quantity}
              </span>
              <span className="text-right text-[13.5px] font-bold tabular-nums text-[#5A6473]">
                {totals.orders}
              </span>
              <span className="text-right text-[13.5px] font-bold tabular-nums text-[#374151]">
                {money(totals.gross_sales)}
              </span>
              <span className="text-right text-[13.5px] font-bold tabular-nums text-[#B45309]">
                {totals.discount > 0 ? `−${money(totals.discount)}` : '—'}
              </span>
              <span className="text-right text-base font-black tabular-nums text-[#16A34A]">
                {money(totals.net_sales)}
              </span>
            </div>
          </div>
        </div>

        {/* Pagination — the totals strip above covers the whole selection, not
            just this page, so the two are deliberately different scopes. */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[#EFF0F3] px-5 py-3">
          <div className="flex items-center gap-2.5">
            <label
              htmlFor="ps-page-size"
              className="text-[11px] font-bold uppercase tracking-[0.06em] text-[#9AA1AD]"
            >
              Rows per page
            </label>
            <select
              id="ps-page-size"
              value={pageSize}
              onChange={(e) => {
                setPageSize(+e.target.value);
                setPage(1);
              }}
              className="cursor-pointer rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-[#374151] outline-none focus:border-[#DC2A2A]"
            >
              {PAGE_SIZES.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? 'All' : n}
                </option>
              ))}
            </select>
          </div>

          <span className="text-[12.5px] tabular-nums text-[#8A92A0]">
            {rows.length === 0
              ? 'No products'
              : `Showing ${pageStart + 1}–${pageStart + pageRows.length} of ${rows.length}`}
          </span>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPage(1)}
              disabled={currentPage === 1}
              className="rounded-[9px] border-[1.5px] border-[#E2E5EA] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              «
            </button>
            <button
              type="button"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="rounded-[9px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Prev
            </button>
            <span className="px-1.5 text-[12.5px] font-semibold tabular-nums text-[#5A6473]">
              Page {currentPage} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
              disabled={currentPage >= pageCount}
              className="rounded-[9px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-1.5 text-[12.5px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
            <button
              type="button"
              onClick={() => setPage(pageCount)}
              disabled={currentPage >= pageCount}
              className="rounded-[9px] border-[1.5px] border-[#E2E5EA] bg-white px-2.5 py-1.5 text-[12.5px] font-semibold text-[#374151] transition hover:bg-[#F3F4F6] disabled:cursor-not-allowed disabled:opacity-40"
            >
              »
            </button>
          </div>
        </div>
      </div>
    </div>
    {printing && createPortal(printReport, document.body)}
    </>
  );
};

export default ProductSales;
