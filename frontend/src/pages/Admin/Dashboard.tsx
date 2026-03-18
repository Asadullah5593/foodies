import React, { useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../contexts/AuthContext';
import apiClient from '../../utils/apiClient';
import Card from '../../components/Card';
import SearchableSelect from '../../components/SearchableSelect';
import { formatCurrency } from '../../utils/currency';
import Loader from '../../components/Loader';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type DayOverviewResponse = {
  date_from: string;
  date_to: string;
  branch_id: number | null;
  orders_by_status: Record<string, number>;
  orders_by_status_by_source: Record<string, Record<string, number>>;
  payments_total: number;
  payments_by_method: Record<string, number>;
  payments_by_method_by_source: Record<string, Record<string, number>>;
};

type SalesSummaryResponse = {
  total_orders: number;
  total_revenue: number;
  total_sales: number;
  total_discounts: number;
  total_service_charge: number;
  total_delivery_fee: number;
  total_tax: number;
  average_order_value: number;
};

type TopItemRow = {
  menu_item_id: number;
  name: string;
  quantity: number;
  total_revenue: number;
};

const Dashboard: React.FC = () => {
  const { user } = useAuth();
  const [branchId, setBranchId] = useState<number | null>(null);
  const [dateFrom, setDateFrom] = useState<string>(todayIsoDate());
  const [dateTo, setDateTo] = useState<string>(todayIsoDate());

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get<Array<{ id: number; name: string; code: string }>>('/admin/branches');
      return response.data ?? [];
    },
  });

  const { data: overview, isLoading: overviewLoading } = useQuery({
    queryKey: ['dayOverview', branchId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchId != null) params.append('branch_id', String(branchId));
      params.append('date_from', dateFrom);
      params.append('date_to', dateTo);
      const response = await apiClient.get<DayOverviewResponse>(`/admin/reports/day-overview?${params.toString()}`);
      return response.data;
    },
    enabled: !!user,
  });

  const { data: salesSummary } = useQuery({
    queryKey: ['salesSummary', branchId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchId != null) params.append('branch_id', String(branchId));
      params.append('date_from', dateFrom);
      params.append('date_to', dateTo);
      const response = await apiClient.get<SalesSummaryResponse>(`/admin/reports/sales-summary?${params.toString()}`);
      return response.data;
    },
    enabled: !!user,
  });

  const { data: topItems } = useQuery({
    queryKey: ['topItems', branchId, dateFrom, dateTo],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (branchId != null) params.append('branch_id', String(branchId));
      params.append('date_from', dateFrom);
      params.append('date_to', dateTo);
      const response = await apiClient.get<TopItemRow[]>(`/admin/reports/top-items?${params.toString()}`);
      return Array.isArray(response.data) ? response.data : [];
    },
    enabled: !!user,
  });

  const statusRows = useMemo(() => {
    const byStatus = overview?.orders_by_status ?? {};
    const bySource = overview?.orders_by_status_by_source ?? {};
    const statuses = Array.from(new Set([
      ...Object.keys(byStatus),
      ...Object.values(bySource).flatMap((m) => Object.keys(m ?? {})),
    ]));

    const preferredOrder = ['placed', 'accepted', 'preparing', 'ready', 'completed', 'cancelled'];
    statuses.sort((a, b) => {
      const ai = preferredOrder.indexOf(a);
      const bi = preferredOrder.indexOf(b);
      if (ai !== -1 && bi !== -1) return ai - bi;
      if (ai !== -1) return -1;
      if (bi !== -1) return 1;
      return a.localeCompare(b);
    });

    const pos = bySource.pos ?? {};
    const consumer = bySource.consumer_app ?? {};
    return statuses.map((s) => ({
      status: s,
      total: Number(byStatus[s] ?? 0),
      pos: Number(pos[s] ?? 0),
      consumer_app: Number(consumer[s] ?? 0),
    }));
  }, [overview]);

  const paymentsMethodRows = useMemo(() => {
    const byMethod = overview?.payments_by_method ?? {};
    const bySource = overview?.payments_by_method_by_source ?? {};
    const methods = Array.from(new Set([
      ...Object.keys(byMethod),
      ...Object.values(bySource).flatMap((m) => Object.keys(m ?? {})),
    ])).sort((a, b) => a.localeCompare(b));

    const pos = bySource.pos ?? {};
    const consumer = bySource.consumer_app ?? {};
    return methods.map((m) => ({
      method: m,
      total: Number(byMethod[m] ?? 0),
      pos: Number(pos[m] ?? 0),
      consumer_app: Number(consumer[m] ?? 0),
    }));
  }, [overview]);

  const totalOrders = useMemo(() => {
    return Object.values(overview?.orders_by_status ?? {}).reduce((s, n) => s + Number(n ?? 0), 0);
  }, [overview]);

  const paymentsTotal = Number(overview?.payments_total ?? 0);
  const posOrdersTotal = Object.values(overview?.orders_by_status_by_source?.pos ?? {}).reduce((s, n) => s + Number(n ?? 0), 0);
  const consumerOrdersTotal = Object.values(overview?.orders_by_status_by_source?.consumer_app ?? {}).reduce((s, n) => s + Number(n ?? 0), 0);
  const totalRevenue = Number(salesSummary?.total_revenue ?? 0);
  const totalDiscounts = Number(salesSummary?.total_discounts ?? 0);
  const averageOrderValue = Number(salesSummary?.average_order_value ?? 0);
  const totalTax = Number(salesSummary?.total_tax ?? 0);
  const totalDeliveryFee = Number(salesSummary?.total_delivery_fee ?? 0);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-4xl font-bold text-gray-800 mb-2">Admin Dashboard</h1>
        <p className="text-xl text-gray-600">Welcome back, <span className="font-semibold text-blue-600">{user?.name}</span>!</p>
      </motion.div>

      <div className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-4">
          <div>
            <h2 className="text-2xl font-semibold text-gray-800">Overview</h2>
            <p className="text-sm text-gray-600">Orders, payments, and sales for the selected date range.</p>
          </div>
          <div className="flex flex-wrap gap-4 items-end">
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
              <label className="block text-sm font-medium text-gray-700 mb-2">From</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">To</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>
        </div>

        {overviewLoading ? (
          <Loader fullScreen text="Loading overview..." />
        ) : (
          <>
            <div className="grid grid-cols-1 md:grid-cols-6 gap-6 mb-6">
              <Card>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Total orders</h3>
                <p className="text-3xl font-bold text-blue-600">{totalOrders}</p>
                <p className="text-xs text-gray-500 mt-2">POS: {posOrdersTotal} · Consumer: {consumerOrdersTotal}</p>
              </Card>
              <Card>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Payments received</h3>
                <p className="text-3xl font-bold text-emerald-600">{formatCurrency(paymentsTotal)}</p>
                <p className="text-xs text-gray-500 mt-2">From completed orders</p>
              </Card>
              <Card>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Total revenue</h3>
                <p className="text-3xl font-bold text-indigo-600">
                  {formatCurrency(totalRevenue)}
                </p>
              </Card>
              <Card>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Avg order value</h3>
                <p className="text-3xl font-bold text-emerald-700">{formatCurrency(averageOrderValue)}</p>
                <p className="text-xs text-gray-500 mt-2">Discounts: {formatCurrency(totalDiscounts)}</p>
              </Card>
              <Card>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Total tax</h3>
                <p className="text-3xl font-bold text-purple-700">{formatCurrency(totalTax)}</p>
              </Card>
              <Card>
                <h3 className="text-sm font-medium text-gray-500 mb-2">Delivery fees</h3>
                <p className="text-3xl font-bold text-sky-700">{formatCurrency(totalDeliveryFee)}</p>
              </Card>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <Card className="p-0 overflow-hidden">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800">Orders by status</h3>
                  <p className="text-sm text-gray-600">Totals and POS vs Consumer split.</p>
                </div>
                <div className="p-4 overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 pr-3">Total</th>
                        <th className="py-2 pr-3">POS</th>
                        <th className="py-2 pr-3">Consumer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {statusRows.length === 0 ? (
                        <tr><td className="py-3 text-gray-500" colSpan={4}>No orders for this day.</td></tr>
                      ) : statusRows.map((r) => (
                        <tr key={r.status}>
                          <td className="py-2 pr-3 font-medium text-gray-800">{r.status}</td>
                          <td className="py-2 pr-3">{r.total}</td>
                          <td className="py-2 pr-3">{r.pos}</td>
                          <td className="py-2 pr-3">{r.consumer_app}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="p-0 overflow-hidden">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800">Payments by method</h3>
                  <p className="text-sm text-gray-600">From completed orders, split by POS vs Consumer.</p>
                </div>
                <div className="p-4 overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="py-2 pr-3">Method</th>
                        <th className="py-2 pr-3">Total</th>
                        <th className="py-2 pr-3">POS</th>
                        <th className="py-2 pr-3">Consumer</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {paymentsMethodRows.length === 0 ? (
                        <tr><td className="py-3 text-gray-500" colSpan={4}>No payments for this day.</td></tr>
                      ) : paymentsMethodRows.map((r) => (
                        <tr key={r.method}>
                          <td className="py-2 pr-3 font-medium text-gray-800">{r.method}</td>
                          <td className="py-2 pr-3">{formatCurrency(r.total)}</td>
                          <td className="py-2 pr-3">{formatCurrency(r.pos)}</td>
                          <td className="py-2 pr-3">{formatCurrency(r.consumer_app)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>

              <Card className="p-0 overflow-hidden">
                <div className="p-4 border-b border-gray-200">
                  <h3 className="text-lg font-semibold text-gray-800">Top items</h3>
                  <p className="text-sm text-gray-600">Best sellers (completed orders) in this range.</p>
                </div>
                <div className="p-4 overflow-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-gray-500">
                        <th className="py-2 pr-3">Item</th>
                        <th className="py-2 pr-3">Qty</th>
                        <th className="py-2 pr-3">Revenue</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {(topItems ?? []).length === 0 ? (
                        <tr><td className="py-3 text-gray-500" colSpan={3}>No sales for this range.</td></tr>
                      ) : (topItems ?? []).slice(0, 10).map((row) => (
                        <tr key={row.menu_item_id}>
                          <td className="py-2 pr-3 font-medium text-gray-800">{row.name}</td>
                          <td className="py-2 pr-3">{Number(row.quantity ?? 0)}</td>
                          <td className="py-2 pr-3">{formatCurrency(Number(row.total_revenue ?? 0))}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Card>
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default Dashboard;
