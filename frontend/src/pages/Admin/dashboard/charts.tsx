import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Area,
  Line,
  ComposedChart,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ReferenceLine,
} from 'recharts';
import { formatCurrency } from '../../../utils/currency';
import { useViewport } from '../../../hooks/useViewport';
import {
  CHART_COLORS,
  REVENUE_COLOR,
  STATUS_COLORS,
  brandColor,
  colorFor,
  tooltipStyle,
  axisColor,
  gridColor,
} from '../../../utils/chartColors';
import type { DashboardSummary, OrderSeriesResponse } from './types';

type Theme = 'light' | 'dark';

const compactCurrency = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const prettify = (s: string) => s.replace(/_/g, ' ');

/**
 * Measures its own width via ResizeObserver and hands it to the chart as an
 * explicit pixel value. Avoids recharts' ResponsiveContainer, which fails to
 * size ComposedChart/PieChart reliably in this layout.
 */
const Measured: React.FC<{
  height: number;
  children: (width: number, height: number) => React.ReactNode;
}> = ({ height, children }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} style={{ width: '100%', height }}>
      {width > 0 ? children(width, height) : null}
    </div>
  );
};

/** "MM-DD HH:mm" tick for per-order timestamps. */
const shortOrderTime = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Phones only: one trend point per day, week or month, picked from the selected range. */
export type TrendBucket = 'day' | 'week' | 'month';

const DAY_MS = 86_400_000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const parseLocalDate = (s?: string) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s ?? '');
  return m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : null;
};

/** Up to a month → days, up to six months → weeks, longer → months (at most ~31 points on a phone). */
export const pickTrendBucket = (dateFrom?: string, dateTo?: string): TrendBucket => {
  const from = parseLocalDate(dateFrom);
  const to = parseLocalDate(dateTo);
  if (!from || !to) return 'day';
  const days = Math.round((to.getTime() - from.getTime()) / DAY_MS) + 1;
  return days <= 31 ? 'day' : days <= 183 ? 'week' : 'month';
};

const bucketStart = (d: Date, b: TrendBucket) => {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  if (b === 'week') x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); // Monday
  if (b === 'month') x.setDate(1);
  return x;
};
const nextBucket = (d: Date, b: TrendBucket) => {
  const x = new Date(d);
  if (b === 'day') x.setDate(x.getDate() + 1);
  else if (b === 'week') x.setDate(x.getDate() + 7);
  else x.setMonth(x.getMonth() + 1);
  return x;
};
const bucketLabel = (d: Date, b: TrendBucket) => (b === 'month' ? MONTHS[d.getMonth()] : `${d.getDate()} ${MONTHS[d.getMonth()]}`);
const bucketTitle = (d: Date, b: TrendBucket) =>
  b === 'day'
    ? `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`
    : b === 'week'
      ? `Week of ${d.getDate()} ${MONTHS[d.getMonth()]}`
      : `${MONTHS_LONG[d.getMonth()]} ${d.getFullYear()}`;

export interface TrendPeriodRow {
  key: number;
  label: string;
  title: string;
  orders: number;
  completed: number;
  [seriesKey: string]: number | string;
}

/**
 * Completed revenue per period and brand, with every period of the range present (zero when
 * nothing completed), so gaps read as gaps. When the order list was capped, the axis starts at
 * the oldest order that came back instead of the start of the range.
 */
export const bucketTrend = (
  orders: OrderSeriesResponse['orders'],
  bucket: TrendBucket,
  seriesKeys: string[],
  opts: { from?: string; to?: string; truncated?: boolean } = {},
): TrendPeriodRow[] => {
  if (orders.length === 0) return [];
  const times = orders.map((o) => new Date(o.placed_at).getTime()).filter((t) => !Number.isNaN(t));
  if (times.length === 0) return [];
  const oldest = new Date(Math.min(...times));
  const newest = new Date(Math.max(...times));
  const rangeFrom = parseLocalDate(opts.from);
  const rangeTo = parseLocalDate(opts.to);
  let start = bucketStart(opts.truncated || !rangeFrom ? oldest : rangeFrom, bucket);
  let end = bucketStart(rangeTo ?? newest, bucket);
  if (end < start) { start = bucketStart(oldest, bucket); end = bucketStart(newest, bucket); }
  const rows: TrendPeriodRow[] = [];
  const byKey = new Map<number, TrendPeriodRow>();
  for (let d = start, guard = 0; d <= end && guard < 400; d = nextBucket(d, bucket), guard++) {
    const row: TrendPeriodRow = { key: d.getTime(), label: bucketLabel(d, bucket), title: bucketTitle(d, bucket), orders: 0, completed: 0 };
    for (const k of seriesKeys) {
      row[k] = 0;
      row[`${k}__orders`] = 0;
      row[`${k}__completed`] = 0;
    }
    rows.push(row);
    byKey.set(row.key, row);
  }
  for (const o of orders) {
    const t = new Date(o.placed_at);
    if (Number.isNaN(t.getTime())) continue;
    const row = byKey.get(bucketStart(t, bucket).getTime());
    if (!row) continue;
    const k = `brand_${o.brand_id ?? 'none'}`;
    row.orders += 1;
    row[`${k}__orders`] = Number(row[`${k}__orders`] ?? 0) + 1;
    if (o.status === 'completed') {
      row[k] = Number(row[k] ?? 0) + Number(o.total_amount);
      row[`${k}__completed`] = Number(row[`${k}__completed`] ?? 0) + 1;
      row.completed += 1;
    }
  }
  return rows;
};

