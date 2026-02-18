import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { Order } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency } from '../../utils/currency';
import { formatOrderType } from '../../utils/format';
import { printContent } from '../../utils/print';
import Button from '../../components/Button';
import Card from '../../components/Card';
import CustomerInvoiceModal from '../../components/CustomerInvoiceModal';

type OrderDetailItem = {
  id: number;
  name_snapshot?: string;
  price_snapshot?: number;
  quantity: number;
  unit_price: number;
  subtotal: number;
  notes?: string;
  variant_id?: number | null;
  variant_name?: string | null;
  addons?: Array<{ name: string; unit_price: number; quantity: number }>;
};

type OrderDetailData = Order & {
  order_number?: string;
  order_type?: string;
  order_group_id?: string | null;
  table_number?: string;
  customer_name?: string;
  customer_phone?: string;
  delivery_address?: string;
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
  payments?: Array<{ id: number; method: string; amount: number; status: string; paid_at?: string }>;
  loyalty_points_earned?: number;
  loyalty_points_redeemed?: number;
};

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

const OrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [showCustomerInvoice, setShowCustomerInvoice] = useState(false);

  const { data: order, isLoading } = useQuery({
    queryKey: ['admin-order', id],
    queryFn: async () => {
      const response = await apiClient.get<OrderDetailData>(`/admin/orders/${id}`);
      return response.data;
    },
    enabled: !!id,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const response = await apiClient.put(`/admin/orders/${id}/status`, { status });
      return response.data;
    },
    onSuccess: (_data, status) => {
      queryClient.invalidateQueries({ queryKey: ['admin-order', id] });
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

  if (isLoading || !order) return <Loader fullScreen text="Loading order..." />;

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
    let itemsHtml = (o.items ?? [])
      .map(
        (item) =>
          `<tr><td>${escapeHtml(String(item.name_snapshot ?? 'Item'))} × ${item.quantity}${
            item.variant_name ? ` (${escapeHtml(item.variant_name)})` : ''
          }${item.addons?.length ? '<br/><small>Add-ons: ' + item.addons.map((a) => `${a.name} × ${a.quantity}`).join(', ') + '</small>' : ''}</td><td class="text-right">${formatCurrency(Number(item.subtotal ?? 0))}</td></tr>`
      )
      .join('');
    const html = `
      <h1>Order #${escapeHtml(String(orderNum))}</h1>
      ${o.brand?.name ? `<p class="meta">${escapeHtml(o.brand.name)}</p>` : ''}
      <p class="meta">${escapeHtml(typeLabel)} · ${o.branch ? escapeHtml(o.branch.name) : ''} · ${o.placed_at ? new Date(o.placed_at).toLocaleString() : ''}</p>
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
    printContent(html, `Order ${orderNum}`);
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-4 mb-6">
        <Button variant="outline" onClick={() => navigate('/admin/orders')}>
          ← Back to Orders
        </Button>
        <div className="flex gap-2">
          <Button variant="outline" onClick={handlePrint}>
            Print
          </Button>
          <Button variant="outline" onClick={() => setShowCustomerInvoice(true)}>
            Customer invoice
          </Button>
        </div>
      </div>

      <Card className="p-6 mb-6 border border-gray-200 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">
              Order #{o.order_number ?? (order as any).order_number}
            </h1>
            {o.brand?.name && (
              <p className="text-sm font-medium text-gray-500 uppercase tracking-wide">{o.brand.name}</p>
            )}
          </div>
          <span className={`px-3 py-1.5 rounded-full text-sm font-medium ${
            o.status === 'completed' ? 'bg-emerald-100 text-emerald-800' :
            o.status === 'cancelled' ? 'bg-red-100 text-red-800' :
            'bg-sky-100 text-sky-800'
          }`}>
            {o.status}
          </span>
        </div>
        <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-gray-600 mb-4">
          <span>Type: <strong className="text-gray-800">{formatOrderType(o.order_type ?? (order as any).order_type)}</strong></span>
          {o.branch && <span>Branch: <strong className="text-gray-800">{o.branch.name}</strong></span>}
          {o.creator && <span>Created by: {o.creator.name}</span>}
          {o.placed_at && <span>Placed: {new Date(o.placed_at).toLocaleString()}</span>}
        </div>
        {(o.table_number || o.customer_name || o.customer_phone || o.delivery_address) && (
          <div className="rounded-lg bg-gray-50 p-4 text-sm text-gray-700 space-y-1 mb-4">
            {o.table_number && <p><span className="font-medium text-gray-500">Table:</span> {o.table_number}</p>}
            {o.customer_name && <p><span className="font-medium text-gray-500">Customer:</span> {o.customer_name}</p>}
            {o.customer_phone && <p><span className="font-medium text-gray-500">Phone:</span> {o.customer_phone}</p>}
            {o.delivery_address && <p><span className="font-medium text-gray-500">Delivery:</span> {o.delivery_address}</p>}
          </div>
        )}
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Update status</label>
          <select
            value={o.status}
            onChange={(e) => updateStatusMutation.mutate(e.target.value)}
            className="px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
          >
            <option value="placed">Placed</option>
            <option value="accepted">Accepted</option>
            <option value="preparing">Preparing</option>
            <option value="ready">Ready</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </Card>

      <Card className="p-6 mb-6 border border-gray-200 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Items</h2>
        <div className="space-y-4">
          {o.items?.map((item) => (
            <div
              key={item.id}
              className="rounded-xl border border-gray-100 bg-gray-50/50 p-4"
            >
              <div className="flex justify-between items-start gap-4">
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-gray-900">
                    {item.name_snapshot ?? (item as any).name_snapshot} × {item.quantity}
                  </p>
                  {item.variant_name && (
                    <p className="text-sm text-gray-600 mt-0.5">
                      Variant: <span className="font-medium">{item.variant_name}</span>
                    </p>
                  )}
                  {item.addons && item.addons.length > 0 && (
                    <div className="mt-2 text-sm text-gray-600">
                      <span className="font-medium text-gray-500">Add-ons:</span>
                      <ul className="mt-1 space-y-0.5">
                        {item.addons.map((a, i) => (
                          <li key={i}>
                            {a.name} × {a.quantity}
                            {a.unit_price != null && a.unit_price > 0 && (
                              <span className="text-gray-500 ml-1">({formatCurrency(Number(a.unit_price))} each)</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  {item.notes && (
                    <p className="text-sm text-gray-500 italic mt-1">Note: {item.notes}</p>
                  )}
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm text-gray-500">
                    {formatCurrency(Number(item.unit_price ?? 0))} × {item.quantity}
                  </p>
                  <p className="font-semibold text-gray-900">{formatCurrency(Number(item.subtotal ?? 0))}</p>
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      <Card className="p-6 mb-6 border border-gray-200 shadow-sm">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Totals</h2>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between text-gray-700">
            <span>Subtotal</span>
            <span>{formatCurrency(subtotal)}</span>
          </div>
          {hasDiscount && (
            <div className="flex justify-between text-emerald-600">
              <span>
                Discount
                {hasCoupon && (
                  <span className="ml-1 text-gray-500">(Coupon: <strong>{o.discount_code}</strong>)</span>
                )}
              </span>
              <span>-{formatCurrency(discountAmount)}</span>
            </div>
          )}
          {!hasDiscount && hasCoupon && (
            <div className="flex justify-between text-gray-500">
              <span>Coupon applied: {o.discount_code}</span>
              <span>—</span>
            </div>
          )}
          <div className="flex justify-between text-gray-700">
            <span>Tax</span>
            <span>{formatCurrency(taxAmount)}</span>
          </div>
          {serviceCharge > 0 && (
            <div className="flex justify-between text-gray-700">
              <span>Service charge</span>
              <span>{formatCurrency(serviceCharge)}</span>
            </div>
          )}
          {deliveryFee > 0 && (
            <div className="flex justify-between text-gray-700">
              <span>Delivery fee</span>
              <span>{formatCurrency(deliveryFee)}</span>
            </div>
          )}
          {(o.loyalty_points_earned ?? 0) > 0 && (
            <div className="flex justify-between text-green-700">
              <span>Points earned</span>
              <span>+{o.loyalty_points_earned}</span>
            </div>
          )}
          {(o.loyalty_points_redeemed ?? 0) > 0 && (
            <div className="flex justify-between text-gray-600">
              <span>Points redeemed</span>
              <span>−{o.loyalty_points_redeemed}</span>
            </div>
          )}
          <div className="flex justify-between font-bold text-lg pt-3 mt-3 border-t border-gray-200">
            <span>Total</span>
            <span className="text-gray-900">{formatCurrency(totalAmount)}</span>
          </div>
        </div>
      </Card>

      {o.payments && o.payments.length > 0 && (
        <Card className="p-6 border border-gray-200 shadow-sm">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Payments</h2>
          <div className="space-y-2">
            {o.payments.map((p) => (
              <div key={p.id} className="flex justify-between items-center py-2 border-b border-gray-100 last:border-0">
                <span className="font-medium text-gray-800">{p.method}</span>
                <span className="text-gray-600">{p.status}</span>
                <span className="font-semibold">{formatCurrency(Number(p.amount))}</span>
                {p.paid_at && (
                  <span className="text-sm text-gray-500">{new Date(p.paid_at).toLocaleString()}</span>
                )}
              </div>
            ))}
          </div>
        </Card>
      )}

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
