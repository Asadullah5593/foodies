import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { riderService, RiderOrder } from '../../services/api/riderService';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import { formatCurrency } from '../../utils/currency';

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  assigned: 'Assigned',
  accepted: 'Accepted',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  delivery_failed: 'Delivery Failed',
};

const RiderDashboard: React.FC = () => {
  const { data: orders, isLoading } = useQuery({
    queryKey: ['rider-orders'],
    queryFn: () => riderService.getOrders(),
  });

  const list = orders ?? [];

  const displayGroups = useMemo(() => {
    const byGroup = new Map<string | null, RiderOrder[]>();
    for (const o of list) {
      const gid = o.order_group_id ?? null;
      if (!byGroup.has(gid)) byGroup.set(gid, []);
      byGroup.get(gid)!.push(o);
    }
    const result: { orderGroupId: string | null; orders: RiderOrder[] }[] = [];
    byGroup.forEach((orderList, gid) => {
      const sorted = [...orderList].sort(
        (a, b) =>
          new Date(b.placed_at ?? 0).getTime() -
          new Date(a.placed_at ?? 0).getTime()
      );
      result.push({ orderGroupId: gid, orders: sorted });
    });
    result.sort((a, b) => {
      const aFirst = a.orders[0]?.placed_at;
      const bFirst = b.orders[0]?.placed_at;
      return (
        new Date(bFirst ?? 0).getTime() - new Date(aFirst ?? 0).getTime()
      );
    });
    return result;
  }, [list]);

  if (isLoading) return <Loader fullScreen text="Loading your deliveries..." />;

  return (
    <div className="p-6 max-w-2xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-800">My Deliveries</h1>
        <p className="text-gray-500 text-sm mt-1">
          Orders assigned to you. Grouped orders are from the same customer — tap to view details and update status.
        </p>
      </div>

      {displayGroups.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-gray-500">No orders assigned to you yet.</p>
          <p className="text-gray-400 text-sm mt-2">
            When an order is assigned to you, it will appear here.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {displayGroups.map(({ orderGroupId: gid, orders: groupOrders }) => {
            const isGroup = gid && groupOrders.length > 1;
            const first = groupOrders[0];
            const groupTotal = groupOrders.reduce(
              (s, o) => s + Number(o.total_amount ?? 0),
              0
            );
            const statusSet = new Set(
              groupOrders.map((o) => o.delivery_status ?? 'assigned')
            );
            const statusLabel =
              statusSet.size === 1
                ? (DELIVERY_STATUS_LABELS[first?.delivery_status ?? ''] ??
                    first?.delivery_status ??
                    'Assigned')
                : 'Mixed';
            const deliveryAddress = first?.delivery_address ?? null;
            const placedAt = first?.placed_at ?? null;

            return (
              <Card
                key={gid ?? `single-${first?.id}`}
                className="overflow-hidden border border-gray-100 shadow-sm hover:shadow-md transition-shadow"
              >
                <div className="bg-gradient-to-r from-gray-50 to-white px-4 py-3 border-b border-gray-100">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {isGroup ? (
                        <>
                          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium bg-indigo-100 text-indigo-800">
                            Group · {groupOrders.length} orders
                          </span>
                          {gid && (
                            <span className="text-xs font-mono text-gray-500">
                              {gid.slice(0, 8)}…
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="font-semibold text-gray-900">
                          #{first?.order_number}
                          {first?.brand_name && (
                            <span className="text-gray-500 font-normal text-sm ml-1">
                              · {first.brand_name}
                            </span>
                          )}
                        </span>
                      )}
                      <span
                        className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          statusLabel === 'Delivered' || statusLabel === 'delivered'
                            ? 'bg-emerald-100 text-emerald-800'
                            : statusLabel === 'Delivery Failed' ||
                              statusLabel === 'delivery_failed'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {statusLabel}
                      </span>
                    </div>
                    <span className="text-lg font-bold text-gray-900">
                      {formatCurrency(isGroup ? groupTotal : Number(first?.total_amount ?? 0))}
                    </span>
                  </div>
                  {deliveryAddress && (
                    <p className="text-sm text-gray-600 mt-1.5 truncate">
                      📍 {deliveryAddress}
                    </p>
                  )}
                  {placedAt && (
                    <p className="text-xs text-gray-500 mt-0.5">
                      {new Date(placedAt).toLocaleString()}
                    </p>
                  )}
                </div>
                <div className="divide-y divide-gray-50">
                  {groupOrders.map((order) => (
                    <Link
                      key={order.id}
                      to={`/rider/orders/${order.id}`}
                      className="block px-4 py-3 hover:bg-gray-50/70 transition-colors"
                    >
                      <div className="flex justify-between items-center">
                        <span className="text-sm font-medium text-blue-600 hover:underline">
                          #{order.order_number}
                          {order.brand_name && (
                            <span className="text-gray-500 font-normal ml-1">
                              · {order.brand_name}
                            </span>
                          )}
                        </span>
                        <span className="text-sm text-gray-600">
                          {formatCurrency(order.total_amount)}
                        </span>
                      </div>
                    </Link>
                  ))}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default RiderDashboard;