type TrendMetric = 'revenue' | 'orders';
type TrendSeries = { key: string; name: string; color: string };

/** Axis ticks on a phone: 950 · 1.2k · 14k · 1.3M. */
const phoneCompact = (n: number) =>
  n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 10_000 ? `${Math.round(n / 1000)}k` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(Math.round(n));

/**
 * One stacked segment: a 2px surface gap where it touches a neighbour (the card shows through,
 * no stroke) and a 4px rounded top when it is the top of its stack.
 */
const stackSegment = (renderedKeys: string[]) => {
  const Segment = (props: { x?: number; y?: number; width?: number; height?: number; fill?: string; payload?: Record<string, unknown>; dataKey?: string }) => {
    const { x = 0, y = 0, width = 0, height = 0, fill, payload = {}, dataKey = '' } = props;
    if (!(height > 0) || !(width > 0)) return null;
    const i = renderedKeys.indexOf(dataKey);
    const above = renderedKeys.slice(i + 1).some((k) => Number(payload[k]) > 0);
    const below = renderedKeys.slice(0, Math.max(0, i)).some((k) => Number(payload[k]) > 0);
    const top = y + (above ? 1 : 0);
    const bottom = y + height - (below ? 1 : 0);
    const h = bottom - top;
    if (h <= 0) return null;
    const r = above ? 0 : Math.min(4, width / 2, h);
    const d =
      r > 0
        ? `M${x},${bottom} L${x},${top + r} Q${x},${top} ${x + r},${top} L${x + width - r},${top} Q${x + width},${top} ${x + width},${top + r} L${x + width},${bottom} Z`
        : `M${x},${top} h${width} v${h} h${-width} Z`;
    return <path d={d} fill={fill} />;
  };
  return Segment;
};

/**
 * Phones: the trend as one stacked column per day / week / month (picked from the range),
 * split by brand — revenue (completed) or order count, never both on one axis. Tapping a
 * column fills the panel under the chart with that period's figures; the panel's rows are
 * also the legend, and tapping a brand shows only its columns so its own trend isn't
 * flattened by a bigger brand's spike.
 */
