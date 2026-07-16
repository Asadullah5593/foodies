import React, { useState, useEffect, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  MdOutlineDashboard,
  MdOutlineReceiptLong,
  MdOutlineDeliveryDining,
  MdOutlineShoppingCart,
  MdOutlineSoupKitchen,
  MdOutlineInventory2,
  MdOutlineStorefront,
  MdOutlineRestaurantMenu,
  MdClose,
} from 'react-icons/md';
import apiClient from '../../utils/apiClient';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import ScrollToTopButton from '../../components/ScrollToTopButton';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';

interface KitchenOrderItem {
  id: number;
  name?: string;
  name_snapshot?: string;
  quantity: number;
  notes?: string;
  variant_name?: string | null;
  brand_name?: string | null;
  addons?: Array<{ name: string; quantity: number }>;
}

interface KitchenOrder {
  id: number;
  order_number: string;
  order_group_id?: string | null;
  brand_id?: number | null;
  order_type: string;
  status: string;
  table_number?: string;
  customer_name?: string;
  placed_at?: string;
  items: KitchenOrderItem[];
}

/** Group orders by order_group_id for customer-facing display (one card per "order" = one group). */
function groupOrdersForCustomer(orders: KitchenOrder[]): { groupId: string | null; orders: KitchenOrder[] }[] {
  const byGroup = new Map<string | null, KitchenOrder[]>();
  for (const o of orders) {
    const gid = o.order_group_id ?? null;
    if (!byGroup.has(gid)) byGroup.set(gid, []);
    byGroup.get(gid)!.push(o);
  }
  const result: { groupId: string | null; orders: KitchenOrder[] }[] = [];
  byGroup.forEach((orderList, gid) => {
    const sorted = [...orderList].sort(
      (a, b) => new Date(a.placed_at ?? 0).getTime() - new Date(b.placed_at ?? 0).getTime()
    );
    result.push({ groupId: gid, orders: sorted });
  });
  result.sort((a, b) => {
    const aFirst = a.orders[0]?.placed_at;
    const bFirst = b.orders[0]?.placed_at;
    return new Date(aFirst ?? 0).getTime() - new Date(bFirst ?? 0).getTime();
  });
  return result;
}

/** Statuses that keep an order in the "Preparing" column. */
const PREP_STATUSES = ['placed', 'accepted', 'preparing'];

/** Which customer-display column a grouped order belongs to, derived from its orders' statuses. */
function groupPhase(orders: KitchenOrder[]): 'preparing' | 'ready' | 'completed' {
  const active = orders.filter((o) => o.status !== 'cancelled');
  if (active.some((o) => PREP_STATUSES.includes(o.status))) return 'preparing';
  if (active.some((o) => o.status === 'ready')) return 'ready';
  return 'completed';
}

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Customer-facing kitchen display: full-screen, no branch filter.
 * Branch is set via URL ?branch_id=1 (staff sets this before showing to customers).
 * Use /kitchen/back for staff (KDS with status updates).
 */
const NAV_LINKS = [
  { path: '/admin/dashboard', label: 'Dashboard', icon: MdOutlineDashboard },
  { path: '/admin/orders', label: 'Orders', icon: MdOutlineReceiptLong },
  { path: '/admin/deliveries', label: 'Deliveries', icon: MdOutlineDeliveryDining },
  { path: '/pos/orders', label: 'POS', icon: MdOutlineShoppingCart },
  { path: '/kitchen/back', label: 'Back Kitchen', icon: MdOutlineSoupKitchen },
  { path: '/foh/packing', label: 'FOH Packing', icon: MdOutlineInventory2 },
  { path: '/admin/brands', label: 'Brands', icon: MdOutlineStorefront },
  { path: '/admin/menu-items', label: 'Menu Items', icon: MdOutlineRestaurantMenu },
];

