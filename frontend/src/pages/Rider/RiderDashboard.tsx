import React, { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { MdOutlineLocationOn } from 'react-icons/md';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { riderService, RiderOrder } from '../../services/api/riderService';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import Button from '../../components/Button';
import { AccentedList, AccentedListRow } from '../../components/AccentedListRow';
import PaginationBar, { DEFAULT_PAGE_SIZE } from '../../components/PaginationBar';
import { formatCurrency } from '../../utils/currency';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';

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
  delivery_failed: 'Delivery Failed',
};

const RiderDashboard: React.FC = () => {
  const [page, setPage] = useState(1);
  const {
    data: orders,
    isLoading,
    isFetching,
    isFetched,
  } = useQuery({
    queryKey: ['rider-orders'],
    queryFn: () => riderService.getOrders(),
    refetchInterval: ORDER_POLL_INTERVAL_MS,
    refetchOnMount: 'always',
    staleTime: 0,
    gcTime: 1000 * 60 * 10, // 10 min so cache survives navigation
    placeholderData: keepPreviousData, // keep showing list when navigating back while refetch runs
  });

  const list = Array.isArray(orders) ? orders : [];

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

  const paginatedGroups = useMemo(() => {
    const start = (page - 1) * DEFAULT_PAGE_SIZE;
    return displayGroups.slice(start, start + DEFAULT_PAGE_SIZE);
  }, [displayGroups, page]);

  // Show loader when loading or when refetching with no data yet (avoids flashing empty state)
  const showLoader = (isLoading || (isFetching && list.length === 0)) && !isFetched;
  if (showLoader) return <Loader fullScreen text="Loading your deliveries..." />;

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      <div className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold text-gray-800 dark:text-slate-100">My Deliveries</h1>
        <p className="text-gray-500 dark:text-slate-400 text-sm mt-1">
          Orders assigned to you. Grouped orders are from the same customer — open to view details and update status.
        </p>
      </div>

      {displayGroups.length === 0 ? (
        <Card className="dark:bg-slate-800 dark:border-slate-700">
          <p className="text-center text-gray-500 dark:text-slate-300 py-12">No orders assigned to you yet.</p>
          <p className="text-center text-gray-400 dark:text-slate-400 text-sm mt-2 pb-8">
            When an order is assigned to you, it will appear here.
          </p>
        </Card>
      ) : (
        <>
          <AccentedList>
            {paginatedGroups.map(({ orderGroupId: gid, orders: groupOrders }, i) => {
              const isGroup = gid && groupOrders.length > 1;
              const first = groupOrders[0];
              const groupTotal = groupOrders.reduce(
                (s, o) => s + Number(o.total_amount ?? 0),
                0
              );
              const orderStatusSet = new Set(groupOrders.map((o) => o.status ?? 'placed'));
              const orderStatusLabel =
                orderStatusSet.size === 1
                  ? (ORDER_STATUS_LABELS[first?.status ?? ''] ?? first?.status ?? 'Placed')
                  : 'Mixed';
              const deliveryStatusSet = new Set(
                groupOrders.map((o) => o.delivery_status ?? 'assigned')
              );
              const deliveryStatusLabel =
                deliveryStatusSet.size === 1
                  ? (DELIVERY_STATUS_LABELS[first?.delivery_status ?? ''] ??
                      first?.delivery_status ??
                      'Assigned')
                  : 'Mixed';
              const isDone =
                deliveryStatusLabel === 'Delivered' ||
                deliveryStatusLabel === 'Delivery Failed';
              const title = isGroup
                ? `Order #${first?.order_number} +${groupOrders.length - 1} more`
                : `#${first?.order_number}`;
              const subtitle = (
                <>
                  {first?.brand_name && <p>{first.brand_name}</p>}
                  {first?.delivery_address && (
                    <p className="truncate max-w-full" title={first.delivery_address}><MdOutlineLocationOn className="inline h-4 w-4 mr-1 align-text-bottom" />{first.delivery_address}</p>
                  )}
                  {first?.placed_at && (
                    <p className="text-xs text-gray-500 dark:text-slate-500">{new Date(first.placed_at).toLocaleString()}</p>
                  )}
                  <p className="font-semibold text-gray-900 dark:text-slate-100">{formatCurrency(isGroup ? groupTotal : Number(first?.total_amount ?? 0))}</p>
                </>
              );
              const footer = (
                <ul className="divide-y divide-gray-100 dark:divide-slate-600">
                  {groupOrders.map((order) => (
                    <li key={order.id} className="px-4 sm:px-6 py-3 hover:bg-gray-50/50 dark:hover:bg-slate-600/30 transition-colors">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <Link
                          to={`/rider/orders/${order.id}`}
                          className="min-w-0 flex-1 flex flex-wrap items-center gap-x-2 gap-y-1"
                        >
                          <span className="font-medium text-blue-600 dark:text-blue-400 hover:underline">
                            #{order.order_number}
                            {order.brand_name && <span className="text-gray-500 dark:text-slate-400 font-normal text-sm ml-1">· {order.brand_name}</span>}
                          </span>
                          <span className="text-sm font-medium text-gray-700 dark:text-slate-200">
                            {formatCurrency(order.total_amount)}
                          </span>
                        </Link>
                        <div className="flex flex-wrap items-center gap-2 sm:gap-3 flex-shrink-0">
                          <span className="text-xs text-gray-500 dark:text-slate-400">
                            Order: <span className="font-medium text-gray-700 dark:text-slate-200">{ORDER_STATUS_LABELS[order.status ?? ''] ?? order.status ?? 'Placed'}</span>
                          </span>
                          <span className="text-xs text-gray-500 dark:text-slate-400">
                            Delivery: <span className="font-medium text-gray-700 dark:text-slate-200">{DELIVERY_STATUS_LABELS[order.delivery_status ?? ''] ?? order.delivery_status ?? 'Assigned'}</span>
                          </span>
                          <Link to={`/rider/orders/${order.id}`}>
                            <Button size="small" variant="view">View & update</Button>
                          </Link>
                        </div>
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
                  deliveryStatusLabel={deliveryStatusLabel}
                  statusVariant={isDone ? 'inactive' : 'active'}
                  animationIndex={i}
                  actions={null}
                  footer={footer}
                />
              );
            })}
          </AccentedList>
          <PaginationBar
            totalCount={displayGroups.length}
            page={page}
            pageSize={DEFAULT_PAGE_SIZE}
            onPageChange={setPage}
            itemLabel="deliveries"
          />
        </>
      )}
    </div>
  );
};

export default RiderDashboard;
