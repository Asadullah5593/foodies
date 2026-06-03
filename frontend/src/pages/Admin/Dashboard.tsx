import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import { useTheme } from '../../contexts/ThemeContext';
import apiClient from '../../utils/apiClient';
import SearchableSelect from '../../components/SearchableSelect';
import { formatCurrency } from '../../utils/currency';
import KpiCard from './dashboard/KpiCard';
import ChartCard from './dashboard/ChartCard';
import {
  RevenueTrendChart,
  OrdersByStatusChart,
  OrderTypeDonut,
  SourceSplitDonut,
  PaymentMethodDonut,
  TopItemsChart,
} from './dashboard/charts';
import {
  DeliveryStatusPanel,
  RatingsPanel,
  RecentOrdersPanel,
  InventoryAlertsPanel,
} from './dashboard/panels';
import { defaultRange, matchPreset, presetRanges } from './dashboard/dateRanges';
import type { DashboardSummary, RecentOrder, InventoryAlerts } from './dashboard/types';

function buildReportParams(
  branchId: number | null,
  from: string,
  to: string,
  extra?: Record<string, string>,
): string {
  const params = new URLSearchParams();
  if (branchId != null) params.append('branch_id', String(branchId));
  params.append('date_from', from);
  params.append('date_to', to);
  if (extra) for (const [k, v] of Object.entries(extra)) params.append(k, v);
  return params.toString();
}

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const initial = defaultRange();
  const [branchId, setBranchId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState<string>(initial.from);
  const [dateTo, setDateTo] = useState<string>(initial.to);

  const activePreset = matchPreset(dateFrom, dateTo);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get<Array<{ id: number; name: string; code: string }>>('/admin/branches');
      return response.data ?? [];
    },
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboardSummary', branchId, dateFrom, dateTo],
    queryFn: async () => {
      const qs = buildReportParams(branchId, dateFrom, dateTo);
      const response = await apiClient.get<DashboardSummary>(`/admin/reports/dashboard-summary?${qs}`);
      return response.data;
    },
    enabled: !!user,
  });

  const { data: recentOrders, isLoading: recentLoading } = useQuery({
    queryKey: ['recentOrders', branchId, dateFrom, dateTo],
    queryFn: async () => {
      const qs = buildReportParams(branchId, dateFrom, dateTo, { limit: '15' });
      const response = await apiClient.get<RecentOrder[]>(`/admin/reports/recent-orders?${qs}`);
      return Array.isArray(response.data) ? response.data : [];
    },
    enabled: !!user,
  });

  const { data: inventory, isLoading: inventoryLoading } = useQuery({
    queryKey: ['inventoryAlerts', branchId, dateFrom, dateTo],
    queryFn: async () => {
      const qs = buildReportParams(branchId, dateFrom, dateTo);
      const response = await apiClient.get<InventoryAlerts>(`/admin/reports/inventory-alerts?${qs}`);
      return response.data;
    },
    enabled: !!user,
  });

  const k = summary?.kpis;
  const hasOrders = (summary?.kpis.total_orders ?? 0) > 0;

  const kpiCards = useMemo(
    () => [
      {
        label: 'Revenue',
        value: formatCurrency(k?.total_revenue ?? 0),
        sublabel: 'Completed orders',
        delta: summary?.deltas.revenue_pct,
        accent: 'text-emerald-600 dark:text-emerald-400',
      },
      {
        label: 'Orders',
        value: String(k?.total_orders ?? 0),
        sublabel: `${k?.completed_orders ?? 0} completed`,
        delta: summary?.deltas.orders_pct,
        accent: 'text-blue-600 dark:text-blue-400',
      },
      {
        label: 'Avg order value',
        value: formatCurrency(k?.average_order_value ?? 0),
        delta: summary?.deltas.aov_pct,
        accent: 'text-indigo-600 dark:text-indigo-400',
      },
      {
        label: 'Completion rate',
        value: `${((k?.completion_rate ?? 0) * 100).toFixed(0)}%`,
        sublabel: `${k?.completed_orders ?? 0} / ${k?.total_orders ?? 0}`,
        accent: 'text-violet-600 dark:text-violet-400',
      },
      {
        label: 'Active riders',
        value: String(k?.active_riders ?? 0),
        sublabel: 'Checked in now',
        accent: 'text-cyan-600 dark:text-cyan-400',
      },
      {
        label: 'Avg rating',
        value: k?.avg_brand_rating != null ? k.avg_brand_rating.toFixed(1) : '—',
        sublabel: 'Brand stars',
        accent: 'text-amber-600 dark:text-amber-400',
      },
      {
        label: 'Discounts',
        value: formatCurrency(k?.total_discounts ?? 0),
        accent: 'text-rose-600 dark:text-rose-400',
      },
      {
        label: 'Delivery fees',
        value: formatCurrency(k?.total_delivery_fee ?? 0),
        accent: 'text-sky-600 dark:text-sky-400',
      },
    ],
    [k, summary],
  );

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-6"
      >
        <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">Admin Dashboard</h1>
        <p className="text-base text-gray-600 dark:text-slate-400">
          Welcome back, <span className="font-semibold text-foodies-cta">{user?.name}</span>!
        </p>
      </motion.div>

      {/* Filters */}
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="flex flex-wrap items-center gap-2">
          {presetRanges().map((p) => (
            <button
              key={p.key}
              onClick={() => {
                setDateFrom(p.from);
                setDateTo(p.to);
              }}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition-colors ${
                activePreset === p.key
                  ? 'bg-foodies-cta text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <SearchableSelect
            label="Branch"
            value={branchId ? String(branchId) : ''}
            onChange={(v) => setBranchId(v ? Number(v) : null)}
            options={[
              { value: '', label: 'All branches' },
              ...(branches ?? []).map((b) => ({ value: String(b.id), label: `${b.name} (${b.code})` })),
            ]}
            placeholder="All branches"
            minWidth="min-w-[200px]"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-foodies-cta"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-foodies-cta"
            />
          </div>
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {kpiCards.map((card, i) => (
          <KpiCard key={card.label} index={i} loading={summaryLoading} {...card} />
        ))}
      </div>

      {/* Revenue trend (full width) */}
      <div className="mb-6">
        <ChartCard
          title="Revenue & orders trend"
          subtitle="Daily revenue (area) and order count (line) for the selected range."
          loading={summaryLoading}
          isEmpty={!summaryLoading && !hasOrders}
        >
          {summary && <RevenueTrendChart data={summary.time_series} theme={theme} />}
        </ChartCard>
      </div>

      {/* Breakdown charts */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        <ChartCard
          title="Orders by status"
          subtitle="Pipeline across the selected range."
          loading={summaryLoading}
          isEmpty={!summaryLoading && (summary?.orders_by_status.length ?? 0) === 0}
        >
          {summary && <OrdersByStatusChart data={summary.orders_by_status} theme={theme} />}
        </ChartCard>
        <ChartCard
          title="Top items"
          subtitle="Best sellers by quantity (completed orders)."
          loading={summaryLoading}
          isEmpty={!summaryLoading && (summary?.top_items.length ?? 0) === 0}
        >
          {summary && <TopItemsChart data={summary.top_items} theme={theme} />}
        </ChartCard>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <ChartCard
          title="Order type"
          subtitle="Delivery / pickup / dine-in."
          loading={summaryLoading}
          isEmpty={!summaryLoading && (summary?.orders_by_type.length ?? 0) === 0}
        >
          {summary && <OrderTypeDonut data={summary.orders_by_type} theme={theme} />}
        </ChartCard>
        <ChartCard
          title="Order source"
          subtitle="POS vs app vs web."
          loading={summaryLoading}
          isEmpty={!summaryLoading && (summary?.orders_by_source.length ?? 0) === 0}
        >
          {summary && <SourceSplitDonut data={summary.orders_by_source} theme={theme} />}
        </ChartCard>
        <ChartCard
          title="Payments by method"
          subtitle="From completed orders."
          loading={summaryLoading}
          isEmpty={!summaryLoading && (summary?.payments_by_method.length ?? 0) === 0}
        >
          {summary && <PaymentMethodDonut data={summary.payments_by_method} theme={theme} />}
        </ChartCard>
      </div>

      {/* Operational panels */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        <ChartCard title="Delivery operations" subtitle="Live riders + delivery status." loading={summaryLoading}>
          {summary && <DeliveryStatusPanel delivery={summary.delivery} />}
        </ChartCard>
        <ChartCard title="Ratings & feedback" subtitle="Brand & rider stars, recent comments." loading={summaryLoading}>
          {summary && <RatingsPanel ratings={summary.ratings} />}
        </ChartCard>
        <ChartCard title="Recent orders" subtitle="Latest 15 in range." loading={recentLoading}>
          {recentOrders && <RecentOrdersPanel orders={recentOrders} />}
        </ChartCard>
      </div>

      {/* Inventory (secondary) */}
      <div className="mb-6">
        <ChartCard title="Inventory alerts" subtitle="Low stock vs reorder point and recent wastage." loading={inventoryLoading}>
          {inventory && <InventoryAlertsPanel data={inventory} />}
        </ChartCard>
      </div>
    </div>
  );
};

export default Dashboard;
