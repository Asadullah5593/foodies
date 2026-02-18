import React, { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { adminService } from '../../services/api/adminService';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import { formatCurrency } from '../../utils/currency';

type OrderRow = {
  id: number;
  order_number?: string;
  orderNumber?: string;
  total_amount?: number;
  totalAmount?: number;
  order_group_id?: string | null;
  branch?: { id: number; name: string; code: string };
  brand?: { id: number; name: string };
  rider_id?: number | null;
  rider?: { id: number; name: string } | null;
  delivery_status?: string | null;
  delivery_failed_reason?: string | null;
  delivery_address?: string | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  placed_at?: string | null;
  placedAt?: string | null;
};

const DELIVERY_STATUS_LABELS: Record<string, string> = {
  assigned: 'Assigned',
  accepted: 'Accepted',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  delivery_failed: 'Failed',
};

function normalizeOrder(o: OrderRow): OrderRow {
  const row = o as OrderRow & { riderId?: number; deliveryStatus?: string };
  return {
    ...o,
    order_number: o.order_number ?? o.orderNumber,
    total_amount: o.total_amount ?? o.totalAmount ?? 0,
    rider_id: o.rider_id ?? row.riderId ?? null,
    rider: o.rider ?? null,
    delivery_status: o.delivery_status ?? row.deliveryStatus ?? null,
    delivery_failed_reason: o.delivery_failed_reason ?? null,
    placed_at: o.placed_at ?? o.placedAt ?? null,
  };
}

const Deliveries: React.FC = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const dateFrom = searchParams.get('date_from') || '';
  const dateTo = searchParams.get('date_to') || '';

  const setFilter = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    if (value) p.set(key, value);
    else p.delete(key);
    setSearchParams(p);
  };

  const params = useMemo(
    () => ({
      has_rider: true as const,
      ...(dateFrom && { date_from: dateFrom }),
      ...(dateTo && { date_to: dateTo }),
    }),
    [dateFrom, dateTo]
  );

  const { data: ordersRaw, isLoading } = useQuery({
    queryKey: ['admin-orders-deliveries', params],
    queryFn: async () => {
      const data = await adminService.getOrders({
        has_rider: true,
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo }),
      });
      return (Array.isArray(data) ? data : []).map(normalizeOrder) as OrderRow[];
    },
  });

  const orders = ordersRaw ?? [];

  const byRider = useMemo(() => {
    const map = new Map<number, { riderName: string; orders: OrderRow[] }>();
    for (const o of orders) {
      const riderId = o.rider_id ?? 0;
      const riderName = o.rider?.name ?? `Rider #${riderId}`;
      if (!map.has(riderId)) map.set(riderId, { riderName, orders: [] });
      map.get(riderId)!.orders.push(o);
    }
    const result = Array.from(map.entries()).map(([riderId, { riderName, orders: list }]) => ({
      riderId,
      riderName,
      orders: list.sort(
        (a, b) =>
          new Date(b.placed_at ?? 0).getTime() - new Date(a.placed_at ?? 0).getTime()
      ),
    }));
    result.sort((a, b) => {
      const aFirst = a.orders[0]?.placed_at;
      const bFirst = b.orders[0]?.placed_at;
      return new Date(bFirst ?? 0).getTime() - new Date(aFirst ?? 0).getTime();
    });
    return result;
  }, [orders]);

  if (isLoading) return <Loader fullScreen text="Loading deliveries..." />;

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-3xl font-bold text-gray-800">Deliveries</h1>
          <p className="text-gray-500 text-sm mt-1">
            See which rider is handling which orders and their delivery status.
          </p>
        </div>
        <div className="flex gap-2 items-center">
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setFilter('date_from', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
          <span className="text-gray-400">to</span>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setFilter('date_to', e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm"
          />
        </div>
      </div>

      {byRider.length === 0 ? (
        <Card className="p-12 text-center">
          <p className="text-gray-500">No deliveries assigned to riders yet.</p>
          <p className="text-gray-400 text-sm mt-2">
            Assign riders from the Orders page; they will appear here.
          </p>
        </Card>
      ) : (
        <div className="space-y-6">
          {byRider.map(({ riderId, riderName, orders: riderOrders }) => (
            <Card
              key={riderId}
              className="overflow-hidden border border-gray-100 shadow-sm"
            >
              <div className="bg-indigo-50 px-4 py-3 border-b border-indigo-100">
                <h2 className="text-lg font-semibold text-gray-800">
                  🛵 {riderName}
                </h2>
                <p className="text-sm text-gray-500 mt-0.5">
                  {riderOrders.length} order{riderOrders.length !== 1 ? 's' : ''} assigned
                </p>
              </div>
              <ul className="divide-y divide-gray-100">
                {riderOrders.map((order) => (
                  <li key={order.id} className="px-4 py-3 hover:bg-gray-50/50">
                    <Link
                      to={`/admin/orders/${order.id}`}
                      className="flex flex-wrap items-center justify-between gap-2"
                    >
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-blue-600 hover:underline">
                          #{order.order_number}
                        </span>
                        {order.brand?.name && (
                          <span className="text-gray-500 text-sm">
                            · {order.brand.name}
                          </span>
                        )}
                        {order.delivery_address && (
                          <span className="text-gray-500 text-sm truncate max-w-[200px]">
                            · {order.delivery_address}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                            order.delivery_status === 'delivered'
                              ? 'bg-emerald-100 text-emerald-800'
                              : order.delivery_status === 'delivery_failed'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-amber-100 text-amber-800'
                          }`}
                        >
                          {DELIVERY_STATUS_LABELS[order.delivery_status ?? ''] ??
                            order.delivery_status ??
                            'Assigned'}
                        </span>
                        <span className="text-sm font-medium text-gray-700">
                          {formatCurrency(Number(order.total_amount ?? 0))}
                        </span>
                      </div>
                    </Link>
                    {order.placed_at && (
                      <p className="text-xs text-gray-400 mt-1">
                        Placed {new Date(order.placed_at).toLocaleString()}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
};

export default Deliveries;
