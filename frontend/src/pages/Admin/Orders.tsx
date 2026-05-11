import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Order, Branch } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import { formatOrderType } from '../../utils/format';
import Button from '../../components/Button';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import CustomerInvoiceModal from '../../components/CustomerInvoiceModal';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';

type OrderRow = Order & {
  order_number?: string;
  orderNumber?: string;
  total_amount?: number;
  totalAmount?: number;
  order_group_id?: string | null;
  orderGroupId?: string | null;
  branch?: { id: number; name: string; code: string };
  brand?: { id: number; name: string };
  order_type?: string;
  orderType?: string;
  status?: string;
  source?: 'pos' | 'consumer_app' | string;
  rider_id?: number | null;
  rider?: { id: number; name: string } | null;
  delivery_status?: string | null;
  delivery_failed_reason?: string | null;
};

function normalizeOrder(o: OrderRow): OrderRow {
  const row = o as OrderRow & { riderId?: number; deliveryStatus?: string; deliveryFailedReason?: string };
  return {
    ...o,
    order_number: o.order_number ?? o.orderNumber,
    total_amount: o.total_amount ?? o.totalAmount ?? 0,
    order_group_id: o.order_group_id ?? o.orderGroupId ?? null,
    order_type: o.order_type ?? o.orderType,
    rider_id: o.rider_id ?? row.riderId ?? null,
    rider: o.rider ?? null,
    delivery_status: o.delivery_status ?? row.deliveryStatus ?? null,
    delivery_failed_reason: o.delivery_failed_reason ?? row.deliveryFailedReason ?? null,
    source: o.source ?? 'pos',
  };
}

function formatOrderSourceLabel(source: string | null | undefined): string {
  if (source === 'consumer_app') return 'Consumer app';
  if (source === 'pos') return 'POS';
  if (!source) return '—';
  return source.replace(/_/g, ' ');
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  assigned: 'Assigned',
  accepted: 'Accepted',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  delivery_failed: 'Failed',
};

const ORDERS_PAGE_SIZE = DEFAULT_PAGE_SIZE;

