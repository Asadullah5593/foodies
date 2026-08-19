import React, { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, keepPreviousData } from '@tanstack/react-query';
import { adminService } from '../../services/api/adminService';
import Loader from '../../components/Loader';
import FetchingOverlay from '../../components/FetchingOverlay';
import Card from '../../components/Card';
import ClearFiltersButton from '../../components/ClearFiltersButton';
import SearchableSelect from '../../components/SearchableSelect';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import { formatCurrency } from '../../utils/currency';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';
import { deliveryStatusLabel } from '../../lib/deliveryStatus';
import { useResultsRefreshing } from '../../components/useResultsRefreshing';

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
  const [page, setPage] = useState(1);
  const riderId = searchParams.get('rider_id') || '';
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

  const deliveriesKey = ['admin-orders-deliveries', params];
  const { data: ordersRaw, isLoading, isFetching } = useQuery({
    queryKey: deliveriesKey,
    queryFn: async () => {
      const data = await adminService.getOrders({
        has_rider: true,
        ...(dateFrom && { date_from: dateFrom }),
        ...(dateTo && { date_to: dateTo }),
      });
      return (Array.isArray(data) ? data : []).map(normalizeOrder) as OrderRow[];
    },
    placeholderData: keepPreviousData,
    refetchInterval: ORDER_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });
  const deliveriesRefreshing = useResultsRefreshing(deliveriesKey, isFetching);

  const { data: riders } = useQuery({
    queryKey: ['admin-riders'],
    queryFn: () => adminService.getRiders(),
  });

  const riderRatingById = useMemo(() => {
    const m = new Map<number, { rating_average: number | null; rating_count: number }>();
    for (const r of riders ?? []) {
      m.set(r.id, {
        rating_average: r.rating_average ?? null,
        rating_count: r.rating_count ?? 0,
      });
    }
    return m;
  }, [riders]);

  const orders = ordersRaw ?? [];

  const ordersFilteredByRider = useMemo(() => {
    if (!riderId) return orders;
    const id = parseInt(riderId, 10);
    if (Number.isNaN(id)) return orders;
    return orders.filter((o) => (o.rider_id ?? o.rider?.id) === id);
  }, [orders, riderId]);

  const byRider = useMemo(() => {
    const map = new Map<number, { riderName: string; orders: OrderRow[] }>();
    for (const o of ordersFilteredByRider) {
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
  }, [ordersFilteredByRider]);

  const paginatedByRider = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return byRider.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [byRider, page]);
  useEffect(() => setPage(1), [riderId, dateFrom, dateTo]);

  if (isLoading) return <Loader fullScreen text="Loading deliveries..." />;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="flex justify-between items-center mb-6">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">Deliveries</h1>
          <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">
            See which rider is handling which orders and their delivery status.
          </p>
        </div>
      </div>

      <Card className="mb-6 p-4 dark:bg-slate-800 dark:border-slate-700">
        <div className="flex flex-wrap gap-4 items-end">
          <SearchableSelect
            label="Rider"
            value={riderId}
            onChange={(v) => setFilter('rider_id', v)}
            options={[
              { value: '', label: 'All riders' },
              ...(riders ?? []).map((r) => ({
                value: String(r.id),
                label:
                  (r.rating_count ?? 0) > 0 && r.rating_average != null
                    ? `${r.name} (${r.rating_average.toFixed(1)}/5, ${r.rating_count})`
                    : r.name,
              })),
            ]}
            placeholder="All riders"
            minWidth="min-w-[160px]"
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

      {/* While a filter change is fetching, the previous results stay mounted
          and a soft veil fades in over them (see useResultsRefreshing — background polls stay silent). */}
      <FetchingOverlay active={deliveriesRefreshing} label="Updating deliveries…" className="rounded-xl">
      {byRider.length === 0 ? (
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <p className="text-center text-gray-500 dark:text-slate-300 py-12">No deliveries assigned to riders yet.</p>
          <p className="text-center text-gray-400 dark:text-slate-400 text-sm mt-2 pb-8">
            Assign riders from the Orders page; they will appear here.
          </p>
        </Card>
      ) : (
        <>
          <AccentedList>
            {paginatedByRider.map(({ riderId, riderName, orders: riderOrders }, i) => {
              const deliveredCount = riderOrders.filter((o) => o.delivery_status === 'delivered').length;
              const rStat = riderRatingById.get(riderId);
              const subtitle = (
                <>
                  <p>{riderOrders.length} order{riderOrders.length !== 1 ? 's' : ''} assigned</p>
                  {deliveredCount > 0 && <p className="text-emerald-600 dark:text-emerald-400">{deliveredCount} delivered</p>}
                  {rStat && rStat.rating_count > 0 && rStat.rating_average != null ? (
                    <p className="text-sm text-gray-600 dark:text-slate-300 mt-1">
                      Customer delivery ratings (all orders):{' '}
                      <strong className="text-gray-800 dark:text-slate-200">
                        {rStat.rating_average.toFixed(1)} / 5
                      </strong>
                      <span className="text-gray-500 dark:text-slate-400">
                        {' '}
                        · {rStat.rating_count} rating{rStat.rating_count === 1 ? '' : 's'}
                      </span>
                    </p>
                  ) : (
                    <p className="text-xs text-gray-500 dark:text-slate-500 mt-1">No customer rider ratings yet.</p>
                  )}
                </>
              );
              const footer = (
                <ul className="divide-y divide-gray-100 dark:divide-slate-600">
                  {riderOrders.map((order) => (
                    <li key={order.id} className="px-4 sm:px-6 py-3 hover:bg-gray-50/50 dark:hover:bg-slate-600/30 transition-colors">
                      <Link to={`/admin/orders/${order.id}`} className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-medium text-blue-600 dark:text-blue-400 hover:underline">#{order.order_number}</span>
                          {order.brand?.name && <span className="text-gray-500 dark:text-slate-400 text-sm">· {order.brand.name}</span>}
                          {order.delivery_address && <span className="text-gray-500 dark:text-slate-400 text-sm truncate max-w-[200px]">· {order.delivery_address}</span>}
                        </div>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-gray-500 dark:text-slate-400">Delivery:</span>
                          <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${order.delivery_status === 'delivered' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200' : order.delivery_status === 'delivery_failed' ? 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200' : 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200'}`}>
                            {deliveryStatusLabel(order.delivery_status, { short: true, fallback: 'Assigned' })}
                          </span>
                          <span className="text-sm font-medium text-gray-700 dark:text-slate-200">{formatCurrency(Number(order.total_amount ?? 0))}</span>
                        </div>
                      </Link>
                      {order.delivery_status === 'delivery_failed' && (
                        <p className="mt-1 text-xs text-red-700 dark:text-red-300">
                          <span className="font-semibold">Failed: </span>
                          {order.delivery_failed_reason?.trim() || 'no reason recorded'}
                        </p>
                      )}
                      {order.placed_at && <p className="text-xs text-gray-400 dark:text-slate-500 mt-1">Placed {new Date(order.placed_at).toLocaleString()}</p>}
                    </li>
                  ))}
                </ul>
              );
              return (
                <AccentedListRow
                  key={riderId}
                  accent="active"
                  initial={riderName.charAt(0)}
                  title={riderName}
                  subtitle={subtitle}
                  animationIndex={i}
                  actions={<></>}
                  footer={footer}
                />
              );
            })}
          </AccentedList>
          <PaginationBar totalCount={byRider.length} page={page} pageSize={DEFAULT_PAGE_SIZE} onPageChange={setPage} itemLabel="riders" />
        </>
      )}
      </FetchingOverlay>
    </div>
  );
};

export default Deliveries;
