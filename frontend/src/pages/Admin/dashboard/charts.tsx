import React, { useEffect, useRef, useState } from 'react';
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
} from 'recharts';
import { formatCurrency } from '../../../utils/currency';
import {
  CHART_COLORS,
  REVENUE_COLOR,
  STATUS_COLORS,
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

/**
 * Order-wise trend: every order in the range is its own point (amount), in
 * time sequence. When the range mixes brands, each brand becomes its own line
 * (an order belongs to exactly one brand); a single-brand range keeps the
 * classic filled area. The tooltip names the exact order; dots make single
 * orders visible even when the range is quiet.
 */
export const OrderSeriesChart: React.FC<{
  data: OrderSeriesResponse['orders'];
  theme: Theme;
  /** Tenant brand list — each brand's line color is keyed to its position here, so hues stay stable across filters. */
  brands?: Array<{ id: number; name: string }>;
}> = ({ data, theme, brands }) => {
  const brandIds = Array.from(new Set(data.map((d) => d.brand_id)));
  const multiBrand = brandIds.length > 1;
  // Per-series value keys: each row carries its amount under its own brand's
  // key, so recharts draws one connectNulls line per brand.
  const rows = multiBrand
    ? data.map((d) => ({ ...d, [`brand_${d.brand_id ?? 'none'}`]: d.total_amount }))
    : data;
  const series = brandIds
    .map((id, i) => {
      const idx = id == null ? -1 : (brands ?? []).findIndex((b) => b.id === id);
      return {
        key: `brand_${id ?? 'none'}`,
        name:
          id == null
            ? 'No brand'
            : (brands ?? []).find((b) => b.id === id)?.name ??
              data.find((d) => d.brand_id === id)?.brand_name ??
              `Brand ${id}`,
        // Color keyed to the brand's position in the tenant list; a brand
        // missing from it (deleted since the order) still gets a distinct
        // palette hue by series position. Gray marks only the no-brand bucket.
        color:
          id == null
            ? '#94A3B8'
            : CHART_COLORS[(idx >= 0 ? idx : i) % CHART_COLORS.length],
        sort: idx >= 0 ? idx : Number.MAX_SAFE_INTEGER,
      };
    })
    .sort((a, b) => a.sort - b.sort);
  return (
    <Measured height={280}>
      {(w, h) => (
        <ComposedChart width={w} height={h} data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor={REVENUE_COLOR} stopOpacity={0.35} />
              <stop offset="95%" stopColor={REVENUE_COLOR} stopOpacity={0} />
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
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {multiBrand ? (
            series.map((s) => (
              <Line
                key={s.key}
                type="monotone"
                dataKey={s.key}
                name={s.name}
                stroke={s.color}
                strokeWidth={2}
                connectNulls
                dot={{ r: 2, stroke: s.color, fill: s.color }}
              />
            ))
          ) : (
            <Area
              type="monotone"
              dataKey="total_amount"
              name="Order amount"
              stroke={REVENUE_COLOR}
              strokeWidth={2}
              fill="url(#revGradient)"
              dot={{ r: 2, stroke: REVENUE_COLOR, fill: REVENUE_COLOR }}
            />
          )}
        </ComposedChart>
      )}
    </Measured>
  );
};

const STATUS_ORDER = ['placed', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];

/** Horizontal bar of order counts by status (funnel-ordered). */
export const OrdersByStatusChart: React.FC<{
  data: DashboardSummary['orders_by_status'];
  theme: Theme;
}> = ({ data, theme }) => {
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
            width={84}
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
    data={data.map((d) => ({ name: prettify(d.method), value: d.amount }))}
    theme={theme}
    currency
  />
);

/** Horizontal bar of top items by quantity sold. */
export const TopItemsChart: React.FC<{
  data: DashboardSummary['top_items'];
  theme: Theme;
}> = ({ data, theme }) => (
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
          width={130}
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
