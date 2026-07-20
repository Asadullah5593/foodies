import React, { useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { orderModifiersWithNesting } from '../../utils/modifierNesting';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { useAuth } from '../../contexts/AuthContext';
import { useHasPermission } from '../../hooks/useHasPermission';
import Loader from '../../components/Loader';
import Card from '../../components/Card';
import Button from '../../components/Button';
import SearchableSelect from '../../components/SearchableSelect';
import AssignRiderModal from '../../components/AssignRiderModal';
import ScrollToTopButton from '../../components/ScrollToTopButton';
import { formatOrderType } from '../../utils/format';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';
import { groupOrderItems } from '../../utils/orderItemGrouping';

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
  deal_id?: number | null;
  deal_slot_index?: number | null;
  deal_name?: string | null;
  addons?: Array<{ name: string; quantity: number }>;
  modifiers?: Array<{ name: string; quantity: number; group?: string | null }>;
};

type PackingOrder = {
  id: number;
  order_number: string;
  order_group_id?: string | null;
  brand_id?: number | null;
  brand_name?: string | null;
  order_type: string;
  status: string;
  table_number?: string;
  customer_name?: string;
  placed_at?: string;
  rider_id?: number | null;
  rider?: { id: number; name: string } | null;
  items: PackingOrderItem[];
};

