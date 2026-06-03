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
  ORDERS_COLOR,
  STATUS_COLORS,
  colorFor,
  tooltipStyle,
  axisColor,
  gridColor,
} from '../../../utils/chartColors';
import type { DashboardSummary } from './types';

type Theme = 'light' | 'dark';

const compactCurrency = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n);
const shortDay = (d: string) => (d ? d.slice(5) : d); // MM-DD
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

/** Revenue (area, left axis) + orders (line, right axis) over time. */
export const RevenueTrendChart: React.FC<{
  data: DashboardSummary['time_series'];
  theme: Theme;
}> = ({ data, theme }) => (
  <Measured height={280}>
    {(w, h) => (
      <ComposedChart width={w} height={h} data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="revGradient" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor={REVENUE_COLOR} stopOpacity={0.35} />
            <stop offset="95%" stopColor={REVENUE_COLOR} stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke={gridColor(theme)} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={shortDay}
          tick={{ fontSize: 11, fill: axisColor(theme) }}
          stroke={axisColor(theme)}
          minTickGap={24}
        />
        <YAxis
          yAxisId="left"
          tick={{ fontSize: 11, fill: axisColor(theme) }}
          stroke={axisColor(theme)}
          tickFormatter={compactCurrency}
          width={48}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          tick={{ fontSize: 11, fill: axisColor(theme) }}
          stroke={axisColor(theme)}
          allowDecimals={false}
          width={32}
        />
        <Tooltip
          contentStyle={tooltipStyle(theme)}
          formatter={(value, name) =>
            name === 'Revenue' ? formatCurrency(Number(value)) : (value as number)
          }
        />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Area
          yAxisId="left"
          type="monotone"
          dataKey="revenue"
          name="Revenue"
          stroke={REVENUE_COLOR}
          strokeWidth={2}
          fill="url(#revGradient)"
        />
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="orders"
          name="Orders"
          stroke={ORDERS_COLOR}
          strokeWidth={2}
          dot={false}
        />
      </ComposedChart>
    )}
  </Measured>
);

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
