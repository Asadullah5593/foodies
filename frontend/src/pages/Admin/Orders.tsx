import React, { useMemo, useState } from 'react';
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
import Card from '../../components/Card';
import CustomerInvoiceModal from '../../components/CustomerInvoiceModal';

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
  };
}

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  assigned: 'Assigned',
  accepted: 'Accepted',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  delivery_failed: 'Failed',
};

const Orders: React.FC = () => {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
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

  if (isLoading) return <Loader fullScreen text="Loading orders..." />;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <h1 className="text-3xl font-bold text-gray-800">Orders</h1>
      </div>

      <Card className="mb-6 p-4">
        <div className="flex flex-wrap gap-4 items-end">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Branch</label>
            <select
              value={branchId}
              onChange={(e) => setFilter('branch_id', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[140px]"
            >
              <option value="">All</option>
              {branches?.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
            <select
              value={status}
              onChange={(e) => setFilter('status', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 min-w-[120px]"
            >
              <option value="">All</option>
              <option value="placed">Placed</option>
              <option value="accepted">Accepted</option>
              <option value="preparing">Preparing</option>
              <option value="ready">Ready</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date from</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setFilter('date_from', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Date to</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setFilter('date_to', e.target.value)}
              className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <ClearFiltersButton onClick={() => setSearchParams({})} />
        </div>
      </Card>

      <div className="space-y-4">
        {displayGroups.length === 0 ? (
          <Card className="p-12 text-center">
            <p className="text-gray-500">No orders found.</p>
          </Card>
        ) : (
          displayGroups.map(({ orderGroupId: gid, orders: groupOrders }) => {
            const isGroup = gid && groupOrders.length > 1;
            const groupTotal = groupOrders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
            const first = groupOrders[0];
            const branchName = first?.branch?.name ?? '—';
            const statusSet = new Set(groupOrders.map((o) => o.status));
            const statusLabel = statusSet.size === 1 ? first?.status : 'Mixed';
            const allSameRider =
              isGroup &&
              groupOrders.length > 0 &&
              groupOrders.every(
                (o) =>
                  o.rider_id != null &&
                  o.rider_id === groupOrders[0].rider_id
              );
            const groupRider = allSameRider && groupOrders[0].rider ? groupOrders[0].rider : null;
            const groupCanChangeRider =
              isGroup &&
              groupRider != null &&
              groupOrders.every((o) => o.delivery_status === 'assigned');
            const showPerOrderRiderButton = !(isGroup && groupRider);

            return (
              <Card
                key={gid ?? `single-${first?.id}`}
                className="overflow-hidden shadow-md hover:shadow-lg transition-shadow border border-gray-100"
              >
                <div className="bg-gradient-to-r from-gray-50 to-white px-5 py-4 border-b border-gray-100">
                  <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="flex flex-wrap items-center gap-3">
                      {isGroup ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                            Group · {groupOrders.length} orders
                          </span>
                          <span className="text-sm font-mono text-gray-500">{gid?.slice(0, 8)}…</span>
                        </>
                      ) : (
                        <Link
                          to={`/admin/orders/${first?.id}`}
                          className="text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors"
                        >
                          #{first?.order_number}
                        </Link>
                      )}
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                        statusLabel === 'completed' ? 'bg-emerald-100 text-emerald-800' :
                        statusLabel === 'cancelled' ? 'bg-red-100 text-red-800' :
                        'bg-sky-100 text-sky-800'
                      }`}>
                        {statusLabel}
                      </span>
                      <span className="text-sm text-gray-500">{branchName}</span>
                      <span className="text-sm text-gray-500">· {formatOrderType(first?.order_type ?? first?.orderType)}</span>
                      {isGroup && groupRider && (
                        <span className="text-xs text-gray-500">
                          Rider: {groupRider.name}
                          {groupOrders[0].delivery_status && (
                            <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-100">
                              {DELIVERY_STATUS_LABELS[groupOrders[0].delivery_status ?? ''] ?? groupOrders[0].delivery_status}
                            </span>
                          )}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      {isGroup && gid && (
                        <>
                          {groupRider ? (
                            groupCanChangeRider && (
                              <Button
                                size="small"
                                variant="outline"
                                onClick={() => {
                                  setRiderModalGroupId(gid);
                                  setRiderModalOrderId(null);
                                  setRiderModalIsChange(true);
                                  setSelectedRiderId(groupOrders[0].rider_id ?? null);
                                }}
                              >
                                Change rider
                              </Button>
                            )
                          ) : (
                            <Button
                              size="small"
                              variant="outline"
                              onClick={() => {
                                setRiderModalGroupId(gid);
                                setRiderModalOrderId(null);
                                setRiderModalIsChange(false);
                                setSelectedRiderId(null);
                              }}
                            >
                              Assign rider to group
                            </Button>
                          )}
                          <Button
                            size="small"
                            variant="outline"
                            onClick={() => {
                              setCustomerInvoiceGroupId(gid);
                              setCustomerInvoiceOrderId(null);
                            }}
                          >
                            Customer invoice
                          </Button>
                        </>
                      )}
                      <span className="text-xl font-bold text-gray-900">
                        {formatCurrency(isGroup ? groupTotal : Number(first?.total_amount ?? 0))}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="divide-y divide-gray-50">
                  {groupOrders.map((order) => (
                    <div
                      key={order.id}
                      className="px-5 py-3 flex flex-wrap items-center justify-between gap-3 bg-white hover:bg-gray-50/50 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Link
                          to={`/admin/orders/${order.id}`}
                          className="font-medium text-blue-600 hover:underline"
                        >
                          #{order.order_number} {order.brand?.name ? `· ${order.brand.name}` : ''}
                        </Link>
                        <span className="text-sm text-gray-500">
                          {formatCurrency(Number(order.total_amount ?? 0))}
                        </span>
                      </div>
                      <div className="flex flex-wrap gap-2 items-center">
                        {showPerOrderRiderButton && (order.rider_id != null && order.rider) && (
                          <span className="text-xs text-gray-500">
                            Rider: {order.rider.name}
                            {order.delivery_status && (
                              <span className="ml-1 px-1.5 py-0.5 rounded bg-gray-100">
                                {DELIVERY_STATUS_LABELS[order.delivery_status] ?? order.delivery_status}
                              </span>
                            )}
                          </span>
                        )}
                        {showPerOrderRiderButton && (order.delivery_status === 'assigned' || order.delivery_status == null) && (
                          <Button
                            size="small"
                            variant="outline"
                            onClick={() => {
                              setRiderModalOrderId(order.id);
                              setRiderModalGroupId(null);
                              setRiderModalIsChange(!!order.rider_id);
                              setSelectedRiderId(order.rider_id ?? null);
                            }}
                          >
                            {order.rider_id ? 'Change rider' : 'Assign rider'}
                          </Button>
                        )}
                        <select
                          value={order.status}
                          onChange={(e) => updateStatusMutation.mutate({ id: order.id, status: e.target.value })}
                          className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                        >
                          <option value="placed">Placed</option>
                          <option value="accepted">Accepted</option>
                          <option value="preparing">Preparing</option>
                          <option value="ready">Ready</option>
                          <option value="completed">Completed</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                        <Link to={`/admin/orders/${order.id}`}>
                          <Button size="small" variant="outline">View</Button>
                        </Link>
                        <Button
                          size="small"
                          variant="outline"
                          onClick={() => {
                            if (order.order_group_id) {
                              setCustomerInvoiceGroupId(order.order_group_id);
                              setCustomerInvoiceOrderId(null);
                            } else {
                              setCustomerInvoiceOrderId(order.id);
                              setCustomerInvoiceGroupId(null);
                            }
                          }}
                        >
                          Customer invoice
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            );
          })
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
          <Card className="w-full max-w-md p-6">
            <h3 className="text-lg font-semibold text-gray-800 mb-2">
              {riderModalGroupId
                ? (riderModalIsChange ? 'Change rider for group' : 'Assign rider to group')
                : (riderModalIsChange ? 'Change rider' : 'Assign rider')}
            </h3>
            <p className="text-sm text-gray-500 mb-4">
              {riderModalGroupId
                ? `Group ${riderModalGroupId.slice(0, 8)}… (all orders in this group)`
                : `Order #${orders.find((o) => o.id === riderModalOrderId)?.order_number ?? riderModalOrderId}`}
            </p>
            {ridersLoading ? (
              <p className="text-gray-500">Loading riders...</p>
            ) : (
              <select
                value={selectedRiderId ?? ''}
                onChange={(e) => setSelectedRiderId(e.target.value ? Number(e.target.value) : null)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 mb-4"
              >
                <option value="">Select a rider</option>
                {(riders ?? []).map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name} {r.phone ? `· ${r.phone}` : ''}
                  </option>
                ))}
              </select>
            )}
            {riders != null && riders.length === 0 && !ridersLoading && (
              <p className="text-amber-600 text-sm mb-4">
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
