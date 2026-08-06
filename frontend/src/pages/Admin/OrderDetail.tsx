import React, { useState } from 'react';
import { orderModifiersWithNesting } from '../../utils/modifierNesting';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { Order } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import { formatOrderType } from '../../utils/format';
import { printContent } from '../../utils/print';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';
import Button from '../../components/Button';
import { useHasPermission } from '../../hooks/useHasPermission';
import Card from '../../components/Card';
import { deliveryStatusLabel, deliveryStatusTone, isDeliveryFailed } from '../../lib/deliveryStatus';
import CustomerInvoiceModal from '../../components/CustomerInvoiceModal';
import { groupOrderItems } from '../../utils/orderItemGrouping';

type OrderDetailItem = {
  id: number;
  name_snapshot?: string;
  price_snapshot?: number;
  quantity: number;
  unit_price: number;
  subtotal: number;
  notes?: string;
  triggered_by?: string | null;
  variant_id?: number | null;
  variant_name?: string | null;
  deal_id?: number | null;
  deal_slot_index?: number | null;
  deal_name?: string | null;
  addons?: Array<{ name: string; unit_price: number; quantity: number; subtotal?: number }>;
  modifiers?: Array<{ name: string | null; unit_price: number; group?: string | null }>;
};

type OrderRatingsResponse = {
  rider_rating: { stars: number; comment?: string | null; rated_at: string | null } | null;
  brand_ratings: Array<{
    brand_id: number;
    brand_name: string | null;
    order_stars: number;
    order_comment?: string | null;
    order_rated_at: string | null;
    public_rating_average: number | null;
    public_rating_count: number;
  }>;
};

