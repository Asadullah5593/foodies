import React, { useEffect, useMemo, useState } from 'react';
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

/** The whole-day bounds — sending these is identical to sending no time at all. */
const DAY_START = '00:00';
const DAY_END = '23:59';

function buildReportParams(
  branchId: number | null,
  from: string,
  to: string,
  extra?: Record<string, string>,
  brandId?: number | null,
  time?: { from: string; to: string } | null,
): string {
  const params = new URLSearchParams();
  if (branchId != null) params.append('branch_id', String(branchId));
  if (brandId != null) params.append('brand_id', String(brandId));
  params.append('date_from', from);
  params.append('date_to', to);
  // Only send a clock when it narrows the window, so the default request (and its
  // react-query key) stays exactly as it was.
  if (time && (time.from !== DAY_START || time.to !== DAY_END)) {
    params.append('time_from', time.from);
    params.append('time_to', time.to);
  }
  if (extra) for (const [k, v] of Object.entries(extra)) params.append(k, v);
  return params.toString();
}

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const { theme } = useTheme();
  const initial = defaultRange();
  const [branchId, setBranchId] = useState<number | null>(null);
  const [brandId, setBrandId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState<string>(initial.from);
  const [dateTo, setDateTo] = useState<string>(initial.to);
  // Time-of-day bounds on the range: From <date> <time> → To <date> <time>, one
  // continuous window. Defaults span the whole day, so the dashboard opens
  // behaving exactly as before.
  const [timeFrom, setTimeFrom] = useState<string>(DAY_START);
  const [timeTo, setTimeTo] = useState<string>(DAY_END);
  const time = { from: timeFrom, to: timeTo };
  const timeNarrowed = timeFrom !== DAY_START || timeTo !== DAY_END;

  // A preset covers a WHOLE period, so a narrowed clock means no preset is active —
  // otherwise "Today" stays lit while showing only the dinner service.
  const activePreset = timeNarrowed ? null : matchPreset(dateFrom, dateTo);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get<Array<{ id: number; name: string; code: string; brand_ids?: number[] }>>('/admin/branches');
      return response.data ?? [];
    },
  });

  // Owner sees all brands and can drill into one; brand-locked users get
  // only their own brand back from the server.
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<Array<{ id: number; name: string }>>('/admin/brands');
      return response.data ?? [];
    },
  });

  const { data: summary, isLoading: summaryLoading } = useQuery({
    queryKey: ['dashboardSummary', branchId, brandId, dateFrom, dateTo, timeFrom, timeTo],
    queryFn: async () => {
      const qs = buildReportParams(branchId, dateFrom, dateTo, undefined, brandId, time);
      const response = await apiClient.get<DashboardSummary>(`/admin/reports/dashboard-summary?${qs}`);
      return response.data;
    },
    enabled: !!user,
  });

  const { data: recentOrders, isLoading: recentLoading } = useQuery({
    queryKey: ['recentOrders', branchId, brandId, dateFrom, dateTo, timeFrom, timeTo],
    queryFn: async () => {
      const qs = buildReportParams(branchId, dateFrom, dateTo, { limit: '15' }, brandId, time);
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

  // —— Role-aware scope: owner/admin (all brands & branches) vs brand owner
  // (one brand, possibly many branches) vs branch manager (one brand+branch).
  const allowedBrandIds = user?.allowed_brand_ids ?? null;
  const isBrandLocked =
    Array.isArray(allowedBrandIds) && allowedBrandIds.length > 0;
  // "Brand-specific" = locked to exactly one brand.
  const isBrandSpecific = isBrandLocked && allowedBrandIds!.length === 1;
  const lockedBrandId = isBrandSpecific ? Number(allowedBrandIds![0]) : null;
  // Effective brand in scope: the locked brand, or the owner's chosen brand.
  const effectiveBrandId = lockedBrandId ?? brandId;

  // Branches relevant to the effective brand (branches carry brand_ids).
  const relevantBranches = useMemo(() => {
    const list = branches ?? [];
    if (effectiveBrandId == null) return list;
    return list.filter(
      (b) => !b.brand_ids || b.brand_ids.includes(effectiveBrandId),
    );
  }, [branches, effectiveBrandId]);
  const multiBranch = relevantBranches.length > 1;

  // Hide the brand filter for a single-brand dashboard; hide the branch filter
  // when a brand-locked user only has one branch in scope.
  const showBrandFilter = !isBrandSpecific;
  const showBranchFilter = !isBrandLocked || multiBranch;
  // Brand-specific dashboards break sales down by branch (when >1) not by brand.
  const breakdownMode: 'brand' | 'branch' | 'none' = isBrandSpecific
    ? multiBranch
      ? 'branch'
      : 'none'
    : 'brand';

  const brandName = isBrandLocked ? (brands?.[0]?.name ?? null) : null;
  const singleBranchName =
    isBrandSpecific && !multiBranch
      ? (relevantBranches[0]?.name ?? branches?.[0]?.name ?? null)
      : null;
  const dashboardTitle = singleBranchName
    ? `${brandName ?? 'Brand'} · ${singleBranchName}`
    : isBrandSpecific
      ? `${brandName ?? 'Brand'} Dashboard`
      : 'Admin Dashboard';

  // Reset the branch filter if the brand scope no longer includes it.
  useEffect(() => {
    if (branchId != null && !relevantBranches.some((b) => b.id === branchId)) {
      setBranchId(null);
    }
  }, [relevantBranches, branchId]);

  const breakdownRows = useMemo(() => {
    if (breakdownMode === 'branch') {
      return (summary?.sales_by_branch ?? []).map((r) => ({
        id: r.branch_id,
        name: r.branch_name,
        orders: r.orders,
        completed: r.completed_orders,
        revenue: r.revenue,
      }));
    }
    return (summary?.sales_by_brand ?? []).map((r) => ({
      id: r.brand_id,
      name: r.brand_name,
      orders: r.orders,
      completed: r.completed_orders,
      revenue: r.revenue,
    }));
  }, [breakdownMode, summary]);

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
        // What it cost YOU: card offers are funded by the bank, so the headline
        // number overstates the hit to margin on its own.
        sublabel:
          k?.discount_breakdown != null
            ? `${formatCurrency(k.discount_breakdown.merchant_funded)} yours`
            : undefined,
        accent: 'text-rose-600 dark:text-rose-400',
      },
      {
        label: 'Bank-funded',
        value: formatCurrency(k?.discount_breakdown?.bank_funded ?? 0),
        sublabel: 'Card offers — paid by the bank',
        accent: 'text-emerald-600 dark:text-emerald-400',
      },
      {
        label: 'Delivery fees',
        value: formatCurrency(k?.total_delivery_fee ?? 0),
        accent: 'text-sky-600 dark:text-sky-400',
      },
      // Cost of goods needs a per-item cost, and nothing can set one yet: no recipe
      // has lines and menu_items.cost_price has no write path in the app. So these
      // read "—" like Avg rating above, rather than claiming a figure — Rs. 0.00
      // cost would imply we measured it, and a profit of revenue-minus-nothing
      // would assert a 100% margin. Give them real values with the COGS query once
      // costs can be entered.
      {
        label: 'Cost',
        value: '—',
        sublabel: 'No cost data yet',
        accent: 'text-orange-600 dark:text-orange-400',
      },
      {
        label: 'Profit',
        value: '—',
        sublabel: 'Needs item costs',
        accent: 'text-teal-600 dark:text-teal-400',
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
        <h1 className="text-3xl font-bold text-gray-800 dark:text-slate-100">{dashboardTitle}</h1>
        <p className="text-base text-gray-600 dark:text-slate-400">
          Welcome back, <span className="font-semibold text-foodies-cta">{user?.name}</span>!
          {isBrandSpecific && (
            <span className="ml-1">
              {multiBranch
                ? 'Showing your brand across all its branches.'
                : 'Showing your branch only.'}
            </span>
          )}
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
                // A preset means the WHOLE of that period, so it clears any clock.
                setTimeFrom(DAY_START);
                setTimeTo(DAY_END);
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
          {showBranchFilter && (
            <SearchableSelect
              label="Branch"
              value={branchId ? String(branchId) : ''}
              onChange={(v) => setBranchId(v ? Number(v) : null)}
              options={[
                { value: '', label: 'All branches' },
                ...relevantBranches.map((b) => ({ value: String(b.id), label: `${b.name} (${b.code})` })),
              ]}
              placeholder="All branches"
              minWidth="min-w-[200px]"
            />
          )}
          {showBrandFilter && (
            <SearchableSelect
              label="Brand"
              value={brandId ? String(brandId) : ''}
              onChange={(v) => setBrandId(v ? Number(v) : null)}
              options={[
                { value: '', label: 'All brands' },
                ...(brands ?? []).map((b) => ({ value: String(b.id), label: b.name })),
              ]}
              placeholder="All brands"
              minWidth="min-w-[180px]"
            />
          )}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">From</label>
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-foodies-cta"
              />
              <input
                type="time"
                aria-label="From time"
                value={timeFrom}
                onChange={(e) => setTimeFrom(e.target.value || DAY_START)}
                className="px-2 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-foodies-cta"
              />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">To</label>
            <div className="flex items-center gap-1">
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="px-3 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-foodies-cta"
              />
              <input
                type="time"
                aria-label="To time"
                value={timeTo}
                onChange={(e) => setTimeTo(e.target.value || DAY_END)}
                className="px-2 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-foodies-cta"
              />
            </div>
          </div>
          {timeNarrowed && (
            <button
              type="button"
              onClick={() => {
                setTimeFrom(DAY_START);
                setTimeTo(DAY_END);
              }}
              className="px-3 py-2 text-sm font-medium text-foodies-cta hover:underline"
            >
              Clear time
            </button>
          )}
        </div>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
        {kpiCards.map((card, i) => (
          <KpiCard key={card.label} index={i} loading={summaryLoading} {...card} />
        ))}
      </div>

      {/* Sales breakdown — by brand for owner/admin, by branch for a brand-specific
          dashboard with multiple branches (hidden when only one branch). */}
      {breakdownMode !== 'none' && (
        <div className="mb-6">
          <ChartCard
            title={breakdownMode === 'branch' ? 'Sales by branch' : 'Sales by brand'}
            subtitle={
              breakdownMode === 'branch'
                ? "What each branch is selling in the selected range (completed revenue)."
                : "What each brand is selling in the selected range (completed revenue)."
            }
            loading={summaryLoading}
            isEmpty={!summaryLoading && breakdownRows.length === 0}
          >
            {breakdownRows.length > 0 && (
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-gray-500 dark:text-slate-400">
                  <tr>
                    <th className="py-2 font-medium">{breakdownMode === 'branch' ? 'Branch' : 'Brand'}</th>
                    <th className="py-2 font-medium text-right">Orders</th>
                    <th className="py-2 font-medium text-right">Completed</th>
                    <th className="py-2 font-medium text-right">Revenue</th>
                  </tr>
                </thead>
                <tbody>
                  {breakdownRows.map((row) => (
                    <tr key={row.id} className="border-t border-gray-100 dark:border-slate-700">
                      <td className="py-2 text-gray-800 dark:text-slate-100">{row.name}</td>
                      <td className="py-2 text-right text-gray-600 dark:text-slate-300">{row.orders}</td>
                      <td className="py-2 text-right text-gray-600 dark:text-slate-300">{row.completed}</td>
                      <td className="py-2 text-right font-medium text-gray-800 dark:text-slate-100">
                        {formatCurrency(row.revenue)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </ChartCard>
        </div>
      )}

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
