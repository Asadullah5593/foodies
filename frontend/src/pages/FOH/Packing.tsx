import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import Button from '../../components/Button';
import SearchableSelect from '../../components/SearchableSelect';
import { formatOrderType } from '../../utils/format';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

type PackingOrderItem = {
  id: number;
  name?: string;
  name_snapshot?: string;
  quantity: number;
  notes?: string;
  variant_name?: string | null;
  brand_name?: string | null;
  addons?: Array<{ name: string; quantity: number }>;
};

type PackingOrder = {
  id: number;
  order_number: string;
  order_group_id?: string | null;
  order_type: string;
  status: string;
  table_number?: string;
  customer_name?: string;
  placed_at?: string;
  items: PackingOrderItem[];
};

const FOHPacking: React.FC = () => {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ready');
  const [dateFrom, setDateFrom] = useState<string>(todayIsoDate());
  const [dateTo, setDateTo] = useState<string>(todayIsoDate());
  const [showCompleted, setShowCompleted] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get('/admin/branches');
      return response.data;
    },
  });

  useEffect(() => {
    if (!branchId && branches?.length) {
      setBranchId(String(branches[0].id));
    }
  }, [branchId, branches]);

  const { data: orders, isLoading } = useQuery({
    queryKey: ['foh-packing-orders', branchId, statusFilter, dateFrom, dateTo, showCompleted],
    queryFn: async () => {
      if (!branchId) return [];
      const params = new URLSearchParams({ branch_id: branchId });
      if (statusFilter) params.append('status', statusFilter);
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (showCompleted || statusFilter === 'completed') params.append('include_completed', '1');
      const response = await apiClient.get<PackingOrder[]>(`/kitchen/orders?${params.toString()}`);
      return response.data;
    },
    enabled: !!branchId,
    refetchInterval: ORDER_POLL_INTERVAL_MS,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: number; status: string }) => {
      const response = await apiClient.patch(`/kitchen/orders/${orderId}/status`, {
        status,
        branch_id: +branchId,
      });
      return response.data;
    },
    onMutate: ({ orderId }) => {
      setUpdatingOrderId(orderId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foh-packing-orders'] });
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      toast.success('Status updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update status');
    },
    onSettled: () => {
      setUpdatingOrderId(null);
    },
  });

  const ordered = useMemo(() => {
    return (orders as PackingOrder[] | undefined) ?? [];
  }, [orders]);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950 text-gray-900 dark:text-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">FOH Packing</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
              Verify items before handing over. Pricing is hidden.
            </p>
          </div>
          <div className="flex flex-wrap gap-4 items-end">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">From date</label>
              <input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">To date</label>
              <input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <SearchableSelect
              label="Branch"
              value={branchId}
              onChange={(v) => setBranchId(v)}
              options={[
                { value: '', label: 'Select branch' },
                ...(branches ?? []).map((b: { id: number; name: string }) => ({
                  value: String(b.id),
                  label: b.name,
                })),
              ]}
              placeholder="Select branch"
            />
            <SearchableSelect
              label="Status"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                if (v === 'completed') setShowCompleted(true);
              }}
              options={[
                { value: '', label: 'All statuses' },
                { value: 'placed', label: 'Placed' },
                { value: 'accepted', label: 'Accepted' },
                { value: 'preparing', label: 'Preparing' },
                { value: 'ready', label: 'Ready' },
                { value: 'completed', label: 'Completed' },
              ]}
              placeholder="Ready"
            />
            <button
              type="button"
              onClick={() => setShowCompleted((v) => !v)}
              className={[
                'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                showCompleted
                  ? 'bg-emerald-50 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200'
                  : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700',
              ].join(' ')}
              title="Toggle completed orders"
            >
              {showCompleted ? 'Showing completed' : 'Hide completed'}
            </button>
          </div>
        </div>

        {!branchId ? (
          <Card className="p-8 text-center dark:bg-slate-800 dark:border-slate-700">
            <p className="text-gray-600 dark:text-slate-300">Select a branch to view orders.</p>
          </Card>
        ) : isLoading ? (
          <Loader fullScreen text="Loading orders..." />
        ) : !ordered.length ? (
          <Card className="p-8 text-center dark:bg-slate-800 dark:border-slate-700">
            <p className="text-gray-600 dark:text-slate-300">No orders found.</p>
          </Card>
        ) : (
          <>
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
              Queue order: oldest first (new orders appear at the end).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              {ordered.map((order) => {
                return (
                  <Card
                    key={order.id}
                    className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden"
                  >
                    <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                      <div>
                        <span className="text-lg font-bold text-gray-900 dark:text-gray-100">Order #{order.order_number}</span>
                        <span className="ml-2 px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700">
                          {order.status}
                        </span>
                      </div>
                    </div>

                    <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-600">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                        <span className="font-semibold text-gray-900 dark:text-gray-100">
                          {formatOrderType(order.order_type)}
                        </span>
                        {order.table_number && (
                          <span className="text-gray-600 dark:text-gray-300">Table {order.table_number}</span>
                        )}
                        {order.placed_at && (
                          <span className="text-gray-500 dark:text-gray-400">
                            {new Date(order.placed_at).toLocaleTimeString()}
                          </span>
                        )}
                      </div>
                      {order.customer_name && (
                        <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Customer: {order.customer_name}</p>
                      )}
                    </div>

                    <div className="px-4 py-3 space-y-3">
                      {order.items?.map((item) => (
                        <div key={item.id} className="border-l-2 border-gray-200 dark:border-gray-600 pl-3">
                          {item.brand_name && (
                            <p className="text-xs font-medium text-indigo-600 dark:text-indigo-400 mb-0.5">
                              {item.brand_name}
                            </p>
                          )}
                          <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                            {item.quantity}× {item.name ?? item.name_snapshot ?? 'Item'}
                            {item.variant_name && (
                              <span className="font-normal text-gray-600 dark:text-gray-400"> — {item.variant_name}</span>
                            )}
                          </p>
                          {item.addons?.length ? (
                            <p className="text-sm text-gray-700 dark:text-gray-300 mt-0.5">
                              Add-ons: {item.addons.map((a) => `${a.name} ×${a.quantity ?? 1}`).join(', ')}
                            </p>
                          ) : null}
                          {item.notes && (
                            <p className="text-sm mt-0.5 text-amber-700 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/40 px-2 py-1 rounded border border-amber-200 dark:border-amber-700">
                              Note: {item.notes}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>

                    <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-600 flex gap-2 flex-wrap">
                      {order.status === 'ready' && (
                        <Button
                          size="small"
                          variant="primary"
                          onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: 'completed' })}
                          isLoading={updatingOrderId === order.id}
                          disabled={updatingOrderId === order.id}
                        >
                          Handed over (Complete)
                        </Button>
                      )}
                      {order.status !== 'ready' && (
                        <span className="text-xs text-gray-600 dark:text-gray-300">
                          Mark complete when status is <span className="font-semibold">ready</span>.
                        </span>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default FOHPacking;

