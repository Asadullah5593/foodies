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
import AssignRiderModal from '../../components/AssignRiderModal';
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
  const row = o as OrderRow & { riderId?: number; brandId?: number; deliveryStatus?: string; deliveryFailedReason?: string };
  return {
    ...o,
    order_number: o.order_number ?? o.orderNumber,
    total_amount: o.total_amount ?? o.totalAmount ?? 0,
    order_group_id: o.order_group_id ?? o.orderGroupId ?? null,
    order_type: o.order_type ?? o.orderType,
    // /admin/orders returns raw entities (camelCase + nested brand), never brand_id.
    // Without this the rider dropdown drops its brand filter and lists every rider.
    brand_id: o.brand_id ?? row.brandId ?? o.brand?.id ?? null,
    brand_name: o.brand_name ?? o.brand?.name ?? null,
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

function localDateYYYYMMDD(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getOrderType(o: OrderRow): string {
  return String(o.order_type ?? o.orderType ?? '').trim();
}

function isDeliveryOrder(o: OrderRow): boolean {
  return getOrderType(o) === 'delivery';
}

const Orders: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [ordersPage, setOrdersPage] = useState(1);
  const [customerInvoiceGroupId, setCustomerInvoiceGroupId] = useState<string | null>(null);
  const [customerInvoiceOrderId, setCustomerInvoiceOrderId] = useState<number | null>(null);
  const [riderModalOrderId, setRiderModalOrderId] = useState<number | null>(null);
  const [riderModalGroupId, setRiderModalGroupId] = useState<string | null>(null);
  const [riderModalIsChange, setRiderModalIsChange] = useState(false);
  const [riderModalBrandId, setRiderModalBrandId] = useState<number | null>(null);
  const [riderModalBrandName, setRiderModalBrandName] = useState<string | null>(null);
  const [selectedRiderId, setSelectedRiderId] = useState<number | null>(null);
  const branchId = searchParams.get('branch_id') || '';
  const brandId = searchParams.get('brand_id') || '';
  const status = searchParams.get('status') || '';
  const orderType = searchParams.get('order_type') || '';
  const defaultToday = localDateYYYYMMDD();
  const dateFrom = searchParams.get('date_from') || defaultToday;
  const dateTo = searchParams.get('date_to') || defaultToday;

  const params = {
    ...(branchId && { branch_id: +branchId }),
    ...(brandId && { brand_id: +brandId }),
    ...(status && { status }),
    ...(orderType && { order_type: orderType }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  };

  const { data: ordersRaw, isLoading } = useQuery({
    queryKey: ['admin-orders', params],
    queryFn: async () => {
      const search = new URLSearchParams();
      if (params.branch_id) search.append('branch_id', String(params.branch_id));
      if (params.brand_id) search.append('brand_id', String(params.brand_id));
      if (params.status) search.append('status', params.status);
      if (params.order_type) search.append('order_type', params.order_type);
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

  // Brand filter (owner sees all; brand-locked users get only their brand back)
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<{ id: number; name: string }[]>('/admin/brands');
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

  const closeRiderModal = () => {
    setRiderModalOrderId(null);
    setRiderModalGroupId(null);
    setRiderModalBrandId(null);
    setRiderModalBrandName(null);
    setSelectedRiderId(null);
  };

  const { data: onDutyRiders } = useQuery({
    queryKey: ['rider-on-duty-banner'],
    queryFn: () => adminService.getOnDutyRiders(),
    refetchInterval: ORDER_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
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
      closeRiderModal();
      toast.success(variables.isGroup ? 'Rider assigned to group' : 'Rider assignment updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to assign rider');
    },
  });

  const retryAutoAssignMutation = useMutation({
    mutationFn: (orderId: number) => adminService.retryAutoAssignOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      toast.success('Automatic rider assignment retried');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to retry automatic assignment');
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
  }, [branchId, status, orderType, dateFrom, dateTo]);

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
            label="Brand"
            value={brandId}
            onChange={(v) => setFilter('brand_id', v)}
            options={[
              { value: '', label: 'All' },
              ...(brands ?? []).map((b) => ({ value: String(b.id), label: b.name })),
            ]}
            placeholder="All"
            minWidth="min-w-[140px]"
          />
          <SearchableSelect
            label="Order type"
            value={orderType}
            onChange={(v) => setFilter('order_type', v)}
            options={[
              { value: '', label: 'All' },
              { value: 'delivery', label: 'Delivery' },
              { value: 'dine_in', label: 'Dine in' },
              { value: 'takeaway', label: 'Takeaway' },
            ]}
            placeholder="All"
            minWidth="min-w-[130px]"
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
          <ClearFiltersButton
            onClick={() => {
              const t = localDateYYYYMMDD();
              setSearchParams({ date_from: t, date_to: t });
            }}
          />
        </div>
      </Card>

      <Card className="mb-6 p-4 border-blue-200 dark:border-slate-700 dark:bg-slate-800">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h2 className="text-base font-semibold text-gray-800 dark:text-slate-100">
              Automatic Rider Assignment
            </h2>
            <p className="text-sm text-gray-600 dark:text-slate-300 mt-1">
              Delivery orders get a rider automatically when the kitchen status moves to <strong>Preparing</strong> from Placed or Accepted (Admin or KDS). Riders need an HR profile, check-in, fresh heartbeat/location, and the branch needs coordinates plus delivery radius.
            </p>
            <p className="text-sm text-gray-500 dark:text-slate-400 mt-1">
              Riders currently on duty: <span className="font-semibold text-gray-800 dark:text-slate-100">{onDutyRiders?.length ?? 0}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link to="/admin/rider-hrm">
              <Button size="small" variant="outline">Open Rider HRM</Button>
            </Link>
            <Link to="/admin/branches">
              <Button size="small" variant="outline">Configure Branch Radius</Button>
            </Link>
          </div>
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
                const allDelivery = groupOrders.every((o) => isDeliveryOrder(o));
                const allSameRider = isGroup && groupOrders.length > 0 && groupOrders.every((o) => o.rider_id != null && o.rider_id === groupOrders[0].rider_id);
                const groupRider = allSameRider && groupOrders[0].rider ? groupOrders[0].rider : null;
                const groupCanChangeRider = allDelivery && isGroup && groupRider != null && groupOrders.every((o) => o.delivery_status === 'accepted');
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
                    {isGroup && gid && allDelivery && (
                      <>
                        {groupRider ? groupCanChangeRider && (
                          <Button size="small" variant="edit" onClick={() => { setRiderModalGroupId(gid); setRiderModalOrderId(null); setRiderModalIsChange(true); setRiderModalBrandId(groupOrders[0].brand_id ?? null); setRiderModalBrandName(groupOrders[0].brand_name ?? groupOrders[0].brand?.name ?? null); setSelectedRiderId(groupOrders[0].rider_id ?? null); }}>Change rider</Button>
                        ) : (
                          <Button size="small" variant="primary" onClick={() => { setRiderModalGroupId(gid); setRiderModalOrderId(null); setRiderModalIsChange(false); setRiderModalBrandId(groupOrders[0].brand_id ?? null); setRiderModalBrandName(groupOrders[0].brand_name ?? groupOrders[0].brand?.name ?? null); setSelectedRiderId(null); }}>Assign rider to group</Button>
                        )}
                        <Button size="small" variant="view" onClick={() => { setCustomerInvoiceGroupId(gid); setCustomerInvoiceOrderId(null); }}>Customer invoice</Button>
                      </>
                    )}
                    {isGroup && gid && !allDelivery && (
                      <Button size="small" variant="view" onClick={() => { setCustomerInvoiceGroupId(gid); setCustomerInvoiceOrderId(null); }}>Customer invoice</Button>
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
                          {showPerOrderRiderButton && isDeliveryOrder(order) && order.rider_id != null && order.rider && (
                            <span className="text-xs text-gray-500 dark:text-slate-400">Rider: {order.rider.name}</span>
                          )}
                          {showPerOrderRiderButton && isDeliveryOrder(order) && (order.delivery_status === 'accepted' || order.delivery_status == null) && (
                            <Button size="small" variant={order.rider_id ? 'edit' : 'primary'} onClick={() => { setRiderModalOrderId(order.id); setRiderModalGroupId(null); setRiderModalIsChange(!!order.rider_id); setRiderModalBrandId(order.brand_id ?? null); setRiderModalBrandName(order.brand_name ?? order.brand?.name ?? null); setSelectedRiderId(order.rider_id ?? null); }}>{order.rider_id ? 'Change rider' : 'Assign rider'}</Button>
                          )}
                          {!order.rider_id && isDeliveryOrder(order) && (
                            <Button
                              size="small"
                              variant="outline"
                              isLoading={retryAutoAssignMutation.isPending}
                              onClick={() => retryAutoAssignMutation.mutate(order.id)}
                            >
                              Retry auto-assign
                            </Button>
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
                          {isDeliveryOrder(order) && (
                          <span className="flex items-center gap-1.5 text-sm">
                            <span className="text-gray-500 dark:text-slate-400 font-medium">Delivery:</span>
                            <span className="px-2 py-0.5 rounded bg-slate-200 dark:bg-slate-600 text-xs font-medium">
                              {order.delivery_status ? (DELIVERY_STATUS_LABELS[order.delivery_status] ?? order.delivery_status) : '—'}
                            </span>
                          </span>
                          )}
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

      <AssignRiderModal
        isOpen={riderModalOrderId != null || riderModalGroupId != null}
        onClose={closeRiderModal}
        title={
          riderModalGroupId
            ? (riderModalIsChange ? 'Change rider for group' : 'Assign rider to group')
            : (riderModalIsChange ? 'Change rider' : 'Assign rider')
        }
        subject={
          riderModalGroupId
            ? `Group ${riderModalGroupId.slice(0, 8)}… (all orders in this group)`
            : `Order #${orders.find((o) => o.id === riderModalOrderId)?.order_number ?? riderModalOrderId}`
        }
        confirmLabel={riderModalIsChange ? 'Change' : 'Assign'}
        brandId={riderModalBrandId}
        brandName={riderModalBrandName}
        selectedRiderId={selectedRiderId}
        onSelectRider={setSelectedRiderId}
        isPending={assignRiderMutation.isPending}
        onConfirm={() => {
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
      />
    </div>
  );
};

export default Orders;