const Orders: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [ordersPage, setOrdersPage] = useState(1);
  const [customerInvoiceGroupId, setCustomerInvoiceGroupId] = useState<string | null>(null);
  const [customerInvoiceOrderId, setCustomerInvoiceOrderId] = useState<number | null>(null);
  const [riderModalOrderId, setRiderModalOrderId] = useState<number | null>(null);
  const [riderModalGroupId, setRiderModalGroupId] = useState<string | null>(null);
  const [riderModalIsChange, setRiderModalIsChange] = useState(false);
  const [selectedRiderId, setSelectedRiderId] = useState<number | null>(null);
  const branchId = searchParams.get('branch_id') || '';
  const status = searchParams.get('status') || '';
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  const params = {
    ...(branchId && { branch_id: +branchId }),
    ...(status && { status }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  };

  const { data: ordersRaw, isLoading } = useQuery({
    queryKey: ['admin-orders', params],
    queryFn: async () => {
      const search = new URLSearchParams();
      if (params.branch_id) search.append('branch_id', String(params.branch_id));
      if (params.status) search.append('status', params.status);
      if (params.date_from) search.append('date_from', params.date_from);
      if (params.date_to) search.append('date_to', params.date_to);
      const response = await apiClient.get<OrderRow[]>(`/admin/orders?${search.toString()}`);
      return (response.data ?? []).map(normalizeOrder);
    },
    refetchInterval: ORDER_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get<Branch[]>('/admin/branches');
      return response.data;
    },
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const response = await apiClient.put(`/admin/orders/${id}/status`, { status });
      return response.data;
    },
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      if (status === 'completed') {
        queryClient.invalidateQueries({ queryKey: ['salesSummary'] });
        queryClient.invalidateQueries({ queryKey: ['topItems'] });
        queryClient.invalidateQueries({ queryKey: ['shifts'] });
      }
      toast.success('Order status updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update status');
    },
  });

  const { data: riders, isLoading: ridersLoading } = useQuery({
    queryKey: ['admin-riders'],
    queryFn: () => adminService.getRiders(),
    enabled: riderModalOrderId != null || riderModalGroupId != null,
  });

  const assignRiderMutation = useMutation({
    mutationFn: async (params: {
      orderId?: number;
      orderGroupId?: string;
      riderId: number;
      isChange: boolean;
      isGroup: boolean;
    }) => {
      const { riderId, isChange, isGroup, orderId, orderGroupId } = params;
      if (isGroup && orderGroupId) {
        if (isChange) return adminService.changeRiderForGroup(orderGroupId, riderId);
        return adminService.assignRiderToGroup(orderGroupId, riderId);
      }
      if (orderId != null) {
        if (isChange) return adminService.changeRider(orderId, riderId);
        return adminService.assignRider(orderId, riderId);
      }
      throw new Error('Missing orderId or orderGroupId');
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      setRiderModalOrderId(null);
      setRiderModalGroupId(null);
      setSelectedRiderId(null);
      toast.success(variables.isGroup ? 'Rider assigned to group' : 'Rider assignment updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to assign rider');
    },
  });

  const setFilter = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    if (value) p.set(key, value);
    else p.delete(key);
    setSearchParams(p);
  };

  const orders = ordersRaw ?? [];

  const groupedByOrderGroup = useMemo(() => {
    const map = new Map<string | null, OrderRow[]>();
    for (const o of orders) {
      const gid = o.order_group_id ?? null;
      if (!map.has(gid)) map.set(gid, []);
      map.get(gid)!.push(o);
    }
    for (const arr of map.values()) {
      arr.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
    }
    return map;
  }, [orders]);

  const displayGroups = useMemo(() => {
    const result: { orderGroupId: string | null; orders: OrderRow[] }[] = [];
    groupedByOrderGroup.forEach((orderList, gid) => {
      result.push({ orderGroupId: gid, orders: orderList });
    });
    result.sort((a, b) => {
      const aFirst = a.orders[0];
      const bFirst = b.orders[0];
      const aId = aFirst?.id ?? 0;
      const bId = bFirst?.id ?? 0;
      return bId - aId;
    });
    return result;
  }, [groupedByOrderGroup]);

  const paginatedDisplayGroups = useMemo(() => {
    const start = (ordersPage - 1) * ORDERS_PAGE_SIZE;
    return displayGroups.slice(start, start + ORDERS_PAGE_SIZE);
  }, [displayGroups, ordersPage]);

  useEffect(() => {
    setOrdersPage(1);
  }, [branchId, status, dateFrom, dateTo]);

  const isSubmitting = assignRiderMutation.isPending || updateStatusMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading orders...'} />;
  }

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Orders</h1>
      </div>

      <Card className="mb-6 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-4 items-end">
          <SearchableSelect
            label="Branch"
            value={branchId}
            onChange={(v) => setFilter('branch_id', v)}
            options={[
              { value: '', label: 'All' },
              ...(branches ?? []).map((b) => ({ value: String(b.id), label: b.name })),
            ]}
            placeholder="All"
            minWidth="min-w-[140px]"
          />
          <SearchableSelect
            label="Status"
            value={status}
            onChange={(v) => setFilter('status', v)}
            options={[
              { value: '', label: 'All' },
              { value: 'placed', label: 'Placed' },
              { value: 'accepted', label: 'Accepted' },
              { value: 'preparing', label: 'Preparing' },
              { value: 'ready', label: 'Ready' },
              { value: 'completed', label: 'Completed' },
              { value: 'cancelled', label: 'Cancelled' },
            ]}
            placeholder="All"
            minWidth="min-w-[120px]"
          />
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Date from</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setFilter('date_from', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-slate-300 mb-1">Date to</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setFilter('date_to', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <ClearFiltersButton onClick={() => setSearchParams({})} />
        </div>
      </Card>

      <div className="w-full space-y-3">
        {displayGroups.length === 0 ? (
          <Card className="dark:bg-slate-800 dark:border-slate-700">
            <p className="text-center text-gray-500 dark:text-slate-400 py-12">No orders found.</p>
          </Card>
        ) : (
          <>
            <AccentedList>
              {paginatedDisplayGroups.map(({ orderGroupId: gid, orders: groupOrders }, i) => {
                const isGroup = gid && groupOrders.length > 1;
                const groupTotal = groupOrders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
                const first = groupOrders[0];
                const branchName = first?.branch?.name ?? '—';
                const sourceSet = new Set(groupOrders.map((o) => o.source ?? 'pos'));
                const sourceLabel = sourceSet.size === 1 ? formatOrderSourceLabel(first?.source) : 'Mixed';
                const statusSet = new Set(groupOrders.map((o) => o.status));
                const orderStatusLabel = statusSet.size === 1
                  ? (ORDER_STATUS_LABELS[first?.status ?? ''] ?? first?.status ?? '—')
                  : 'Mixed';
                const deliveryStatusSet = new Set(groupOrders.map((o) => o.delivery_status ?? '—'));
                const deliveryStatusLabel = deliveryStatusSet.size === 1
                  ? (groupOrders[0].delivery_status
                      ? (DELIVERY_STATUS_LABELS[groupOrders[0].delivery_status] ?? groupOrders[0].delivery_status)
                      : '—')
                  : 'Mixed';
                const allSameRider = isGroup && groupOrders.length > 0 && groupOrders.every((o) => o.rider_id != null && o.rider_id === groupOrders[0].rider_id);
                const groupRider = allSameRider && groupOrders[0].rider ? groupOrders[0].rider : null;
                const groupCanChangeRider = isGroup && groupRider != null && groupOrders.every((o) => o.delivery_status === 'assigned');
                const showPerOrderRiderButton = !(isGroup && groupRider);
                const isDone = orderStatusLabel === 'Completed' || orderStatusLabel === 'Cancelled';
                const title = isGroup ? `Order #${first?.order_number} +${groupOrders.length - 1} more` : `#${first?.order_number}`;
                const subtitle = (
                  <>
                    <p>{branchName} · {formatOrderType(first?.order_type ?? first?.orderType)}</p>
                    {isGroup && groupRider && <p>Rider: {groupRider.name}</p>}
                    <p className="font-semibold text-gray-900 dark:text-slate-100">{formatCurrency(isGroup ? groupTotal : Number(first?.total_amount ?? 0))}</p>
                  </>
                );
                const actions = (
                  <>
                    <span
                      className={[
                        'hidden sm:inline-flex px-2 py-0.5 rounded text-xs font-medium self-center',
                        sourceLabel === 'POS'
                          ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
                          : sourceLabel === 'Consumer app'
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                            : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
                      ].join(' ')}
                      title="Order source"
                    >
                      {sourceLabel}
                    </span>
                    {isGroup && gid && (
                      <>
                        {groupRider ? groupCanChangeRider && (
                          <Button size="small" variant="edit" onClick={() => { setRiderModalGroupId(gid); setRiderModalOrderId(null); setRiderModalIsChange(true); setSelectedRiderId(groupOrders[0].rider_id ?? null); }}>Change rider</Button>
                        ) : (
                          <Button size="small" variant="primary" onClick={() => { setRiderModalGroupId(gid); setRiderModalOrderId(null); setRiderModalIsChange(false); setSelectedRiderId(null); }}>Assign rider to group</Button>
                        )}
                        <Button size="small" variant="view" onClick={() => { setCustomerInvoiceGroupId(gid); setCustomerInvoiceOrderId(null); }}>Customer invoice</Button>
                      </>
                    )}
                  </>
                );
                const footer = (
                  <ul className="divide-y divide-gray-100 dark:divide-slate-600">
                    {groupOrders.map((order) => (
                      <li key={order.id} className="px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3 hover:bg-gray-50/50 dark:hover:bg-slate-600/30 transition-colors">
                        <div className="flex items-center gap-3">
                          <Link to={`/admin/orders/${order.id}`} className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                            #{order.order_number} {order.brand?.name ? `· ${order.brand.name}` : ''}
                          </Link>
                          <span className="text-sm text-gray-500 dark:text-slate-400">{formatCurrency(Number(order.total_amount ?? 0))}</span>
                        </div>
                        <div className="flex flex-wrap gap-3 items-center">
                          {showPerOrderRiderButton && (order.rider_id != null && order.rider) && (
                            <span className="text-xs text-gray-500 dark:text-slate-400">Rider: {order.rider.name}</span>
                          )}
                          {showPerOrderRiderButton && (order.delivery_status === 'assigned' || order.delivery_status == null) && (
                            <Button size="small" variant={order.rider_id ? 'edit' : 'primary'} onClick={() => { setRiderModalOrderId(order.id); setRiderModalGroupId(null); setRiderModalIsChange(!!order.rider_id); setSelectedRiderId(order.rider_id ?? null); }}>{order.rider_id ? 'Change rider' : 'Assign rider'}</Button>
                          )}
                          <span className="flex items-center gap-1.5 text-sm">
                            <span className="text-gray-500 dark:text-slate-400 font-medium">Order:</span>
                            <select value={order.status} onChange={(e) => updateStatusMutation.mutate({ id: order.id, status: e.target.value })} className="px-3 py-1.5 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg text-sm focus:ring-2 focus:ring-blue-500">
                              <option value="placed">Placed</option>
                              <option value="accepted">Accepted</option>
                              <option value="preparing">Preparing</option>
                              <option value="ready">Ready</option>
                              <option value="completed">Completed</option>
                              <option value="cancelled">Cancelled</option>
                            </select>
                          </span>
                          <span className="flex items-center gap-1.5 text-sm">
                            <span className="text-gray-500 dark:text-slate-400 font-medium">Delivery:</span>
                            <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-xs font-medium">
                              {order.delivery_status ? (DELIVERY_STATUS_LABELS[order.delivery_status] ?? order.delivery_status) : '—'}
                            </span>
                          </span>
                          <Link to={`/admin/orders/${order.id}`}><Button size="small" variant="view">View</Button></Link>
                          <Button size="small" variant="view" onClick={() => { if (order.order_group_id) { setCustomerInvoiceGroupId(order.order_group_id); setCustomerInvoiceOrderId(null); } else { setCustomerInvoiceOrderId(order.id); setCustomerInvoiceGroupId(null); } }}>Customer invoice</Button>
                        </div>
                      </li>
                    ))}
                  </ul>
                );
                return (
                  <AccentedListRow
                    key={gid ?? `single-${first?.id}`}
                    accent={isDone ? 'inactive' : 'active'}
                    initial={(first?.order_number ?? '#').charAt(0)}
                    title={title}
                    subtitle={subtitle}
                    orderStatusLabel={orderStatusLabel}
                    deliveryStatusLabel={deliveryStatusLabel ?? undefined}
                    statusVariant={isDone ? 'inactive' : 'active'}
                    animationIndex={i}
                    actions={actions}
                    footer={footer}
                  />
                );
              })}
            </AccentedList>
            <PaginationBar totalCount={displayGroups.length} page={ordersPage} pageSize={ORDERS_PAGE_SIZE} onPageChange={setOrdersPage} itemLabel="orders" />
          </>
        )}
      </div>

      <CustomerInvoiceModal
        isOpen={!!customerInvoiceGroupId || !!customerInvoiceOrderId}
        onClose={() => {
          setCustomerInvoiceGroupId(null);
          setCustomerInvoiceOrderId(null);
        }}
        orderGroupId={customerInvoiceGroupId}
        orderId={customerInvoiceOrderId}
      />

      {(riderModalOrderId != null || riderModalGroupId != null) && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <Card className="w-full max-w-md p-6 dark:bg-slate-800 dark:border-slate-700">
            <h3 className="text-lg font-semibold text-gray-800 dark:text-slate-100 mb-2">
              {riderModalGroupId
                ? (riderModalIsChange ? 'Change rider for group' : 'Assign rider to group')
                : (riderModalIsChange ? 'Change rider' : 'Assign rider')}
            </h3>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-4">
              {riderModalGroupId
                ? `Group ${riderModalGroupId.slice(0, 8)}… (all orders in this group)`
                : `Order #${orders.find((o) => o.id === riderModalOrderId)?.order_number ?? riderModalOrderId}`}
            </p>
            {ridersLoading ? (
              <p className="text-gray-500 dark:text-slate-400">Loading riders...</p>
            ) : (
              <select
                value={selectedRiderId ?? ''}
                onChange={(e) => setSelectedRiderId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500 mb-4"
              >
                <option value="">Select a rider</option>
                {(riders ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {(r.rating_count ?? 0) > 0 && r.rating_average != null
                      ? ` · ${r.rating_average.toFixed(1)}/5 (${r.rating_count})`
                      : ''}
                    {r.phone ? ` · ${r.phone}` : ''}
                  </option>
                ))}
              </select>
            )}
            {riders != null && riders.length === 0 && !ridersLoading && (
              <p className="text-amber-600 dark:text-amber-400 text-sm mb-4">
                No riders found. Add users with the Rider role in Branch Users.
              </p>
            )}
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => {
                  setRiderModalOrderId(null);
                  setRiderModalGroupId(null);
                  setSelectedRiderId(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                disabled={selectedRiderId == null || assignRiderMutation.isPending}
                isLoading={assignRiderMutation.isPending}
                onClick={() => {
                  if (selectedRiderId != null) {
                    assignRiderMutation.mutate({
                      orderId: riderModalOrderId ?? undefined,
                      orderGroupId: riderModalGroupId ?? undefined,
                      riderId: selectedRiderId,
                      isChange: riderModalIsChange,
                      isGroup: riderModalGroupId != null,
                    });
                  }
                }}
              >
                {riderModalIsChange ? 'Change' : 'Assign'}
              </Button>
            </div>
          </Card>
        </div>
      )}
    </div>
  );
};

export default Orders;
