import React, { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import Loader from '../../components/Loader';
import Button from '../../components/Button';
import Card from '../../components/Card';
import { formatOrderType } from '../../utils/format';

function escapeHtml(s: string): string {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

interface KitchenOrder {
  id: number;
  order_number: string;
  order_type: string;
  status: string;
  table_number?: string;
  customer_name?: string;
  placed_at?: string;
  items: Array<{
    id: number;
    name?: string;
    name_snapshot?: string;
    quantity: number;
    notes?: string;
    variant_name?: string | null;
    addons?: Array<{ name: string; quantity: number }>;
  }>;
}

const KDS: React.FC = () => {
  const queryClient = useQueryClient();
  const [branchId, setBranchId] = useState<string>('');
  const [statusFilter, setStatusFilter] = useState<string>('');

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get('/admin/branches');
      return response.data;
    },
  });

  const { data: orders, isLoading } = useQuery({
    queryKey: ['kitchen-orders', branchId, statusFilter],
    queryFn: async () => {
      if (!branchId) return [];
      const params = new URLSearchParams({ branch_id: branchId });
      if (statusFilter) params.append('status', statusFilter);
      const response = await apiClient.get<KitchenOrder[]>(`/kitchen/orders?${params.toString()}`);
      return response.data;
    },
    enabled: !!branchId,
    refetchInterval: 5000,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ orderId, status }: { orderId: number; status: string }) => {
      const response = await apiClient.patch(`/kitchen/orders/${orderId}/status`, {
        status,
        branch_id: +branchId,
      });
      return response.data;
    },
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['kitchen-orders'] });
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
  });

  const handlePrintKot = async (orderId: number) => {
    try {
      const response = await apiClient.get(`/kitchen/orders/${orderId}/kot?branch_id=${branchId}`);
      const data = response.data ?? {};
      const orderTypeLabel = formatOrderType(data.order_type);
      const placedStr = data.placed_at ? new Date(data.placed_at).toLocaleString() : '—';
      const itemsHtml = (data.items ?? []).map((i: any) => {
        const nameLine = `${i.quantity}× ${(i.name ?? '').trim()}${i.variant_name ? ` — ${i.variant_name}` : ''}`;
        const notesLine = i.notes ? `<div class="kot-note">Note: ${escapeHtml(i.notes)}</div>` : '';
        const addonsStr = (i.addons ?? []).map((a: any) => `${a.name} ×${a.quantity ?? 1}`).join(', ');
        const addonsLine = addonsStr ? `<div class="kot-addons">Add-ons: ${escapeHtml(addonsStr)}</div>` : '';
        return `<div class="kot-item">${escapeHtml(nameLine)}${addonsLine}${notesLine}</div>`;
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
    ready: 'completed',
  };

  useEffect(() => {
    if (!branchId && branches?.length) {
      setBranchId(String(branches[0].id));
    }
  }, [branchId, branches]);

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100 p-6">
      <div className="max-w-7xl mx-auto">
        <div className="flex justify-between items-center mb-6 flex-wrap gap-4">
          <h1 className="text-3xl font-bold">Kitchen Display</h1>
          <div className="flex gap-4 items-center">
            <select
              value={branchId}
              onChange={(e) => setBranchId(e.target.value)}
              className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
            >
              <option value="">Select branch</option>
              {branches?.map((b: any) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="px-4 py-2 bg-gray-800 border border-gray-600 rounded-lg text-white"
            >
              <option value="">All statuses</option>
              <option value="placed">Placed</option>
              <option value="accepted">Accepted</option>
              <option value="preparing">Preparing</option>
              <option value="ready">Ready</option>
              <option value="completed">Completed</option>
            </select>
          </div>
        </div>

        {!branchId ? (
          <Card className="p-8 text-center bg-gray-800 border-gray-700">
            <p className="text-gray-400">Select a branch to view kitchen orders.</p>
          </Card>
        ) : isLoading ? (
          <Loader fullScreen text="Loading orders..." />
        ) : !orders?.length ? (
          <Card className="p-8 text-center bg-gray-800 border-gray-700">
            <p className="text-gray-400">No orders in queue.</p>
          </Card>
        ) : (
          <>
            <p className="text-gray-400 text-sm mb-4">Queue order: newest first (#1 = most recent).</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {(orders as KitchenOrder[]).map((order, index) => (
              <Card key={order.id} className="bg-white border border-gray-200 shadow-lg overflow-hidden">
                {/* Header: queue #, order #, status, Print KOT */}
                <div className="px-4 py-3 bg-gray-50 border-b border-gray-200 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <span className="flex items-center justify-center w-9 h-9 rounded-lg bg-gray-900 text-white font-bold text-base shrink-0" title="Queue position">
                      {index + 1}
                    </span>
                    <div>
                      <span className="text-lg font-bold text-gray-900">#{order.order_number}</span>
                      <span className="ml-2 px-2.5 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wide bg-amber-100 text-amber-800 border border-amber-200">
                        {order.status}
                      </span>
                    </div>
                  </div>
                  <Button
                    size="small"
                    variant="outline"
                    onClick={() => handlePrintKot(order.id)}
                    className="border-gray-400 text-gray-700 hover:bg-gray-100"
                  >
                    Print KOT
                  </Button>
                </div>
                {/* Order type, table, time, customer */}
                <div className="px-4 py-2.5 border-b border-gray-100">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
                    <span className="font-semibold text-gray-900">{formatOrderType(order.order_type)}</span>
                    {order.table_number && <span className="text-gray-600">Table {order.table_number}</span>}
                    {order.placed_at && (
                      <span className="text-gray-500">{new Date(order.placed_at).toLocaleTimeString()}</span>
                    )}
                  </div>
                  {order.customer_name && (
                    <p className="text-sm text-gray-600 mt-1">Customer: {order.customer_name}</p>
                  )}
                </div>
                {/* Items with variant, add-ons, notes */}
                <div className="px-4 py-3 space-y-3">
                  {order.items?.map((item) => (
                    <div key={item.id} className="border-l-2 border-gray-200 pl-3">
                      <p className="text-base font-semibold text-gray-900">
                        {item.quantity}× {item.name ?? item.name_snapshot ?? 'Item'}
                        {item.variant_name && (
                          <span className="font-normal text-gray-600"> — {item.variant_name}</span>
                        )}
                      </p>
                      {item.addons?.length ? (
                        <p className="text-sm text-gray-700 mt-0.5">
                          Add-ons: {item.addons.map((a) => `${a.name} ×${a.quantity ?? 1}`).join(', ')}
                        </p>
                      ) : null}
                      {item.notes && (
                        <p className="text-sm mt-0.5 text-amber-700 bg-amber-50 px-2 py-1 rounded border border-amber-200">
                          Note: {item.notes}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
                {/* Actions */}
                <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex gap-2 flex-wrap">
                  {nextStatus[order.status] && (
                    <Button
                      size="small"
                      onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: nextStatus[order.status] })}
                      isLoading={updateStatusMutation.isPending}
                      className="bg-green-600 hover:bg-green-700 text-white font-medium"
                    >
                      → {nextStatus[order.status]}
                    </Button>
                  )}
                  {order.status === 'ready' && (
                    <Button
                      size="small"
                      onClick={() => updateStatusMutation.mutate({ orderId: order.id, status: 'completed' })}
                      isLoading={updateStatusMutation.isPending}
                      className="bg-blue-600 hover:bg-blue-700 text-white font-medium"
                    >
                      Complete
                    </Button>
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
