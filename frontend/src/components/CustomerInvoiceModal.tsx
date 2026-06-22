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

export type MainInvoiceLine = {
  name_snapshot?: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  variant_name?: string | null;
  deal_id?: number | null;
  deal_slot_index?: number | null;
  deal_name?: string | null;
  addons?: Array<{ name?: string | null; quantity: number; unit_price: number; subtotal?: number }>;
  modifiers?: Array<{ name?: string | null; unit_price: number; group?: string | null }>;
};

export type MainInvoiceOrder = {
  order_id: number;
  order_number: string;
  brand_name?: string | null;
  items: MainInvoiceLine[];
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  service_charge: number;
  delivery_fee: number;
  total_amount: number;
  loyalty_points_earned?: number;
  loyalty_points_redeemed?: number;
  loyalty_points_remaining?: number;
};

export type MainInvoiceData = {
  order_group_id: string;
  orders: MainInvoiceOrder[];
  gross_total: number;
  loyalty_points_remaining?: number;
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
      items: (singleInvoice.items ?? []).map((i: MainInvoiceLine & { name?: string }) => ({
        name_snapshot: i.name ?? i.name_snapshot,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
        variant_name: i.variant_name ?? null,
        deal_id: i.deal_id ?? null,
        deal_slot_index: i.deal_slot_index ?? null,
        addons: i.addons ?? [],
        modifiers: i.modifiers ?? [],
      })),
      subtotal: singleInvoice.subtotal ?? 0,
      discount_amount: singleInvoice.discount_amount ?? 0,
      tax_amount: singleInvoice.tax_amount ?? 0,
      service_charge: singleInvoice.service_charge ?? 0,
      delivery_fee: singleInvoice.delivery_fee ?? 0,
      total_amount: singleInvoice.total_amount ?? 0,
      loyalty_points_earned: singleInvoice.loyalty_points_earned ?? 0,
      loyalty_points_redeemed: singleInvoice.loyalty_points_redeemed ?? 0,
      loyalty_points_remaining: singleInvoice.loyalty_points_remaining ?? 0,
    }],
    gross_total: singleInvoice.total_amount ?? 0,
    loyalty_points_remaining: singleInvoice.loyalty_points_remaining ?? 0,
  } : null);

  const lineBaseTotal = (line: {
    quantity: number;
    unit_price: number;
  }) => {
    return Number(line.unit_price) * Number(line.quantity ?? 1);
  };

  const addonTotal = (a: { quantity: number; unit_price: number; subtotal?: number }) => {
    if (a.subtotal != null) return Number(a.subtotal);
    return Number(a.unit_price) * Number(a.quantity ?? 1);
  };

  /** Group invoice lines by deal_id for receipt: one row per deal (with optional component sub-rows), standalone items as-is. */
  const groupItemsForReceipt = (items: MainInvoiceLine[]): Array<{ dealId: number | null; lines: MainInvoiceLine[] }> => {
    const byDeal = new Map<number | 'standalone', MainInvoiceLine[]>();
    for (const line of items ?? []) {
      const key = line.deal_id != null ? line.deal_id : 'standalone';
      if (!byDeal.has(key)) byDeal.set(key, []);
      byDeal.get(key)!.push(line);
    }
    const result: Array<{ dealId: number | null; lines: MainInvoiceLine[] }> = [];
    byDeal.forEach((lines, key) => {
      if (key === 'standalone') {
        for (const line of lines) result.push({ dealId: null, lines: [line] });
      } else {
        lines.sort((a, b) => (a.deal_slot_index ?? 0) - (b.deal_slot_index ?? 0));
        result.push({ dealId: key as number, lines });
      }
    });
    return result;
  };

  const handlePrint = () => {
    if (!invoiceData) return;
    const ordersHtml = (invoiceData.orders ?? []).map((o: MainInvoiceOrder) => {
      const groups = groupItemsForReceipt(o.items ?? []);
      const itemsRows = groups.map((group) => {
        if (group.dealId != null && group.lines.length > 0) {
          const dealTotal = group.lines.reduce((s, l) => s + Number(l.subtotal), 0);
          const subRows = group.lines
            .map((line) => {
              const name = line.name_snapshot ?? 'Item';
              const variant = (line.variant_name ?? '').trim();
              return `<tr class="sub"><td style="padding-left:14px;">${escapeHtml(name)}${variant ? ` (${escapeHtml(variant)})` : ''} × ${line.quantity}</td><td class="text-right">${Number(line.unit_price) === 0 ? '—' : formatCurrency(Number(line.subtotal))}</td></tr>`;
            })
            .join('');
          const dealName = group.lines.find((l) => l.deal_name)?.deal_name ?? 'Deal';
          return `<tr><td><strong>${escapeHtml(dealName)}</strong></td><td class="text-right">${formatCurrency(dealTotal)}</td></tr>${subRows}`;
        }
        return group.lines.map((line) => {
          const name = line.name_snapshot ?? 'Item';
          const variant = (line.variant_name ?? '').trim();
          const base = lineBaseTotal(line);
          const addons = (line.addons ?? [])
            .map((a) => {
              const label = a.name ? `Add-on: ${a.name}` : 'Add-on';
              const qty = Number(a.quantity ?? 1);
              const amount = addonTotal(a);
              return `<tr class="sub"><td style="padding-left:14px;">${escapeHtml(label)}${qty !== 1 ? ` × ${qty}` : ''}</td><td class="text-right">${formatCurrency(amount)}</td></tr>`;
            })
            .join('');
          const mods = (line.modifiers ?? [])
            .map((m) => {
              const prefix = m.group ?? 'Modifier';
              const label = m.name ? `${prefix}: ${m.name}` : prefix;
              return `<tr class="sub"><td style="padding-left:14px;">${escapeHtml(label)}</td><td class="text-right">${formatCurrency(Number(m.unit_price))}</td></tr>`;
            })
            .join('');
          const baseRow = `<tr><td>${escapeHtml(name)}${variant ? ` <span style="color:#666;">(Variant: ${escapeHtml(variant)})</span>` : ''} × ${line.quantity}</td><td class="text-right">${formatCurrency(base)}</td></tr>`;
          const lineTotalRow = (addons || mods)
            ? `<tr class="sub"><td style="padding-left:14px; font-style:italic; color:#666;">Line total</td><td class="text-right" style="font-style:italic; color:#666;">${formatCurrency(Number(line.subtotal))}</td></tr>`
            : '';
          return `${baseRow}${addons}${mods}${lineTotalRow}`;
        }).join('');
      }).join('');
      const pointsEarned = Number((o as MainInvoiceOrder).loyalty_points_earned ?? 0);
      const pointsRedeemed = Number((o as MainInvoiceOrder).loyalty_points_redeemed ?? 0);
      const pointsRemaining = Number((o as MainInvoiceOrder).loyalty_points_remaining ?? invoiceData.loyalty_points_remaining ?? 0);
      return `
        <div class="section">
          <h2>${o.brand_name ? escapeHtml(o.brand_name) + ' — ' : ''}Order #${escapeHtml(o.order_number)}</h2>
          <table><tbody>${itemsRows}</tbody></table>
          <p class="text-sm py-2 border-t">Subtotal: ${formatCurrency(Number(o.subtotal))}</p>
          ${Number(o.discount_amount) > 0 ? `<p class="text-sm">Discount: -${formatCurrency(Number(o.discount_amount))}</p>` : ''}
          <p class="text-sm">Tax: ${formatCurrency(Number(o.tax_amount))}</p>
          ${Number(o.delivery_fee) > 0 ? `<p class="text-sm">Delivery fee: ${formatCurrency(Number(o.delivery_fee))}</p>` : ''}
          <p class="text-sm text-green-700">Earned points: ${pointsEarned}</p>
          <p class="text-sm text-gray-600">Redeemed points: ${pointsRedeemed}</p>
          <p class="text-sm text-gray-800">Remaining points: ${pointsRemaining}</p>
          <p class="font-semibold py-2">Total: ${formatCurrency(Number(o.total_amount))}</p>
        </div>
      `;
    }).join('');
    const html = `
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
                    {groupItemsForReceipt(o.items ?? []).map((group, gi) => {
                      const isDeal = group.dealId != null && group.lines.length > 0;
                      const dealTotal = group.lines.reduce((s, l) => s + Number(l.subtotal), 0);
                      return (
                        <React.Fragment key={gi}>
                          {isDeal ? (
                            <>
                              <tr className="border-b border-gray-100 bg-gray-50/50">
                                <td className="py-1.5 text-gray-700 font-medium">
                                  {group.lines.find((l) => l.deal_name)?.deal_name ?? 'Deal'}
                                </td>
                                <td className="py-1.5 text-right font-medium text-gray-800">
                                  {formatCurrency(dealTotal)}
                                </td>
                              </tr>
                              {group.lines.map((line, si) => (
                                <tr key={`${gi}-${si}`} className="border-b border-gray-100">
                                  <td className="py-1 text-gray-600 pl-4">
                                    {line.name_snapshot ?? 'Item'}
                                    {line.variant_name ? ` (${line.variant_name})` : ''} × {line.quantity}
                                  </td>
                                  <td className="py-1 text-right text-gray-500">
                                    {Number(line.unit_price) === 0 ? '—' : formatCurrency(Number(line.subtotal))}
                                  </td>
                                </tr>
                              ))}
                            </>
                          ) : (
                            group.lines.map((line, i) => {
                              const baseAmount = lineBaseTotal(line);
                              const hasExtras = (line.addons?.length ?? 0) > 0 || (line.modifiers?.length ?? 0) > 0;
                              return (
                                <React.Fragment key={`${gi}-${i}`}>
                                  <tr className="border-b border-gray-100">
                                    <td className="py-1.5 text-gray-700">
                                      <div className="flex flex-col">
                                        <span>
                                          {line.name_snapshot ?? 'Item'}
                                          {line.variant_name ? (
                                            <span className="text-gray-500"> (Variant: {line.variant_name})</span>
                                          ) : null}
                                          {' '}× {line.quantity}
                                        </span>
                                      </div>
                                    </td>
                                    <td className="py-1.5 text-right font-medium text-gray-800">
                                      {formatCurrency(Number(baseAmount))}
                                    </td>
                                  </tr>
                                  {(line.addons ?? []).map((a, ai: number) => (
                                    <tr key={`a-${gi}-${i}-${ai}`} className="border-b border-gray-100">
                                      <td className="py-1 text-gray-500 pl-4">
                                        Add-on: {a.name ?? '—'}
                                        {Number(a.quantity ?? 1) !== 1 ? ` × ${a.quantity}` : ''}
                                      </td>
                                      <td className="py-1 text-right text-gray-600">
                                        {formatCurrency(Number(addonTotal(a)))}
                                      </td>
                                    </tr>
                                  ))}
                                  {(line.modifiers ?? []).map((m, mi: number) => (
                                    <tr key={`m-${gi}-${i}-${mi}`} className="border-b border-gray-100">
                                      <td className="py-1 text-gray-500 pl-4">
                                        {m.group ?? 'Modifier'}: {m.name ?? '—'}
                                      </td>
                                      <td className="py-1 text-right text-gray-600">
                                        {formatCurrency(Number(m.unit_price))}
                                      </td>
                                    </tr>
                                  ))}
                                  {hasExtras && (
                                    <tr className="border-b border-gray-100 last:border-0">
                                      <td className="py-1 text-gray-500 pl-4 italic">
                                        Line total
                                      </td>
                                      <td className="py-1 text-right text-gray-600 italic">
                                        {formatCurrency(Number(line.subtotal))}
                                      </td>
                                    </tr>
                                  )}
                                </React.Fragment>
                              );
                            })
                          )}
                        </React.Fragment>
                      );
                    })}
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
                  {Number(o.delivery_fee) > 0 && (
                    <div className="flex justify-between text-gray-600">
                      <span>Delivery fee</span>
                      <span>{formatCurrency(Number(o.delivery_fee))}</span>
                    </div>
                  )}
                  <div className="flex justify-between text-green-700">
                    <span>Earned points</span>
                    <span>{Number((o as MainInvoiceOrder).loyalty_points_earned ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Redeemed points</span>
                    <span>{Number((o as MainInvoiceOrder).loyalty_points_redeemed ?? 0)}</span>
                  </div>
                  <div className="flex justify-between text-gray-800">
                    <span>Remaining points</span>
                    <span>{Number((o as MainInvoiceOrder).loyalty_points_remaining ?? invoiceData.loyalty_points_remaining ?? 0)}</span>
                  </div>
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