const PhoneTrend: React.FC<{
  data: OrderSeriesResponse['orders'];
  theme: Theme;
  series: TrendSeries[];
  rangeFrom?: string;
  rangeTo?: string;
  totalOrders?: number;
}> = ({ data, theme, series, rangeFrom, rangeTo, totalOrders }) => {
  const [metric, setMetric] = useState<TrendMetric>('revenue');
  const [focus, setFocus] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<number | null>(null);

  const truncated = totalOrders != null && totalOrders > data.length;
  const bucket = pickTrendBucket(rangeFrom, rangeTo);
  const seriesKeys = series.map((s) => s.key).join('|');
  const rows = useMemo(
    () => bucketTrend(data, bucket, seriesKeys.split('|'), { from: rangeFrom, to: rangeTo, truncated }),
    [data, bucket, seriesKeys, rangeFrom, rangeTo, truncated],
  );

  // A focus can't outlive its brand (filter or range change).
  const focusShown = focus != null && series.some((s) => s.key === focus);
  useEffect(() => {
    if (focus != null && !focusShown) setFocus(null);
  }, [focus, focusShown]);

  const suffix = metric === 'orders' ? '__orders' : '';
  const shown = focusShown ? series.filter((s) => s.key === focus) : series;
  const renderedKeys = shown.map((s) => s.key + suffix);
  const Segment = useMemo(() => stackSegment(renderedKeys), [renderedKeys.join('|')]); // eslint-disable-line react-hooks/exhaustive-deps

  // Default selection: the latest period with something to show for this measure (revenue
  // needs a completed order), so the panel never opens on a row of zeros.
  const hasValue = (r: TrendPeriodRow) => shown.some((s) => Number(r[s.key + suffix] ?? 0) > 0);
  const fallback = [...rows].reverse().find(hasValue) ?? rows[rows.length - 1];
  const selected = rows.find((r) => r.key === selectedKey) ?? fallback;
  const valueOf = (row: TrendPeriodRow | undefined, key: string) => Number(row?.[key + suffix] ?? 0);
  const fmt = (n: number) => (metric === 'revenue' ? formatCurrency(n) : `${n} ${n === 1 ? 'order' : 'orders'}`);
  const total = shown.reduce((sum, s) => sum + valueOf(selected, s.key), 0);
  const ordersIn = focusShown ? Number(selected?.[`${focus}__orders`] ?? 0) : selected?.orders ?? 0;
  const completedIn = focusShown ? Number(selected?.[`${focus}__completed`] ?? 0) : selected?.completed ?? 0;
  const unit = bucket === 'day' ? 'day' : bucket === 'week' ? 'week' : 'month';

  return (
    <div>
      <div className="mb-3 inline-flex rounded-lg bg-gray-100 p-0.5 dark:bg-slate-700/60" role="group" aria-label="Trend measure">
        {(['revenue', 'orders'] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMetric(m)}
            aria-pressed={metric === m}
            className={`min-h-[40px] rounded-md px-4 text-[13px] font-semibold transition-colors ${
              metric === m ? 'bg-white text-gray-900 shadow-sm dark:bg-slate-800 dark:text-slate-50' : 'text-gray-500 dark:text-slate-400'
            }`}
          >
            {m === 'revenue' ? 'Revenue' : 'Orders'}
          </button>
        ))}
      </div>

      <Measured height={210}>
        {(w, h) => (
          <BarChart
            width={w}
            height={h}
            data={rows}
            margin={{ top: 6, right: 4, left: -8, bottom: 0 }}
            barCategoryGap="22%"
            onClick={(state) => {
              const idx = state?.activeTooltipIndex;
              if (idx != null && rows[idx]) setSelectedKey(rows[idx].key);
            }}
          >
            <CartesianGrid stroke={gridColor(theme)} vertical={false} />
            <XAxis
              dataKey="key"
              tickFormatter={(k) => rows.find((r) => r.key === k)?.label ?? ''}
              tick={{ fontSize: 10, fill: axisColor(theme) }}
              stroke={gridColor(theme)}
              tickLine={false}
              interval="preserveStartEnd"
              minTickGap={12}
              tickMargin={6}
            />
            <YAxis
              tick={{ fontSize: 10, fill: axisColor(theme) }}
              stroke={gridColor(theme)}
              tickLine={false}
              axisLine={false}
              tickFormatter={phoneCompact}
              width={38}
              allowDecimals={false}
            />
            {selected && <ReferenceLine x={selected.key} stroke={axisColor(theme)} strokeOpacity={0.55} />}
            <Tooltip content={() => null} cursor={{ fill: gridColor(theme), fillOpacity: 0.6 }} />
            {shown.map((s) => (
              <Bar key={s.key} dataKey={s.key + suffix} name={s.name} stackId="trend" fill={s.color} maxBarSize={24} shape={<Segment />} isAnimationActive={false} />
            ))}
          </BarChart>
        )}
      </Measured>

      {/* The selected period's figures. Its rows are the legend and the brand focus control. */}
      {selected && (
        <div className="mt-3 rounded-xl border border-gray-100 bg-gray-50/70 px-3 py-2.5 dark:border-slate-700 dark:bg-slate-900/40">
          <div className="flex items-baseline justify-between gap-3">
            <div className="min-w-0 truncate text-[13px] font-bold text-gray-800 dark:text-slate-100">{selected.title}</div>
            <div className="flex-none text-[15px] font-extrabold text-gray-900 dark:text-slate-50">{fmt(total)}</div>
          </div>
          <div className="text-[11.5px] text-gray-500 dark:text-slate-400">
            {ordersIn} {ordersIn === 1 ? 'order' : 'orders'} · {completedIn} completed
            {focusShown ? ` · ${series.find((s) => s.key === focus)?.name ?? ''}` : ''}
          </div>
          <ul className="mt-1.5">
            {series.map((s) => {
              const on = focus === s.key;
              const dim = focusShown && !on;
              return (
                <li key={s.key}>
                  <button
                    type="button"
                    onClick={() => setFocus((f) => (f === s.key ? null : s.key))}
                    aria-pressed={on}
                    className={`flex min-h-[40px] w-full items-center justify-between gap-3 text-left transition-opacity ${dim ? 'opacity-40' : ''}`}
                  >
                    <span className="flex min-w-0 items-center gap-2">
                      <span className="h-2.5 w-2.5 flex-none rounded-[3px]" style={{ background: s.color }} />
                      <span className={`truncate text-[13px] ${on ? 'font-bold text-gray-900 dark:text-slate-50' : 'font-semibold text-gray-600 dark:text-slate-300'}`}>
                        {s.name}
                      </span>
                    </span>
                    <span className="flex-none text-[13px] font-semibold tabular-nums text-gray-800 dark:text-slate-100">
                      {fmt(valueOf(selected, s.key))}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
          <div className="mt-1 flex items-center justify-between gap-3 text-[11.5px] text-gray-400 dark:text-slate-500">
            <span>Tap a column for its {unit}{series.length > 1 ? ', a brand to show only its columns' : ''}.</span>
            {focusShown && (
              <button type="button" onClick={() => setFocus(null)} className="min-h-[32px] flex-none font-semibold text-red-600 dark:text-red-400">
                Show all
              </button>
            )}
          </div>
        </div>
      )}
      {truncated && (
        <p className="mt-2 text-[11.5px] text-gray-400 dark:text-slate-500">
          Built from the latest {data.length.toLocaleString('en-US')} of {totalOrders?.toLocaleString('en-US')} orders.
        </p>
      )}
    </div>
  );
};

/**
 * Order-wise trend: every order in the range is its own point (amount), in
 * time sequence. When the range mixes brands, each brand becomes its own line
 * (an order belongs to exactly one brand); a single-brand range keeps the
 * classic filled area, in that brand's own colour. Clicking a line or a legend
 * entry focuses that brand and fades the rest; clicking again releases it. The
 * tooltip names the exact order; dots make single orders visible even when the
 * range is quiet.
 */
export const OrderSeriesChart: React.FC<{
  data: OrderSeriesResponse['orders'];
  theme: Theme;
  /** Tenant brand list — each brand's line color is keyed to its position here, so hues stay stable across filters. */
  brands?: Array<{ id: number; name: string }>;
  /** Selected range (YYYY-MM-DD). Phones use it to lay out one point per day / week / month. */
  rangeFrom?: string;
  rangeTo?: string;
  /** Orders in the range (uncapped). When it exceeds `data.length` the list was capped. */
  totalOrders?: number;
}> = ({ data, theme, brands, rangeFrom, rangeTo, totalOrders }) => {
  const [focused, setFocused] = useState<string | null>(null);
  // Phones: hundreds of per-order points on a ~300px chart can't be read, so phones plot
  // completed revenue per period instead. Tablets and desktop keep the per-order chart.
  const { isPhone } = useViewport();
  const brandIds = Array.from(new Set(data.map((d) => d.brand_id)));
  const multiBrand = brandIds.length > 1;
  // Per-series value keys: each row carries its amount under its own brand's
  // key, so recharts draws one connectNulls line per brand.
  const rows = multiBrand
    ? data.map((d) => ({ ...d, [`brand_${d.brand_id ?? 'none'}`]: d.total_amount }))
    : data;
  const series = brandIds
    .map((id, i) => ({
      key: `brand_${id ?? 'none'}`,
      name:
        id == null
          ? 'No brand'
          : (brands ?? []).find((b) => b.id === id)?.name ??
            data.find((d) => d.brand_id === id)?.brand_name ??
            `Brand ${id}`,
      color: brandColor(id, brands, i),
      sort: id == null ? Number.MAX_SAFE_INTEGER : (brands ?? []).findIndex((b) => b.id === id),
    }))
    .map((s) => ({ ...s, sort: s.sort >= 0 ? s.sort : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => a.sort - b.sort);

  // A focus can't survive its brand leaving the data (filter or range change).
  const focusedStillShown = focused != null && series.some((s) => s.key === focused);
  const focus = focusedStillShown ? focused : null;
  useEffect(() => {
    if (focused != null && !focusedStillShown) setFocused(null);
  }, [focused, focusedStillShown]);

  const toggle = (key: string) => setFocused((f) => (f === key ? null : key));
  const dimmed = (key: string) => focus != null && focus !== key;
  // The solo line wears its brand's colour, so filtering to one brand keeps the
  // hue it had among all brands.
  const soloColor = series[0]?.color ?? REVENUE_COLOR;
  const gradientId = `revGradient-${soloColor.replace('#', '')}`;

  if (isPhone) {
    return (
      <PhoneTrend
        data={data}
        theme={theme}
        series={series.map(({ key, name, color }) => ({ key, name, color }))}
        rangeFrom={rangeFrom}
        rangeTo={rangeTo}
        totalOrders={totalOrders}
      />
    );
  }

  return (
    <div>
      <Measured height={280}>
        {(w, h) => (
          <ComposedChart width={w} height={h} data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor={soloColor} stopOpacity={0.35} />
                <stop offset="95%" stopColor={soloColor} stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke={gridColor(theme)} vertical={false} />
            <XAxis
              dataKey="placed_at"
              tickFormatter={shortOrderTime}
              tick={{ fontSize: 11, fill: axisColor(theme) }}
              stroke={axisColor(theme)}
              minTickGap={32}
            />
            <YAxis
              tick={{ fontSize: 11, fill: axisColor(theme) }}
              stroke={axisColor(theme)}
              tickFormatter={compactCurrency}
              width={48}
            />
            <Tooltip
              contentStyle={tooltipStyle(theme)}
              formatter={(value) => formatCurrency(Number(value))}
              labelFormatter={(label, payload) => {
                const row = payload?.[0]?.payload as
                  | OrderSeriesResponse['orders'][number]
                  | undefined;
                const when = shortOrderTime(String(label));
                if (!row) return when;
                return `#${row.order_number} · ${when} · ${prettify(row.order_type)} · ${row.status}`;
              }}
            />
            {multiBrand ? (
              series.map((s) => {
                const dim = dimmed(s.key);
                const lead = focus === s.key;
                return (
                  <Line
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    name={s.name}
                    stroke={s.color}
                    strokeWidth={lead ? 3 : 2}
                    strokeOpacity={dim ? 0.15 : 1}
                    connectNulls
                    dot={{
                      r: lead ? 2.5 : 2,
                      stroke: s.color,
                      fill: s.color,
                      strokeOpacity: dim ? 0.15 : 1,
                      fillOpacity: dim ? 0.15 : 1,
                    }}
                    activeDot={{ onClick: () => toggle(s.key), r: 4 }}
                    onClick={() => toggle(s.key)}
                    style={{ cursor: 'pointer' }}
                  />
                );
              })
            ) : (
              <Area
                type="monotone"
                dataKey="total_amount"
                name={series[0]?.name ?? 'Order amount'}
                stroke={soloColor}
                strokeWidth={2}
                fill={`url(#${gradientId})`}
                dot={{ r: 2, stroke: soloColor, fill: soloColor }}
              />
            )}
          </ComposedChart>
        )}
      </Measured>
      {/* Legend doubles as the focus control — the line itself is a thin target. */}
      <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5">
        {series.map((s) =>
          multiBrand ? (
            <button
              key={s.key}
              type="button"
              onClick={() => toggle(s.key)}
              aria-pressed={focus === s.key}
              title={focus === s.key ? `Show all brands` : `Focus ${s.name}`}
              className={`inline-flex items-center gap-1.5 text-[12.5px] font-semibold transition-opacity ${
                dimmed(s.key) ? 'opacity-40' : ''
              }`}
            >
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
              <span className={focus === s.key ? 'text-gray-900 dark:text-slate-50' : 'text-gray-600 dark:text-slate-300'}>
                {s.name}
              </span>
            </button>
          ) : (
            <span key={s.key} className="inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-gray-600 dark:text-slate-300">
              <span className="h-2.5 w-2.5 rounded-[3px]" style={{ background: s.color }} />
              {s.name}
            </span>
          ),
        )}
        {focus != null && (
          <button
            type="button"
            onClick={() => setFocused(null)}
            className="text-[12px] font-semibold text-red-600 hover:underline dark:text-red-400"
          >
            Show all
          </button>
        )}
      </div>
    </div>
  );
};

const STATUS_ORDER = ['placed', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];

/** Horizontal bar of order counts by status (funnel-ordered). */
export const OrdersByStatusChart: React.FC<{
  data: DashboardSummary['orders_by_status'];
  theme: Theme;
}> = ({ data, theme }) => {
  // Phones: a narrower label gutter leaves the bars room on a ~320px chart.
  const { isPhone } = useViewport();
  const sorted = [...data].sort((a, b) => {
    const ai = STATUS_ORDER.indexOf(a.status);
    const bi = STATUS_ORDER.indexOf(b.status);
    if (ai !== -1 && bi !== -1) return ai - bi;
    if (ai !== -1) return -1;
    if (bi !== -1) return 1;
    return a.status.localeCompare(b.status);
  });
  return (
    <Measured height={240}>
      {(w, h) => (
        <BarChart width={w} height={h} data={sorted} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor(theme)} horizontal={false} />
          <XAxis
            type="number"
            allowDecimals={false}
            tick={{ fontSize: 11, fill: axisColor(theme) }}
            stroke={axisColor(theme)}
          />
          <YAxis
            type="category"
            dataKey="status"
            width={isPhone ? 64 : 84}
            tick={{ fontSize: 11, fill: axisColor(theme) }}
            stroke={axisColor(theme)}
          />
          <Tooltip contentStyle={tooltipStyle(theme)} cursor={{ fill: 'transparent' }} />
          <Bar dataKey="count" name="Orders" radius={[0, 4, 4, 0]}>
            {sorted.map((d, i) => (
              <Cell key={d.status} fill={STATUS_COLORS[d.status] ?? CHART_COLORS[i % CHART_COLORS.length]} />
            ))}
          </Bar>
        </BarChart>
      )}
    </Measured>
  );
};

interface DonutDatum {
  name: string;
  value: number;
}

const Donut: React.FC<{
  data: DonutDatum[];
  theme: Theme;
  currency?: boolean;
}> = ({ data, theme, currency = false }) => (
  <Measured height={240}>
    {(w, h) => (
      <PieChart width={w} height={h}>
        <Pie
          data={data}
          dataKey="value"
          nameKey="name"
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={90}
          paddingAngle={2}
        >
          {data.map((d, i) => (
            <Cell key={d.name} fill={colorFor(d.name, i)} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle(theme)}
          formatter={(value) =>
            currency ? formatCurrency(Number(value)) : (value as number)
          }
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    )}
  </Measured>
);

export const OrderTypeDonut: React.FC<{
  data: DashboardSummary['orders_by_type'];
  theme: Theme;
}> = ({ data, theme }) => (
  <Donut data={data.map((d) => ({ name: prettify(d.type), value: d.count }))} theme={theme} />
);

export const SourceSplitDonut: React.FC<{
  data: DashboardSummary['orders_by_source'];
  theme: Theme;
}> = ({ data, theme }) => (
  <Donut data={data.map((d) => ({ name: prettify(d.source), value: d.count }))} theme={theme} />
);

export const PaymentMethodDonut: React.FC<{
  data: DashboardSummary['payments_by_method'];
  theme: Theme;
}> = ({ data, theme }) => (
  <Donut
    data={data.map((d) => ({ name: d.method === 'cod' ? 'COD' : prettify(d.method), value: d.amount }))}
    theme={theme}
    currency
  />
);

/** Horizontal bar of top items by quantity sold. */
export const TopItemsChart: React.FC<{
  data: DashboardSummary['top_items'];
  theme: Theme;
}> = ({ data, theme }) => {
  // Phones: a 130px label gutter would take 40% of the chart, so shorten the names instead.
  const { isPhone } = useViewport();
  const labelWidth = isPhone ? 96 : 130;
  const shortName = (value: unknown) => {
    const s = String(value);
    return isPhone && s.length > 14 ? `${s.slice(0, 13)}…` : s;
  };
  return (
  <Measured height={Math.max(240, data.length * 32)}>
    {(w, h) => (
      <BarChart width={w} height={h} data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor(theme)} horizontal={false} />
        <XAxis
          type="number"
          allowDecimals={false}
          tick={{ fontSize: 11, fill: axisColor(theme) }}
          stroke={axisColor(theme)}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={labelWidth}
          tickFormatter={shortName}
          tick={{ fontSize: 11, fill: axisColor(theme) }}
          stroke={axisColor(theme)}
        />
        <Tooltip
          contentStyle={tooltipStyle(theme)}
          cursor={{ fill: 'transparent' }}
          formatter={(value, name) =>
            name === 'Revenue' ? formatCurrency(Number(value)) : (value as number)
          }
        />
        <Bar dataKey="quantity" name="Qty" fill={REVENUE_COLOR} radius={[0, 4, 4, 0]} />
      </BarChart>
    )}
  </Measured>
  );
};
