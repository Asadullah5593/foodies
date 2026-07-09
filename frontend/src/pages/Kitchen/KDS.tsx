import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { menuService } from '../../services/api';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import SearchableSelect from '../../components/SearchableSelect';
import Card from '../../components/Card';
import { formatOrderType } from '../../utils/format';
import { groupOrderItems } from '../../utils/orderItemGrouping';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';

function todayIsoDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

interface KitchenOrder {
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
  items: Array<KitchenItem>;
  notes?: string | null;
}

type KitchenItem = {
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

const KDS: React.FC = () => {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');
  const [brandId, setBrandId] = useState<string>('');
  const [updatingOrderId, setUpdatingOrderId] = useState<number | null>(null);
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

  const effectiveBranchId = branchId ? +branchId : null;
  const { data: branchMenu } = useQuery({
    queryKey: ['pos-menu', effectiveBranchId],
    queryFn: () => menuService.getBranchMenu(effectiveBranchId!),
    enabled: effectiveBranchId != null,
  });
  const brands = branchMenu?.brands ?? [];

  const { data: orders, isLoading } = useQuery({
    queryKey: ['kitchen-orders', branchId, statusFilter, brandId, dateFrom, dateTo, showCompleted],
    queryFn: async () => {
      if (!branchId) return [];
      const params = new URLSearchParams({ branch_id: branchId });
      if (statusFilter) params.append('status', statusFilter);
      if (brandId) params.append('brand_id', brandId);
      if (dateFrom) params.append('date_from', dateFrom);
      if (dateTo) params.append('date_to', dateTo);
      if (showCompleted || statusFilter === 'completed') params.append('include_completed', '1');
      const response = await apiClient.get<KitchenOrder[]>(`/kitchen/orders?${params.toString()}`);
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
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
      queryClient.invalidateQueries({ queryKey: ['foh-packing-orders'] });
      if (status === 'completed') {
        queryClient.invalidateQueries({ queryKey: ['salesSummary'] });
        queryClient.invalidateQueries({ queryKey: ['topItems'] });
        queryClient.invalidateQueries({ queryKey: ['shifts'] });
      }
      toast.success('Status updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to update status');
    },
    onSettled: () => {
      setUpdatingOrderId(null);
    },
  });

  const handlePrintKot = async (orderId: number) => {
    try {
      const response = await apiClient.get(`/kitchen/orders/${orderId}/kot?branch_id=${branchId}`);
      const data = response.data ?? {};
      const orderTypeLabel = formatOrderType(data.order_type);
      const placedStr = data.placed_at ? new Date(data.placed_at).toLocaleString() : '—';
      const itemsHtml = (data.items ?? []).map((i: any) => {
        const brandLine = i.brand_name ? `<div class="kot-brand">${escapeHtml(i.brand_name)}</div>` : '';
        const nameLine = `${i.quantity}× ${(i.name ?? '').trim()}${i.variant_name ? ` — ${i.variant_name}` : ''}`;
        const notesLine = i.notes ? `<div class="kot-note">Note: ${escapeHtml(i.notes)}</div>` : '';
        const addonsStr = (i.addons ?? []).map((a: any) => `${a.name} ×${a.quantity ?? 1}`).join(', ');
        const addonsLine = addonsStr ? `<div class="kot-addons">Add-ons: ${escapeHtml(addonsStr)}</div>` : '';
        const modifiersStr = (i.modifiers ?? []).map((m: any) => `${m.name}${(m.quantity ?? 1) > 1 ? ` ×${m.quantity}` : ''}`).join(', ');
        const modifiersLine = modifiersStr ? `<div class="kot-addons">${escapeHtml(modifiersStr)}</div>` : '';
        return `<div class="kot-item">${brandLine}${escapeHtml(nameLine)}${modifiersLine}${addonsLine}${notesLine}</div>`;
      }).join('');
      const w = window.open('', '_blank');
      if (w) {
        w.document.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>KOT ${escapeHtml(data.order_number ?? String(orderId))}</title>
  <style>
    * { box-sizing: border-box; }
    body { font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; padding: 20px 24px; font-size: 15px; line-height: 1.4; color: #111; }
    @media print { body { padding: 16px; } }
    .kot-header { border-bottom: 3px solid #111; padding-bottom: 10px; margin-bottom: 14px; }
    .kot-title { font-size: 11px; text-transform: uppercase; letter-spacing: 0.08em; color: #444; margin: 0 0 4px 0; }
    .kot-order-num { font-size: 22px; font-weight: 700; margin: 0; }
    .kot-meta { display: flex; flex-wrap: wrap; gap: 12px 20px; margin-bottom: 14px; padding: 10px 0; border-bottom: 1px solid #ddd; font-size: 14px; }
    .kot-meta span { font-weight: 600; color: #333; }
    .kot-section { font-size: 12px; text-transform: uppercase; letter-spacing: 0.06em; color: #555; margin: 12px 0 8px 0; }
    .kot-item { margin: 10px 0; padding: 6px 0; border-bottom: 1px solid #eee; font-size: 15px; font-weight: 600; }
    .kot-brand { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: #4338ca; margin-bottom: 2px; font-weight: 600; }
    .kot-addons { font-size: 13px; font-weight: 400; color: #444; margin-top: 2px; margin-left: 8px; }
    .kot-note { font-size: 13px; margin-top: 4px; margin-left: 8px; padding: 4px 8px; background: #fef3c7; border-left: 3px solid #d97706; color: #92400e; }
    .kot-footer { margin-top: 16px; padding-top: 10px; border-top: 1px solid #ddd; font-size: 13px; color: #666; }
  </style>
</head>
<body>
  <div class="kot-header">
    <p class="kot-title">Kitchen Order Ticket</p>
    <h1 class="kot-order-num">#${escapeHtml(data.order_number ?? String(orderId))}</h1>
  </div>
  <div class="kot-meta">
    <span>Type</span> ${escapeHtml(orderTypeLabel)}
    ${data.table_number ? `<span>Table</span> ${escapeHtml(data.table_number)}` : ''}
    ${data.customer_name ? `<span>Customer</span> ${escapeHtml(data.customer_name)}` : ''}
    <span>Placed</span> ${escapeHtml(placedStr)}
    ${data.delivery_address ? `<span>Delivery</span> ${escapeHtml(data.delivery_address)}` : ''}
  </div>
  <div class="kot-section">Items</div>
  ${itemsHtml}
  <div class="kot-footer">Placed: ${escapeHtml(placedStr)}</div>
</body>
</html>`);
        w.document.close();
        w.print();
      }
    } catch (e) {
      toast.error('Failed to load KOT');
    }
  };

  const nextStatus: Record<string, string> = {
    placed: 'accepted',
    accepted: 'preparing',
    preparing: 'ready',
  };

  useEffect(() => {
    if (!branchId && branches?.length) {
      setBranchId(String(branches[0].id));
    }
  }, [branchId, branches]);

  useEffect(() => {
    if (branchId && !brandId && brands.length === 1) {
      setBrandId(String(brands[0].id));
    }
  }, [branchId, brands, brandId]);

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 text-gray-900 dark:text-gray-100">
      <div className="w-full">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
          <div>
            <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100">Back Kitchen</h1>
            <p className="text-gray-600 dark:text-gray-400 text-sm mt-1">
              Brand-specific orders. Filter by brand to see only your orders.
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
              onChange={(v) => {
                setBranchId(v);
                setBrandId('');
              }}
              options={[
                { value: '', label: 'Select branch' },
                ...(branches ?? []).map((b: { id: number; name: string }) => ({
                  value: String(b.id),
                  label: b.name,
                })),
              ]}
              placeholder="Select branch"
            />
            {brands.length > 0 && (
              <SearchableSelect
                label="Brand"
                value={brandId}
                onChange={setBrandId}
                options={[
                  { value: '', label: 'All brands' },
                  ...brands.map((b: { id: number; name: string }) => ({
                    value: String(b.id),
                    label: b.name,
                  })),
                ]}
                placeholder="All brands"
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
                { value: '', label: 'All statuses' },
                { value: 'placed', label: 'Placed' },
                { value: 'accepted', label: 'Accepted' },
                { value: 'preparing', label: 'Preparing' },
                { value: 'ready', label: 'Ready' },
                { value: 'completed', label: 'Completed' },
              ]}
              placeholder="All statuses"
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
              {showCompleted ? 'Hide Completed' : 'Show Completed'}
            </button>
          </div>
        </div>

        {!branchId ? (
          <Card className="p-8 text-center dark:bg-slate-800 dark:border-slate-700">
            <p className="text-gray-600 dark:text-slate-300">Select a branch to view kitchen orders.</p>
          </Card>
        ) : isLoading ? (
          <Loader fullScreen text="Loading orders..." />
        ) : !orders?.length ? (
          <Card className="p-8 text-center dark:bg-slate-800 dark:border-slate-700">
            <p className="text-gray-600 dark:text-slate-300">No orders in queue.</p>
          </Card>
        ) : (
          <>
            <p className="text-gray-600 dark:text-gray-400 text-sm mb-4">Queue order: oldest first (new orders appear at the end).</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {(orders as KitchenOrder[]).map((order, index) => (
              <Card key={order.id} className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-lg overflow-hidden">
                {/* Header: queue #, order #, status, Print KOT */}
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-200 dark:border-gray-600 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-900 dark:bg-gray-600 text-white font-bold text-base shrink-0" title="Queue position">
                      {index + 1}
                    </span>
                    <div>
                      <span className="text-lg font-bold text-gray-900 dark:text-gray-100">#{order.order_number}</span>
                      <span className="ml-2 px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wide bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-700">
                        {order.status}
                      </span>
                      {order.brand_name && (
                        <span className="block text-xs font-medium text-indigo-600 dark:text-indigo-400 mt-0.5">{order.brand_name}</span>
                      )}
                    </div>
                  </div>
                  <Button
                    size="small"
                    variant="outline"
                    onClick={() => handlePrintKot(order.id)}
                  >
                    Print KOT
                  </Button>
                </div>
                {/* Order type, table, time, customer */}
                <div className="px-4 py-2.5 border-b border-gray-100 dark:border-gray-600">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`px-2.5 py-1 rounded-md text-xs font-bold uppercase tracking-wide border ${
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
                    {order.placed_at && (
                      <span className="text-gray-500 dark:text-gray-400 text-sm">{new Date(order.placed_at).toLocaleTimeString()}</span>
                    )}
                  </div>
                  {order.customer_name && (
                    <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">Customer: {order.customer_name}</p>
                  )}
                </div>
                {order.notes ? (
                  <div className="mx-4 mt-3 text-sm font-medium text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/40 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-700">
                    Order note: {order.notes}
                  </div>
                ) : null}
                {/* Items with variant, add-ons, notes */}
                <div className="px-4 py-3 space-y-3">
                  {(() => {
                    const renderItem = (item: KitchenItem) => (
                      <div key={item.id} className="border-l-2 border-gray-200 dark:border-gray-600 pl-3">
                        <p className="text-base font-semibold text-gray-900 dark:text-gray-100">
                          {item.quantity}× {item.name ?? item.name_snapshot ?? 'Item'}
                          {item.variant_name && (
                            <span className="font-normal text-gray-600 dark:text-gray-400"> — {item.variant_name}</span>
                          )}
                        </p>
                        {item.modifiers?.length ? (
                          <ul className="mt-1 space-y-0.5">
                            {item.modifiers.map((m, idx) => (
                              <li key={idx} className="flex gap-1.5 text-sm text-gray-700 dark:text-gray-300">
                                <span className="text-gray-400 dark:text-gray-500" aria-hidden>•</span>
                                <span>
                                  {m.group ? <span className="text-gray-500 dark:text-gray-400">{m.group}: </span> : null}
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
                {/* Actions */}
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-t border-gray-200 dark:border-gray-600 flex gap-2 flex-wrap">
                  {nextStatus[order.status] && (
                    <Button
                      size="small"
                      variant="primary"
                      onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: nextStatus[order.status] })}
                      isLoading={updatingOrderId === order.id}
                      disabled={updatingOrderId === order.id}
                    >
                      Change status to {nextStatus[order.status].charAt(0).toUpperCase() + nextStatus[order.status].slice(1)}
                    </Button>
                  )}
                  {order.status === 'ready' && (
                    <span className="text-xs text-gray-600 dark:text-gray-300">
                      Ready — completion happens in <span className="font-semibold">FOH Packing</span>.
                    </span>
                  )}
                </div>
              </Card>
            ))}
            </div>
          </>
        )}
      </div>
    </div>
  );
};

export default KDS;