const FOHPacking: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canAssignRider = useHasPermission(['orders:assign-rider', 'customer-display:update']);
  const [branchId, setBranchId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('ready');
  const [dateFrom, setDateFrom] = useState<string>(todayIsoDate());
  const [dateTo, setDateTo] = useState<string>(todayIsoDate());
  const [showCompleted, setShowCompleted] = useState(false);
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);
  // Holds the just-completed card in place until its exit animation ends, so
  // the empty state doesn't pop in underneath a card that is still dissolving.
  const [dissolvingOrderId, setDissolvingOrderId] = useState<number | null>(null);
  const [riderModalOrderId, setRiderModalOrderId] = useState<number | null>(null);
  const [riderModalBrandId, setRiderModalBrandId] = useState<number | null>(null);
  const [riderModalBrandName, setRiderModalBrandName] = useState<string | null>(null);
  const [selectedRiderId, setSelectedRiderId] = useState<number | null>(null);
  const pageTopRef = useRef<HTMLDivElement | null>(null);
  const completedSectionRef = useRef<HTMLDivElement | null>(null);

  // Branch selector is permission-gated UI: staff without it stay pinned to
  // their auto-selected branch. Data is already branch-scoped server-side.
  const canFilterBranch =
    !!user?.is_super_admin || !!user?.permissions?.includes('foh:branch-filter');

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

  // Completed orders live in a section at the bottom, like Ready on Back Kitchen.
  const completedVisible = showCompleted || statusFilter === 'completed';

  // Status filtering happens client-side so the Completed section always has
  // data no matter which status the main queue is filtered to.
  const { data: orders, isLoading } = useQuery({
    queryKey: ['foh-packing-orders', branchId, dateFrom, dateTo, completedVisible],
    queryFn: async () => {
      if (!branchId) return [];
      const params = new URLSearchParams({ branch_id: branchId });
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (completedVisible) params.append('include_completed', '1');
      const response = await apiClient.get<PackingOrder[]>(`/kitchen/orders?${params.toString()}`);
      return response.data;
    },
    enabled: !!branchId,
    refetchInterval: ORDER_POLL_INTERVAL_MS,
  });

  const completedOrders = useMemo(
    () => ((orders ?? []) as PackingOrder[]).filter((o) => o.status === 'completed'),
    [orders],
  );
  const activeOrders = useMemo(
    () =>
      ((orders ?? []) as PackingOrder[]).filter(
        (o) => o.status !== 'completed' && (!statusFilter || o.status === statusFilter),
      ),
    [orders, statusFilter],
  );

  // Scroll down to the Completed section when it opens; back to the top when it closes.
  const prevCompletedVisible = useRef(completedVisible);
  useEffect(() => {
    if (prevCompletedVisible.current === completedVisible) return;
    prevCompletedVisible.current = completedVisible;
    if (completedVisible) {
      completedSectionRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    } else {
      pageTopRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
    }
  }, [completedVisible]);

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
    onSuccess: (_data, { orderId, status }) => {
      // The refetch drops the card from the packing queue, which triggers its
      // exit animation (it reappears in the Completed section when that's open).
      if (status === 'completed') {
        setDissolvingOrderId(orderId);
      }
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

  const closeRiderModal = () => {
    setRiderModalOrderId(null);
    setRiderModalBrandId(null);
    setRiderModalBrandName(null);
    setSelectedRiderId(null);
  };

  const assignRiderMutation = useMutation({
    mutationFn: ({ orderId, riderId }: { orderId: number; riderId: number }) =>
      adminService.assignRider(orderId, riderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['foh-packing-orders'] });
      closeRiderModal();
      toast.success('Rider assigned');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to assign rider');
    },
  });

  const renderOrderCard = (order: PackingOrder) => (
    <motion.div
      key={order.id}
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.8, ease: 'easeInOut' } }}
      transition={{ duration: 0.28, ease: 'easeOut' }}
    >
    <Card className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden">
      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600 flex justify-between items-start">
        {/* Left: order number + brand */}
        <div>
          <span className="text-lg font-bold text-gray-900 dark:text-gray-100">Order #{order.order_number}</span>
          {order.brand_name && (
            <span className="block text-xs font-medium text-indigo-600 dark:text-indigo-400 mt-0.5">{order.brand_name}</span>
          )}
        </div>
        {/* Right: order type (+ table if dine-in) on top, status below */}
        <div className="flex flex-col items-end gap-1">
          <div className="flex items-center gap-1.5">
            <span className={`px-3 py-1 rounded-md text-sm font-bold uppercase tracking-wide border ${
              order.order_type === 'dine_in' ? 'bg-green-100 dark:bg-green-900/40 text-green-800 dark:text-green-200 border-green-200 dark:border-green-700' :
              order.order_type === 'delivery' ? 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border-blue-200 dark:border-blue-700' :
              order.order_type === 'takeaway' ? 'bg-amber-100 dark:bg-amber-900/40 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-700' :
              'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 border-gray-200 dark:border-gray-600'
            }`}>
              {formatOrderType(order.order_type)}
            </span>
            {order.order_type === 'dine_in' && order.table_number && (
              <span className="px-3 py-1 rounded-md bg-green-600 text-white text-sm font-bold">
                Table {order.table_number}
              </span>
            )}
          </div>
          <span className="px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700">
            {order.status}
          </span>
        </div>
      </div>

      <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-600">
        <div className="flex flex-wrap items-center gap-2">
          {/* table number moved to card header for dine-in */}
          {order.placed_at && (
            <span className="text-gray-500 dark:text-gray-400 text-sm">
              {new Date(order.placed_at).toLocaleTimeString()}
            </span>
          )}
        </div>
        {order.customer_name && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Customer: {order.customer_name}</p>
        )}
      </div>

      <div className="px-4 py-3 space-y-3">
        {(() => {
          const renderItem = (item: PackingOrderItem) => (
            <div key={item.id} className="border-l-2 border-gray-200 dark:border-gray-600 pl-3">
              <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                {item.quantity}× {item.name ?? item.name_snapshot ?? 'Item'}
                {item.variant_name && (
                  <span className="font-normal text-gray-600 dark:text-gray-400"> — {item.variant_name}</span>
                )}
              </p>
              {item.modifiers?.length ? (
                <ul className="mt-1 space-y-0.5">
                  {orderModifiersWithNesting(item.modifiers).map(({ mod: m, nested }, idx) => (
                    <li key={idx} className={`flex gap-1.5 text-sm text-gray-700 dark:text-gray-300${nested ? ' pl-4' : ''}`}>
                      <span className="text-gray-400 dark:text-gray-500" aria-hidden>{nested ? '↳' : '•'}</span>
                      <span>
                        {!nested && m.group ? <span className="text-gray-500 dark:text-gray-400">{m.group}: </span> : null}
                        {m.name}
                        {m.quantity > 1 ? ` ×${m.quantity}` : ''}
                      </span>
                    </li>
                    ))}
                </ul>
              ) : null}
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
          );
          return groupOrderItems(order.items).map((group, gi) => {
            if (group.dealId == null) return group.lines.map(renderItem);
            return (
              <div
                key={`deal-${gi}`}
                className="rounded-lg border border-indigo-200 dark:border-indigo-800 bg-indigo-50/50 dark:bg-indigo-900/10 p-2.5"
              >
                <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-indigo-700 dark:text-indigo-300">
                  Deal · {group.dealName ?? 'Deal'}
                </p>
                <div className="space-y-2">{group.lines.map(renderItem)}</div>
              </div>
            );
          });
        })()}
      </div>

      <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-600 flex gap-2 flex-wrap items-center">
        {order.status === 'ready' && (
          <Button
            size="small"
            variant="primary"
            onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: 'completed' })}
            isLoading={updatingOrderId === order.id}
            disabled={updatingOrderId === order.id}
          >
            Change status to Completed
          </Button>
        )}
        {order.status !== 'ready' && order.status !== 'completed' && (
          <span className="text-xs text-gray-600 dark:text-gray-300">
            Mark complete when status is <span className="font-semibold">ready</span>.
          </span>
        )}
        {order.order_type === 'delivery' && (
          order.rider ? (
            <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold bg-emerald-100 dark:bg-emerald-900/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-700">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" /></svg>
              Rider: {order.rider.name}
            </span>
          ) : canAssignRider ? (
            <Button
              size="small"
              variant="outline"
              onClick={() => {
                setRiderModalOrderId(order.id);
                setRiderModalBrandId(order.brand_id ?? null);
                setRiderModalBrandName(order.brand_name ?? null);
                setSelectedRiderId(null);
              }}
            >
              Assign Rider
            </Button>
          ) : null
        )}
      </div>
    </Card>
    </motion.div>
  );

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 text-gray-900 dark:text-gray-100">
      <div className="w-full">
        <div ref={pageTopRef} className="flex justify-between items-center mb-6 flex-wrap gap-4 scroll-mt-6">
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
            {canFilterBranch && (
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
            )}
            <SearchableSelect
              label="Status"
              value={statusFilter}
              onChange={(v) => {
                setStatusFilter(v);
                if (v === 'completed') setShowCompleted(true);
              }}
              options={[
                { value: 'preparing', label: 'Preparing' },
                { value: 'ready', label: 'Ready' },
                { value: 'completed', label: 'Completed' },
              ]}
              placeholder="Select status"
            />
            <button
              type="button"
              onClick={() => {
                if (completedVisible) {
                  setShowCompleted(false);
                  // Otherwise the status filter would keep the section open and
                  // the button would appear to do nothing.
                  if (statusFilter === 'completed') setStatusFilter('ready');
                } else {
                  setShowCompleted(true);
                }
              }}
              className={[
                'px-4 py-2 rounded-lg border text-sm font-medium transition-colors',
                completedVisible
                  ? 'bg-emerald-50 dark:bg-emerald-900/40 border-emerald-300 dark:border-emerald-700 text-emerald-700 dark:text-emerald-200'
                  : 'bg-white dark:bg-slate-800 border-gray-300 dark:border-slate-600 text-gray-700 dark:text-slate-200 hover:bg-gray-50 dark:hover:bg-slate-700',
              ].join(' ')}
              title="Toggle completed orders"
            >
              {completedVisible ? 'Hide Completed' : 'Show Completed'}
            </button>
          </div>
        </div>

        {!branchId ? (
          <Card className="p-8 text-center dark:bg-slate-800 dark:border-slate-700">
            <p className="text-gray-600 dark:text-slate-300">Select a branch to view orders.</p>
          </Card>
        ) : isLoading ? (
          <Loader fullScreen text="Loading orders..." />
        ) : (
          <>
            {(activeOrders.length > 0 || dissolvingOrderId !== null) && (
              <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                Queue order: oldest first (new orders appear at the end).
              </p>
            )}
            {/* The grid stays mounted even when empty: unmounting it would cut
                off the exit animation of the last card leaving the queue. */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
              <AnimatePresence onExitComplete={() => setDissolvingOrderId(null)}>
              {activeOrders.map((order) => renderOrderCard(order))}
              </AnimatePresence>
            </div>
            {activeOrders.length === 0 && dissolvingOrderId === null && (
              <Card className="p-8 text-center dark:bg-slate-800 dark:border-slate-700">
                <p className="text-gray-600 dark:text-slate-300">
                  {statusFilter === 'completed'
                    ? 'Completed orders are listed below.'
                    : 'No orders found.'}
                </p>
              </Card>
            )}
            {completedVisible && (
              <div ref={completedSectionRef} className="mt-10 pt-6 border-t border-gray-200 dark:border-gray-700 scroll-mt-6">
                <h2 className="text-xl font-bold text-gray-900 dark:text-gray-100 mb-1">
                  Completed ({completedOrders.length})
                </h2>
                <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">
                  Handed over. Shown for reference only.
                </p>
                {completedOrders.length > 0 ? (
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <AnimatePresence>
                    {completedOrders.map((order) => renderOrderCard(order))}
                    </AnimatePresence>
                  </div>
                ) : (
                  <Card className="p-6 text-center dark:bg-slate-800 dark:border-slate-700">
                    <p className="text-gray-600 dark:text-slate-300">No completed orders yet.</p>
                  </Card>
                )}
              </div>
            )}
          </>
        )}
      </div>

      <AssignRiderModal
        isOpen={riderModalOrderId != null}
        onClose={closeRiderModal}
        title="Assign rider"
        subject={`Order #${orders?.find((o) => o.id === riderModalOrderId)?.order_number ?? riderModalOrderId}`}
        confirmLabel="Assign"
        brandId={riderModalBrandId}
        brandName={riderModalBrandName}
        selectedRiderId={selectedRiderId}
        onSelectRider={setSelectedRiderId}
        isPending={assignRiderMutation.isPending}
        onConfirm={() => {
          if (riderModalOrderId && selectedRiderId) {
            assignRiderMutation.mutate({ orderId: riderModalOrderId, riderId: selectedRiderId });
          }
        }}
      />

      <ScrollToTopButton />
    </div>
  );
};

export default FOHPacking;