const CustomerDisplay: React.FC = () => {
  const [searchParams] = useSearchParams();
  const branchFromUrl = searchParams.get('branch_id') ?? '';
  const [branchId, setBranchId] = useState<string>(branchFromUrl);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState<string>(todayIsoDate());
  const [dateTo, setDateTo] = useState<string>(todayIsoDate());
  const [showCompleted, setShowCompleted] = useState(false);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get('/admin/branches');
      return response.data;
    },
  });

  const { data: orders = [], isLoading } = useQuery({
    queryKey: ['customer-display-orders', branchId, dateFrom, dateTo, showCompleted],
    queryFn: async () => {
      if (!branchId) return [];
      const params = new URLSearchParams({ branch_id: branchId });
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (showCompleted) params.append('include_completed', '1');
      const response = await apiClient.get<KitchenOrder[]>(`/kitchen/orders?${params.toString()}`);
      return response.data;
    },
    enabled: !!branchId,
    refetchInterval: ORDER_POLL_INTERVAL_MS,
  });

  const displayGroups = useMemo(
    () => groupOrdersForCustomer(orders as KitchenOrder[]),
    [orders]
  );

  // Split the display into two columns by phase.
  const preparingGroups = displayGroups.filter((g) => groupPhase(g.orders) === 'preparing');
  const readyGroups = displayGroups.filter((g) => groupPhase(g.orders) === 'ready');
  const completedGroups = displayGroups.filter((g) => groupPhase(g.orders) === 'completed');

  const renderCard = (
    group: { groupId: string | null; orders: KitchenOrder[] },
    phase: 'preparing' | 'ready' | 'completed'
  ) => {
    const { groupId, orders: groupOrders } = group;
    const first = groupOrders[0];
    const isGroup = !!groupId && groupOrders.length > 1;
    const key = groupId ?? `single-${first?.id}`;
    // Status badge intentionally hidden on the customer display. Kept commented so it can be
    // restored later — uncomment both this `badge` const and the <span> in the card below.
    // const statusSet = new Set(groupOrders.map((o) => o.status));
    // const badge =
    //   phase === 'ready'
    //     ? { label: 'Ready', cls: 'bg-emerald-100 text-emerald-800 border-emerald-200' }
    //     : phase === 'completed'
    //       ? { label: 'Completed', cls: 'bg-gray-100 text-gray-500 border-gray-200' }
    //       : {
    //           label: statusSet.size === 1 ? first?.status ?? '' : 'Mixed',
    //           cls: 'bg-amber-100 text-amber-800 border-amber-200',
    //         };
    return (
      <Card key={key} className={phase === 'completed' ? 'opacity-60' : ''}>
        <div className="flex items-start justify-between gap-2">
          <span className="text-lg font-bold text-gray-900 break-all">
            {isGroup ? `Order #${first?.order_number}` : `#${first?.order_number}`}
          </span>
          {/* Status badge hidden on customer display (Preparing "accepted" / Ready "ready").
              Uncomment together with the `badge` const above to show it again.
          <span className={`flex-shrink-0 px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wide border ${badge.cls}`}>
            {badge.label}
          </span>
          */}
        </div>
        {/* "Mark completed" is intentionally NOT on the customer display — the order is
            marked complete from the FOH Packing screen. */}
      </Card>
    );
  };

  // Sync branch from URL and default to first branch when no URL param
  useEffect(() => {
    if (branchFromUrl) {
      setBranchId(branchFromUrl);
    } else if (branches?.length && !branchId) {
      setBranchId(String(branches[0].id));
    }
  }, [branchFromUrl, branches, branchId]);

  // Enter fullscreen on mount (customer display); track fullscreen state
  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    const timer = setTimeout(() => {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen().catch(() => {});
      }
    }, 500);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      clearTimeout(timer);
    };
  }, []);

  const requestFullscreen = () => {
    document.documentElement.requestFullscreen?.().catch(() => {});
  };

  return (
    <div className="min-h-screen w-full bg-white text-gray-900 flex flex-col">
      {/* Sidebar overlay for navigation */}
      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-black/40"
              onClick={() => setSidebarOpen(false)}
              aria-hidden
            />
            <motion.aside
              initial={{ x: -280 }}
              animate={{ x: 0 }}
              exit={{ x: -280 }}
              transition={{ type: 'tween', duration: 0.2 }}
              className="fixed left-0 top-0 bottom-0 z-50 w-72 bg-white border-r border-gray-200 shadow-xl flex flex-col"
            >
              <div className="p-4 border-b border-gray-200 flex items-center justify-between">
                <span className="font-semibold text-gray-900">Navigate</span>
                <button
                  type="button"
                  onClick={() => setSidebarOpen(false)}
                  className="p-2 rounded-lg hover:bg-gray-100 text-gray-500"
                  aria-label="Close menu"
                >
                  <MdClose className="h-5 w-5" />
                </button>
              </div>
              <nav className="p-2 flex-1 overflow-auto">
                {NAV_LINKS.map(({ path, label, icon: Icon }) => (
                  <Link
                    key={path}
                    to={path}
                    onClick={() => setSidebarOpen(false)}
                    className="flex items-center gap-3 px-3 py-2.5 rounded-lg text-gray-700 hover:bg-gray-100 hover:text-gray-900 transition-colors"
                  >
                    <Icon className="h-5 w-5" />
                    <span>{label}</span>
                  </Link>
                ))}
              </nav>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      {/* Compact customer-facing header: no branch filter */}
      <header className="flex-shrink-0 px-4 sm:px-6 py-3 sm:py-4 border-b border-gray-200 flex items-center justify-between bg-white">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setSidebarOpen(true)}
            className="flex-shrink-0 p-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-600 transition-colors"
            title="Open menu to navigate"
            aria-label="Open menu"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          <div>
            <h1 className="text-2xl sm:text-3xl font-bold text-gray-900">Customer Display</h1>
            <p className="text-gray-500 text-sm mt-0.5">
              Preparing &amp; ready orders. Mark an order completed once the customer collects it.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <label className="text-xs text-gray-600 font-medium">From</label>
            <input
              type="date"
              value={dateFrom}
              onChange={(e) => setDateFrom(e.target.value)}
              className="bg-white border border-gray-300 text-gray-900 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>
          <div className="flex items-center gap-2 bg-gray-50 border border-gray-200 rounded-lg px-3 py-2">
            <label className="text-xs text-gray-600 font-medium">To</label>
            <input
              type="date"
              value={dateTo}
              onChange={(e) => setDateTo(e.target.value)}
              className="bg-white border border-gray-300 text-gray-900 rounded-md px-2 py-1 text-sm focus:ring-2 focus:ring-emerald-500 focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowCompleted((v) => !v)}
            className={[
              'px-3 py-2 rounded-lg text-sm font-medium transition-colors border',
              showCompleted
                ? 'bg-emerald-50 border-emerald-400 text-emerald-700 hover:bg-emerald-100'
                : 'bg-gray-50 border-gray-300 text-gray-700 hover:bg-gray-100',
            ].join(' ')}
            title="Toggle completed orders"
          >
            {showCompleted ? 'Hide Completed' : 'Show Completed'}
          </button>
          {!isFullscreen && (
            <button
              type="button"
              onClick={requestFullscreen}
              className="flex-shrink-0 px-3 py-2 rounded-lg bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium transition-colors"
              title="Enter fullscreen"
            >
              Full screen
            </button>
          )}
        </div>
      </header>

      <main className="flex-1 overflow-auto px-4 sm:px-6 pb-6 pt-5 bg-gray-50">
        <div className="max-w-7xl mx-auto">
        {!branchId ? (
          <Card className="p-8 text-center bg-white border-gray-200">
            <p className="text-gray-500">Loading…</p>
          </Card>
        ) : isLoading ? (
          <Loader fullScreen text="Loading orders..." />
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 sm:gap-6">
            {/* Preparing: placed / accepted / preparing */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="h-3 w-3 rounded-full bg-amber-500" aria-hidden />
                <h2 className="text-xl font-bold text-gray-900">Preparing</h2>
                <span className="text-sm font-semibold text-gray-400">{preparingGroups.length}</span>
              </div>
              {preparingGroups.length === 0 ? (
                <p className="text-gray-400 text-sm py-10 text-center border border-dashed border-gray-200 rounded-xl">
                  No orders preparing.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {preparingGroups.map((g) => renderCard(g, 'preparing'))}
                </div>
              )}
            </section>

            {/* Ready: ready (+ completed when "Show Completed" is on) */}
            <section>
              <div className="flex items-center gap-2 mb-3">
                <span className="h-3 w-3 rounded-full bg-emerald-500" aria-hidden />
                <h2 className="text-xl font-bold text-gray-900">Ready</h2>
                <span className="text-sm font-semibold text-gray-400">{readyGroups.length}</span>
              </div>
              {readyGroups.length === 0 && !(showCompleted && completedGroups.length > 0) ? (
                <p className="text-gray-400 text-sm py-10 text-center border border-dashed border-gray-200 rounded-xl">
                  No orders ready.
                </p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {readyGroups.map((g) => renderCard(g, 'ready'))}
                  {showCompleted && completedGroups.map((g) => renderCard(g, 'completed'))}
                </div>
              )}
            </section>
          </div>
        )}
        <ScrollToTopButton />
        </div>
      </main>
    </div>
  );
};

export default CustomerDisplay;