type OrderDetailData = Omit<Order, 'items' | 'payments'> & {
  order_number?: string;
  order_type?: string;
  order_group_id?: string | null;
  table_number?: string;
  notes?: string;
  customer_name?: string;
  customer_phone?: string;
  delivery_address?: string;
  source?: 'pos' | 'consumer_app' | string;
  subtotal?: number;
  discount_amount?: number;
  tax_amount?: number;
  service_charge?: number;
  delivery_fee?: number;
  total_amount?: number;
  discount_code?: string;
  placed_at?: string;
  completed_at?: string;
  branch?: { id: number; name: string; code: string };
  brand?: { id: number; name: string };
  creator?: { id: number; name: string };
  items?: OrderDetailItem[];
  payments?: Array<{ id: number; method?: string; payment_method?: string; amount: number; status: string; paid_at?: string }>;
  loyalty_points_earned?: number;
  loyalty_points_redeemed?: number;
  rider_id?: number | null;
  rider?: { id: number; name: string } | null;
  delivery_status?: string | null;
  /** Why the rider could not deliver. Set by the rider when marking delivery failed. */
  delivery_failed_reason?: string | null;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function formatStars(n: number): string {
  const s = Math.max(1, Math.min(5, Math.round(Number(n) || 0)));
  return `${'★'.repeat(s)}${'☆'.repeat(5 - s)} (${s}/5)`;
}

function formatOrderSourceLabel(source: string | null | undefined): string {
  if (source === 'consumer_app') return 'Consumer app';
  if (source === 'pos') return 'POS';
  if (!source) return '—';
  return source.replace(/_/g, ' ');
}

const OrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const canUpdateStatus = useHasPermission('orders:update-status');
  const queryClient = useQueryClient();
  const [showCustomerInvoice, setShowCustomerInvoice] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['admin-order', id],
    queryFn: async () => {
      const response = await apiClient.get<OrderDetailData>(`/admin/orders/${id}`);
      return response.data;
    },
    enabled: !!id,
    refetchInterval: ORDER_POLL_INTERVAL_MS,
  });

  const { data: ratings, isLoading: ratingsLoading } = useQuery({
    queryKey: ['admin-order-ratings', id],
    queryFn: async () => {
      const response = await apiClient.get<OrderRatingsResponse>(`/admin/orders/${id}/ratings`);
      return response.data;
    },
    enabled: !!id,
    refetchInterval: ORDER_POLL_INTERVAL_MS,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const response = await apiClient.put(`/admin/orders/${id}/status`, { status });
      return response.data;
    },
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ['admin-order', id] });
      queryClient.invalidateQueries({ queryKey: ['admin-order-ratings', id] });
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

  const isSubmitting = updateStatusMutation.isPending;
  if (isLoading || !order || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Updating...' : 'Loading order...'} />;
  }

  const o = order as OrderDetailData;
  const totalAmount = Number(o.total_amount ?? order.total_amount ?? 0);
  const subtotal = Number(o.subtotal ?? 0);
  const discountAmount = Number(o.discount_amount ?? 0);
  const taxAmount = Number(o.tax_amount ?? 0);
  const serviceCharge = Number(o.service_charge ?? 0);
  const deliveryFee = Number(o.delivery_fee ?? 0);
  const hasDiscount = discountAmount > 0;
  const hasCoupon = !!(o.discount_code?.trim());

  const handlePrint = () => {
    const orderNum = o.order_number ?? (order as any).order_number;
    const typeLabel = formatOrderType(o.order_type ?? (order as any).order_type);
    const addonTotal = (a: { quantity: number; unit_price: number; subtotal?: number }) =>
      a.subtotal != null ? Number(a.subtotal) : Number(a.unit_price) * (a.quantity ?? 1);
    let itemsHtml = (o.items ?? [])
      .map((item) => {
        const base = Number(item.unit_price ?? 0) * item.quantity;
        const baseRow = `<tr><td>${escapeHtml(String(item.name_snapshot ?? 'Item'))}${item.variant_name ? ` <span style="color:#666;">(Variant: ${escapeHtml(item.variant_name)})</span>` : ''} × ${item.quantity}</td><td class="text-right">${formatCurrency(base)}</td></tr>`;
        const addonRows = (item.addons ?? []).map((a) => `<tr class="sub"><td style="padding-left:14px;">Add-on: ${escapeHtml(a.name ?? '—')}${Number(a.quantity ?? 1) !== 1 ? ` × ${a.quantity}` : ''}</td><td class="text-right">${formatCurrency(addonTotal(a))}</td></tr>`).join('');
        const modRows = orderModifiersWithNesting(item.modifiers ?? [])
          .map(({ mod: m, nested }) =>
            nested
              ? `<tr class="sub"><td style="padding-left:28px;">↳ ${escapeHtml(m.name ?? '—')}</td><td class="text-right">${Number(m.unit_price) ? formatCurrency(Number(m.unit_price)) : '<span style="color:#067647;">Included</span>'}</td></tr>`
              : `<tr class="sub"><td style="padding-left:14px;">${escapeHtml(m.group ?? 'Modifier')}: ${escapeHtml(m.name ?? '—')}</td><td class="text-right">${formatCurrency(Number(m.unit_price))}</td></tr>`,
          )
          .join('');
        const noteRow = item.notes ? `<tr class="sub"><td colspan="2" style="padding-left:28px; font-style:italic; color:#b45309;">Note: ${escapeHtml(item.notes)}</td></tr>` : '';
        const hasExtras = (item.addons?.length ?? 0) > 0 || (item.modifiers?.length ?? 0) > 0;
        const lineTotalRow = hasExtras ? `<tr class="sub"><td style="padding-left:14px; font-style:italic; color:#666;">Line total</td><td class="text-right" style="font-style:italic; color:#666;">${formatCurrency(Number(item.subtotal ?? 0))}</td></tr>` : '';
        return `${baseRow}${addonRows}${modRows}${noteRow}${lineTotalRow}`;
      })
      .join('');
    const html = `
      <h1>Order #${escapeHtml(String(orderNum))}</h1>
      ${o.brand?.name ? `<p class="meta">${escapeHtml(o.brand.name)}</p>` : ''}
      <p class="meta">${escapeHtml(typeLabel)} · ${o.branch ? escapeHtml(o.branch.name) : ''} · ${o.placed_at ? new Date(o.placed_at).toLocaleString() : ''}</p>
      ${o.notes ? `<div class="section"><p class="font-medium">Order note: ${escapeHtml(o.notes)}</p></div>` : ''}
      ${o.table_number || o.customer_name || o.customer_phone ? `<div class="section"><p class="font-medium">${o.table_number ? `Table: ${escapeHtml(o.table_number)}` : ''} ${o.customer_name ? ` · Customer: ${escapeHtml(o.customer_name)}` : ''} ${o.customer_phone ? ` · Phone: ${escapeHtml(o.customer_phone)}` : ''}</p></div>` : ''}
      <h2>Items</h2>
      <table><thead><tr><th>Item</th><th class="text-right">Amount</th></tr></thead><tbody>${itemsHtml}</tbody></table>
      <h2>Totals</h2>
      <p class="py-2 border-t">Subtotal: ${formatCurrency(subtotal)}</p>
      ${hasDiscount ? `<p class="py-2">Discount${hasCoupon ? ` (${escapeHtml(o.discount_code ?? '')})` : ''}: -${formatCurrency(discountAmount)}</p>` : ''}
      <p class="py-2">Tax: ${formatCurrency(taxAmount)}</p>
      ${serviceCharge > 0 ? `<p class="py-2">Service charge: ${formatCurrency(serviceCharge)}</p>` : ''}
      ${deliveryFee > 0 ? `<p class="py-2">Delivery fee: ${formatCurrency(deliveryFee)}</p>` : ''}
      ${(o.loyalty_points_earned ?? 0) > 0 ? `<p class="py-2 text-green-700">Points earned: ${o.loyalty_points_earned}</p>` : ''}
      ${(o.loyalty_points_redeemed ?? 0) > 0 ? `<p class="py-2 text-gray-600">Points redeemed: ${o.loyalty_points_redeemed}</p>` : ''}
      <p class="py-2 border-t total-row">Total: ${formatCurrency(totalAmount)}</p>
    `;
    printContent(html, `Order ${orderNum}`, '', {
      subject: 'order',
      entityId: Number(id) || undefined,
      label: `Order ${orderNum}`,
    });
  };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <Button variant="outline" onClick={() => navigate('/admin/orders')}>
          ← Back to Orders
        </Button>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={handlePrint}>
            Print
          </Button>
          <Button variant="view" onClick={() => setShowCustomerInvoice(true)}>
            Customer invoice
          </Button>
        </div>
      </div>

      <Card className="p-6 mb-6 border border-gray-200 dark:border-slate-700 dark:bg-slate-800 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-slate-100 mb-1">
              Order #{o.order_number ?? (order as any).order_number}
            </h1>
            {o.brand?.name && (
              <p className="text-sm font-medium text-gray-500 dark:text-slate-400 uppercase tracking-wide">{o.brand.name}</p>
            )}
          </div>
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
            o.status === 'completed' ? 'bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200' :
            o.status === 'cancelled' ? 'bg-red-100 dark:bg-red-900/50 text-red-800 dark:text-red-200' :
            'bg-sky-100 dark:bg-sky-900/50 text-sky-800 dark:text-sky-200'
          }`}>
            {o.status}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600 dark:text-slate-400 mb-4">
          <span>Type: <strong className="text-gray-800 dark:text-slate-200">{formatOrderType(o.order_type ?? (order as any).order_type)}</strong></span>
          <span className="flex items-center gap-2">
            <span>Source:</span>
            <span
              className={[
                'px-2 py-0.5 rounded text-xs font-medium',
                (o.source ?? 'pos') === 'pos'
                  ? 'bg-indigo-100 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200'
                  : (o.source ?? 'pos') === 'consumer_app'
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200'
                    : 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
              ].join(' ')}
              title="Order source"
            >
              {formatOrderSourceLabel(o.source)}
            </span>
          </span>
          {o.branch && <span>Branch: <strong className="text-gray-800 dark:text-slate-200">{o.branch.name}</strong></span>}
          {o.creator && <span>Created by: {o.creator.name}</span>}
          {o.placed_at && <span>Placed: {new Date(o.placed_at).toLocaleString()}</span>}
        </div>
        {o.notes && (
          <div className="mt-3 text-sm font-medium text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/40 px-3 py-2 rounded-lg border border-amber-200 dark:border-amber-700">
            Order note: {o.notes}
          </div>
        )}
        {(o.table_number || o.customer_name || o.customer_phone || o.delivery_address) && (
          <div className="rounded-lg bg-gray-50 dark:bg-slate-700/50 p-4 text-sm text-gray-700 dark:text-slate-300 space-y-1 mb-4">
            {o.table_number && <p><span className="font-medium text-gray-500 dark:text-slate-400">Table:</span> {o.table_number}</p>}
            {o.customer_name && <p><span className="font-medium text-gray-500 dark:text-slate-400">Customer:</span> {o.customer_name}</p>}
            {o.customer_phone && <p><span className="font-medium text-gray-500 dark:text-slate-400">Phone:</span> {o.customer_phone}</p>}
            {o.delivery_address && <p><span className="font-medium text-gray-500 dark:text-slate-400">Delivery:</span> {o.delivery_address}</p>}
          </div>
        )}
        {(o.delivery_status || o.rider) && (
          <div className="rounded-lg bg-gray-50 dark:bg-slate-700/50 p-4 mb-4 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-medium text-gray-500 dark:text-slate-400">Delivery status:</span>
              <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${deliveryStatusTone(o.delivery_status)}`}>
                {deliveryStatusLabel(o.delivery_status, { fallback: 'Not assigned' })}
              </span>
              {o.rider && (
                <span className="text-gray-700 dark:text-slate-300">
                  <span className="font-medium text-gray-500 dark:text-slate-400">Rider:</span> {o.rider.name}
                </span>
              )}
            </div>
            {/* The rider's own words for why it failed — previously stored but never shown. */}
            {isDeliveryFailed(o.delivery_status) && (
              <p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-red-800 dark:border-red-800 dark:bg-red-900/25 dark:text-red-200">
                <span className="font-semibold">Reason: </span>
                {o.delivery_failed_reason?.trim()
                  ? o.delivery_failed_reason
                  : 'No reason was recorded by the rider.'}
              </p>
            )}
          </div>
        )}
        {canUpdateStatus && <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700 dark:text-slate-300">Update status</label>
          <select
            value={o.status}
            onChange={(e) => updateStatusMutation.mutate(e.target.value)}
            className="px-4 py-2 border border-gray-300 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="placed">Placed</option>
            <option value="accepted">Accepted</option>
            <option value="preparing">Preparing</option>
            <option value="ready">Ready</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>}
      </Card>

      <Card className="p-6 mb-6 border border-gray-200 dark:border-slate-700 dark:bg-slate-800 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">Items</h2>
        <div className="space-y-4">
          {(() => {
            const renderItem = (item: OrderDetailItem) => {
              const baseAmount = Number(item.unit_price ?? 0) * (item.quantity ?? 1);
              const addonTotal = (a: { quantity: number; unit_price: number; subtotal?: number }) =>
                a.subtotal != null ? Number(a.subtotal) : Number(a.unit_price) * (a.quantity ?? 1);
              const hasExtras = (item.addons?.length ?? 0) > 0 || (item.modifiers?.length ?? 0) > 0;
              return (
                <div
                  key={item.id}
                  className="rounded-xl border border-gray-100 dark:border-slate-600 bg-gray-50/50 dark:bg-slate-700/50 p-4"
                >
                  <div className="flex justify-between items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-gray-900 dark:text-slate-100">
                        {item.name_snapshot ?? 'Item'}
                        {item.variant_name && (
                          <span className="text-gray-600 dark:text-slate-400 font-normal"> (Variant: {item.variant_name})</span>
                        )}
                        {' '}× {item.quantity}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <p className="text-sm text-gray-600 dark:text-slate-400">
                        {formatCurrency(Number(item.unit_price ?? 0))} × {item.quantity}
                      </p>
                      <p className="font-semibold text-gray-900 dark:text-slate-100">{formatCurrency(baseAmount)}</p>
                    </div>
                  </div>
                  {(item.addons ?? []).map((a, i) => (
                    <div key={`a-${i}`} className="flex justify-between items-center mt-1.5 pl-4 text-sm text-gray-600 dark:text-slate-400 border-b border-gray-100 dark:border-slate-600 pb-1">
                      <span>Add-on: {a.name ?? '—'}{Number(a.quantity ?? 1) !== 1 ? ` × ${a.quantity}` : ''}</span>
                      <span>{formatCurrency(addonTotal(a))}</span>
                    </div>
                  ))}
                  {orderModifiersWithNesting(item.modifiers ?? []).map(({ mod: m, nested }, i) => (
                    <div key={`m-${i}`} className={`flex justify-between items-center mt-1.5 ${nested ? 'pl-8' : 'pl-4'} text-sm text-gray-600 dark:text-slate-400 border-b border-gray-100 dark:border-slate-600 pb-1`}>
                      <span>{nested ? <>↳ {m.name ?? '—'}</> : <>{m.group ?? 'Modifier'}: {m.name ?? '—'}</>}</span>
                      <span>{nested && !Number(m.unit_price) ? <span className="text-emerald-600">Included</span> : formatCurrency(Number(m.unit_price))}</span>
                    </div>
                  ))}
                  {hasExtras && (
                    <div className="flex justify-between items-center mt-2 pt-2 border-t border-gray-200 dark:border-slate-600 text-sm">
                      <span className="font-medium text-gray-700 dark:text-slate-300">Line total</span>
                      <span className="font-semibold text-gray-900 dark:text-slate-100">{formatCurrency(Number(item.subtotal ?? 0))}</span>
                    </div>
                  )}
                  {item.notes && (
                    <p className="text-sm text-gray-500 dark:text-slate-400 italic mt-2">Note: {item.notes}</p>
                  )}
                </div>
              );
            };
            return groupOrderItems(o.items).map((group, gi) => {
              if (group.dealId == null) return group.lines.map(renderItem);
              const dealTotal = group.lines.reduce((s, l) => s + Number(l.subtotal ?? 0), 0);
              return (
                <div
                  key={`deal-${gi}`}
                  className="rounded-xl border-2 border-indigo-200 dark:border-indigo-800 bg-indigo-50/40 dark:bg-indigo-900/10 p-4"
                >
                  <div className="flex justify-between items-center mb-3">
                    <p className="font-bold text-indigo-700 dark:text-indigo-300">
                      <span className="mr-1.5 text-xs font-semibold uppercase tracking-wide text-indigo-500 dark:text-indigo-400">Deal</span>
                      {group.dealName ?? 'Deal'}
                    </p>
                    <p className="font-semibold text-gray-900 dark:text-slate-100">{formatCurrency(dealTotal)}</p>
                  </div>
                  <div className="space-y-3 border-l-2 border-indigo-200 dark:border-indigo-800 pl-3">
                    {group.lines.map(renderItem)}
                  </div>
                </div>
              );
            });
          })()}
        </div>
      </Card>

      <Card className="p-6 mb-6 border border-gray-200 dark:border-slate-700 dark:bg-slate-800 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-1">
          Customer ratings
        </h2>
        <p className="text-xs text-gray-500 dark:text-slate-400 mb-4 leading-relaxed">
          Stars only — no customer names or phones. Optional short comments may appear when the customer left feedback with their rating.
          Rider scores are internal (not shown on public menus). Public brand average is the same all-time figure customers see for that brand online.
        </p>
        {ratingsLoading ? (
          <p className="text-sm text-gray-500 dark:text-slate-400">Loading ratings…</p>
        ) : (
          <div className="space-y-5 text-sm">
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">
                Delivery rider (this order)
              </h3>
              {ratings?.rider_rating ? (
                <div className="rounded-lg bg-amber-50/80 dark:bg-amber-950/30 border border-amber-100 dark:border-amber-900/50 px-3 py-2 text-gray-800 dark:text-slate-200">
                  <p className="font-medium text-amber-900 dark:text-amber-100">{formatStars(ratings.rider_rating.stars)}</p>
                  {ratings.rider_rating.rated_at && (
                    <p className="text-xs text-amber-800/90 dark:text-amber-200/80 mt-1">
                      Updated {new Date(ratings.rider_rating.rated_at).toLocaleString()}
                    </p>
                  )}
                  {ratings.rider_rating.comment ? (
                    <p className="text-sm text-gray-700 dark:text-slate-300 mt-2 italic border-t border-amber-200/60 dark:border-amber-800/40 pt-2">
                      “{ratings.rider_rating.comment}”
                    </p>
                  ) : null}
                </div>
              ) : (
                <p className="text-gray-500 dark:text-slate-400">No rider rating for this order yet.</p>
              )}
            </div>
            <div>
              <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500 dark:text-slate-400 mb-2">
                Brand / food (this order)
              </h3>
              {ratings?.brand_ratings && ratings.brand_ratings.length > 0 ? (
                <ul className="space-y-3">
                  {ratings.brand_ratings.map((br) => (
                    <li
                      key={br.brand_id}
                      className="rounded-lg bg-slate-50 dark:bg-slate-700/40 border border-slate-100 dark:border-slate-600 px-3 py-2"
                    >
                      <p className="font-medium text-gray-900 dark:text-slate-100">
                        {br.brand_name ?? `Brand #${br.brand_id}`}
                      </p>
                      <p className="text-gray-700 dark:text-slate-300 mt-1">
                        This order: <span className="font-medium">{formatStars(br.order_stars)}</span>
                        {br.order_rated_at && (
                          <span className="text-xs text-gray-500 dark:text-slate-400 ml-2">
                            ({new Date(br.order_rated_at).toLocaleString()})
                          </span>
                        )}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-slate-400 mt-1">
                        Public average:{' '}
                        {br.public_rating_average != null ? (
                          <>
                            <strong className="text-gray-700 dark:text-slate-300">
                              {br.public_rating_average.toFixed(1)} / 5
                            </strong>
                            <span> · {br.public_rating_count} rating{br.public_rating_count === 1 ? '' : 's'} (all orders)</span>
                          </>
                        ) : (
                          <span>no public ratings yet</span>
                        )}
                      </p>
                      {br.order_comment ? (
                        <p className="text-sm text-gray-700 dark:text-slate-300 mt-2 italic border-t border-slate-200 dark:border-slate-600 pt-2">
                          “{br.order_comment}”
                        </p>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-gray-500 dark:text-slate-400">No brand ratings for this order yet.</p>
              )}
            </div>
          </div>
        )}
      </Card>

      <Card className="p-6 mb-6 border border-gray-200 dark:border-slate-700 dark:bg-slate-800 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">Totals</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-gray-700 dark:text-slate-300">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          {hasDiscount && (
            <div className="flex justify-between text-emerald-600 dark:text-emerald-400">
              <span>
                Discount
                {hasCoupon && (
                  <span className="ml-1 text-gray-500 dark:text-slate-400">(Coupon: <strong>{o.discount_code}</strong>)</span>
                )}
              </span>
              <span>-{formatCurrency(discountAmount)}</span>
            </div>
          )}
          {!hasDiscount && hasCoupon && (
            <div className="flex justify-between text-gray-500 dark:text-slate-400">
              <span>Coupon applied: {o.discount_code}</span>
              <span>—</span>
            </div>
          )}
          <div className="flex justify-between text-gray-700 dark:text-slate-300">
            <span>Tax</span>
            <span>{formatCurrency(taxAmount)}</span>
          </div>
          {serviceCharge > 0 && (
            <div className="flex justify-between text-gray-700 dark:text-slate-300">
              <span>Service charge</span>
              <span>{formatCurrency(serviceCharge)}</span>
            </div>
          )}
          {deliveryFee > 0 && (
            <div className="flex justify-between text-gray-700 dark:text-slate-300">
              <span>Delivery fee</span>
              <span>{formatCurrency(deliveryFee)}</span>
            </div>
          )}
          {(o.loyalty_points_earned ?? 0) > 0 && (
            <div className="flex justify-between text-green-700 dark:text-green-400">
              <span>Points earned</span>
              <span>+{o.loyalty_points_earned}</span>
            </div>
          )}
          {(o.loyalty_points_redeemed ?? 0) > 0 && (
            <div className="flex justify-between text-gray-600 dark:text-slate-400">
              <span>Points redeemed</span>
              <span>−{o.loyalty_points_redeemed}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg pt-3 mt-3 border-t border-gray-200 dark:border-slate-600">
            <span className="text-gray-900 dark:text-slate-100">Total</span>
            <span className="text-gray-900 dark:text-slate-100">{formatCurrency(totalAmount)}</span>
          </div>
        </div>
      </Card>

      <Card className="p-6 border border-gray-200 dark:border-slate-700 dark:bg-slate-800 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 dark:text-slate-100 mb-4">Payments</h2>
        {o.payments && o.payments.length > 0 ? (
          <div className="space-y-2">
            {o.payments.map((p) => (
              <div key={p.id} className="flex flex-wrap justify-between items-center gap-2 py-2 border-b border-gray-100 dark:border-slate-600 last:border-0">
                <span className="font-medium text-gray-800 dark:text-slate-200 capitalize">{p.method ?? (p as any).payment_method ?? '—'}</span>
                <span className="text-gray-600 dark:text-slate-400 text-sm">{p.status}</span>
                <span className="font-semibold text-gray-900 dark:text-slate-100">{formatCurrency(Number(p.amount))}</span>
                {p.paid_at && (
                  <span className="text-sm text-gray-500 dark:text-slate-400">{new Date(p.paid_at).toLocaleString()}</span>
                )}
              </div>
            ))}
          </div>
        ) : (
          <p className="text-gray-500 dark:text-slate-400 text-sm">No payments recorded for this order.</p>
        )}
      </Card>

      <CustomerInvoiceModal
        isOpen={showCustomerInvoice}
        onClose={() => setShowCustomerInvoice(false)}
        orderGroupId={o.order_group_id ?? null}
        orderId={o.id}
      />
    </div>
  );
};

export default OrderDetail;
