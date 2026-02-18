import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { orderService } from '../services/api';
import { formatCurrency } from '../utils/currency';
import { printContent } from '../utils/print';
import Modal from './Modal';
import Loader from './Loader';
import Button from './Button';

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export type MainInvoiceOrder = {
  order_id: number;
  order_number: string;
  brand_name?: string | null;
  items: Array<{ name_snapshot?: string; quantity: number; unit_price: number; subtotal: number }>;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  service_charge: number;
  delivery_fee: number;
  total_amount: number;
  loyalty_points_earned?: number;
  loyalty_points_redeemed?: number;
};

export type MainInvoiceData = {
  order_group_id: string;
  orders: MainInvoiceOrder[];
  gross_total: number;
};

interface CustomerInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderGroupId: string | null;
  /** When set and orderGroupId is null, show single-order invoice (e.g. for orders without a group). */
  orderId?: number | null;
}

const CustomerInvoiceModal: React.FC<CustomerInvoiceModalProps> = ({
  isOpen,
  onClose,
  orderGroupId,
  orderId,
}) => {
  const hasGroup = !!orderGroupId;
  const hasSingle = !!orderId && !orderGroupId;

  const { data: mainInvoice, isLoading: loadingGroup, error: errorGroup } = useQuery({
    queryKey: ['order-group-main-invoice', orderGroupId],
    queryFn: () => orderService.getOrderGroupMainInvoice(orderGroupId!),
    enabled: isOpen && hasGroup,
  });

  const { data: singleInvoice, isLoading: loadingSingle, error: errorSingle } = useQuery({
    queryKey: ['order-invoice', orderId],
    queryFn: () => orderService.getOrderInvoice(orderId!),
    enabled: isOpen && hasSingle,
  });

  const isLoading = hasGroup ? loadingGroup : loadingSingle;
  const error = hasGroup ? errorGroup : errorSingle;

  const invoiceData: MainInvoiceData | null = mainInvoice ?? (singleInvoice ? {
    order_group_id: singleInvoice.order_group_id ?? `order-${singleInvoice.order_id}`,
    orders: [{
      order_id: singleInvoice.order_id,
      order_number: singleInvoice.order_number,
      brand_name: singleInvoice.brand?.name ?? null,
      items: (singleInvoice.items ?? []).map((i: { name?: string; quantity: number; unit_price: number; subtotal: number }) => ({
        name_snapshot: i.name,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
      })),
      subtotal: singleInvoice.subtotal ?? 0,
      discount_amount: singleInvoice.discount_amount ?? 0,
      tax_amount: singleInvoice.tax_amount ?? 0,
      service_charge: singleInvoice.service_charge ?? 0,
      delivery_fee: singleInvoice.delivery_fee ?? 0,
      total_amount: singleInvoice.total_amount ?? 0,
      loyalty_points_earned: singleInvoice.loyalty_points_earned ?? 0,
      loyalty_points_redeemed: singleInvoice.loyalty_points_redeemed ?? 0,
    }],
    gross_total: singleInvoice.total_amount ?? 0,
  } : null);

  const handlePrint = () => {
    if (!invoiceData) return;
    const ordersHtml = (invoiceData.orders ?? []).map((o: MainInvoiceOrder) => {
      const itemsRows = (o.items ?? [])
        .map((line: { name_snapshot?: string; quantity: number; subtotal: number }) => `<tr><td>${escapeHtml(line.name_snapshot ?? 'Item')} × ${line.quantity}</td><td class="text-right">${formatCurrency(Number(line.subtotal))}</td></tr>`)
        .join('');
      const pointsEarned = Number((o as MainInvoiceOrder).loyalty_points_earned ?? 0);
      const pointsRedeemed = Number((o as MainInvoiceOrder).loyalty_points_redeemed ?? 0);
      return `
        <div class="section">
          <h2>${o.brand_name ? escapeHtml(o.brand_name) + ' — ' : ''}Order #${escapeHtml(o.order_number)}</h2>
          <table><tbody>${itemsRows}</tbody></table>
          <p class="text-sm py-2 border-t">Subtotal: ${formatCurrency(Number(o.subtotal))}</p>
          ${Number(o.discount_amount) > 0 ? `<p class="text-sm">Discount: -${formatCurrency(Number(o.discount_amount))}</p>` : ''}
          <p class="text-sm">Tax: ${formatCurrency(Number(o.tax_amount))} · Service: ${formatCurrency(Number(o.service_charge))}</p>
          ${Number(o.delivery_fee) > 0 ? `<p class="text-sm">Delivery: ${formatCurrency(Number(o.delivery_fee))}</p>` : ''}
          ${pointsEarned > 0 ? `<p class="text-sm text-green-700">Points earned: ${pointsEarned}</p>` : ''}
          ${pointsRedeemed > 0 ? `<p class="text-sm text-gray-600">Points redeemed: ${pointsRedeemed}</p>` : ''}
          <p class="font-semibold py-2">Total: ${formatCurrency(Number(o.total_amount))}</p>
        </div>
      `;
    }).join('');
    const html = `
      ${invoiceData.orders.length > 1 && invoiceData.order_group_id ? `<p class="meta">Order group: ${escapeHtml(invoiceData.order_group_id)}</p>` : ''}
      ${ordersHtml}
      <div class="section border-t total-row" style="margin-top: 24px; padding-top: 16px;">
        <p class="font-bold">${invoiceData.orders.length > 1 ? 'Gross total' : 'Total'}: ${formatCurrency(Number(invoiceData.gross_total ?? 0))}</p>
      </div>
    `;
    printContent(html, 'Customer invoice');
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Customer invoice"
      size="large"
    >
      {!orderGroupId && !orderId ? (
        <p className="text-gray-500 py-4">No order selected.</p>
      ) : isLoading ? (
        <div className="py-8 flex justify-center">
          <Loader text="Loading invoice…" />
        </div>
      ) : error ? (
        <p className="text-red-600 py-4">Failed to load invoice. Please try again.</p>
      ) : invoiceData ? (
        <div className="space-y-6">
          {invoiceData.order_group_id && (
            <div className="text-xs text-gray-500 font-mono border-b border-gray-100 pb-2">
              {invoiceData.orders.length > 1 ? 'Order group: ' : ''}{invoiceData.order_group_id}
            </div>
          )}
          <div className="space-y-4 max-h-[60vh] overflow-y-auto pr-1">
            {(invoiceData.orders ?? []).map((o: MainInvoiceOrder) => (
              <div
                key={o.order_id}
                className="rounded-xl border border-gray-200 bg-gray-50/80 p-4 shadow-sm"
              >
                <h3 className="font-semibold text-gray-800 mb-3 flex items-center gap-2">
                  {o.brand_name && (
                    <span className="text-sm font-medium text-gray-500 uppercase tracking-wide">
                      {o.brand_name}
                    </span>
                  )}
                  <span className="text-gray-400">—</span>
                  <span>Order #{o.order_number}</span>
                </h3>
                <table className="w-full text-sm">
                  <tbody>
                    {(o.items ?? []).map((line: { name_snapshot?: string; quantity: number; unit_price: number; subtotal: number }, i: number) => (
                      <tr key={i} className="border-b border-gray-100 last:border-0">
                        <td className="py-1.5 text-gray-700">
                          {line.name_snapshot ?? 'Item'} × {line.quantity}
                        </td>
                        <td className="py-1.5 text-right font-medium text-gray-800">
                          {formatCurrency(Number(line.subtotal))}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <div className="mt-3 pt-3 border-t border-gray-200 space-y-1 text-sm">
                  <div className="flex justify-between text-gray-600">
                    <span>Subtotal</span>
                    <span>{formatCurrency(Number(o.subtotal))}</span>
                  </div>
                  {Number(o.discount_amount) > 0 && (
                    <div className="flex justify-between text-green-600">
                      <span>Discount</span>
                      <span>-{formatCurrency(Number(o.discount_amount))}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-gray-600">
                    <span>Tax</span>
                    <span>{formatCurrency(Number(o.tax_amount))}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Service charge</span>
                    <span>{formatCurrency(Number(o.service_charge))}</span>
                  </div>
                  {Number(o.delivery_fee) > 0 && (
                    <div className="flex justify-between text-gray-600">
                      <span>Delivery</span>
                      <span>{formatCurrency(Number(o.delivery_fee))}</span>
                    </div>
                  )}
                  {(Number((o as MainInvoiceOrder).loyalty_points_earned) > 0 || Number((o as MainInvoiceOrder).loyalty_points_redeemed) > 0) && (
                    <>
                      {Number((o as MainInvoiceOrder).loyalty_points_earned) > 0 && (
                        <div className="flex justify-between text-green-700">
                          <span>Points earned</span>
                          <span>+{(o as MainInvoiceOrder).loyalty_points_earned}</span>
                        </div>
                      )}
                      {Number((o as MainInvoiceOrder).loyalty_points_redeemed) > 0 && (
                        <div className="flex justify-between text-gray-600">
                          <span>Points redeemed</span>
                          <span>−{(o as MainInvoiceOrder).loyalty_points_redeemed}</span>
                        </div>
                      )}
                    </>
                  )}
                  <div className="flex justify-between font-semibold text-gray-800 pt-1">
                    <span>Total</span>
                    <span>{formatCurrency(Number(o.total_amount))}</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <div className="rounded-xl bg-gray-800 text-white p-4 flex justify-between items-center">
            <span className="text-lg font-semibold">{invoiceData.orders.length > 1 ? 'Gross total' : 'Total'}</span>
            <span className="text-2xl font-bold">{formatCurrency(Number(invoiceData.gross_total ?? 0))}</span>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={handlePrint}>
              Print
            </Button>
            <Button variant="outline" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 py-4">No invoice data.</p>
      )}
    </Modal>
  );
};

export default CustomerInvoiceModal;
