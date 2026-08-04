import React from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { orderService } from '../services/api';
import { formatCurrency } from '../utils/currency';
import { printContent } from '../utils/print';
import { getDeviceBottomFeedMm, setDeviceBottomFeedMm } from '../utils/printerSettings';
import { renderInvoiceHtml } from '../invoices/renderInvoice';
import { InvoiceVM, InvoiceLayout } from '../invoices/types';
import Modal from './Modal';
import Loader from './Loader';
import Button from './Button';

export type MainInvoiceLine = {
  name_snapshot?: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  variant_name?: string | null;
  deal_id?: number | null;
  deal_slot_index?: number | null;
  deal_name?: string | null;
  notes?: string | null;
  addons?: Array<{ name?: string | null; quantity: number; unit_price: number; subtotal?: number }>;
  modifiers?: Array<{ name?: string | null; unit_price: number; group?: string | null; triggered_by?: string | null }>;
};

export type MainInvoiceOrder = {
  notes?: string | null;
  order_id: number;
  order_number: string;
  brand_name?: string | null;
  brand_logo_url?: string | null;
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
  /** Tenant business setting: auto-print customer + kitchen invoices on order placement. */
  auto_print_invoices?: boolean;
};

/** Normalize the single-order invoice payload into the group-shaped view model (print only).
 *  Also used by the Back Kitchen KOT print, which receives the same payload shape. */
export function singleToPrintVM(s: Record<string, unknown>): InvoiceVM {
  const items = ((s.items as Array<Record<string, unknown>>) ?? []).map((i) => ({
    name_snapshot: (i.name as string) ?? (i.name_snapshot as string),
    quantity: i.quantity as number,
    unit_price: i.unit_price as number,
    subtotal: i.subtotal as number,
    variant_name: (i.variant_name as string) ?? null,
    category: (i.category as string) ?? null,
    deal_id: (i.deal_id as number) ?? null,
    deal_slot_index: (i.deal_slot_index as number) ?? null,
    deal_name: (i.deal_name as string) ?? null,
    addons: (i.addons as never) ?? [],
    modifiers: (i.modifiers as never) ?? [],
    notes: (i.notes as string) ?? null,
  }));
  const brand = s.brand as { name?: string; logo_url?: string } | null;
  return {
    order_group_id: (s.order_group_id as string) ?? `order-${s.order_id}`,
    currency: (s.currency as string) ?? null,
    header: (s.header as never) ?? undefined,
    template: (s.template as never) ?? undefined,
    orders: [
      {
        order_id: s.order_id as number,
        order_number: s.order_number as string,
        invoice_number: (s.invoice_number as string) ?? null,
        fbr_invoice_number: (s.fbr_invoice_number as string) ?? null,
        fbr_number_source: (s.fbr_number_source as string) ?? null,
        brand_name: brand?.name ?? null,
        brand_logo_url: brand?.logo_url ?? null,
        order_type: (s.order_type as string) ?? null,
        table_number: (s.table_number as string) ?? null,
    notes: (s.notes as string) ?? null,
        placed_at: (s.placed_at as string) ?? null,
        customer_name: (s.customer_name as string) ?? null,
        customer_phone: (s.customer_phone as string) ?? null,
        cashier_name: (s.cashier_name as string) ?? null,
        payment_method: (s.payment_method as string) ?? null,
        items,
        subtotal: (s.subtotal as number) ?? 0,
        discount_amount: (s.discount_amount as number) ?? 0,
        promo_discount_amount: (s.promo_discount_amount as number) ?? 0,
        order_discount_amount: (s.order_discount_amount as number) ?? 0,
        coupon_discount_amount: (s.coupon_discount_amount as number) ?? 0,
        card_discount_amount: (s.card_discount_amount as number) ?? 0,
        discount_code: (s.discount_code as string) ?? null,
        tax_amount: (s.tax_amount as number) ?? 0,
        tax_rate: (s.tax_rate as number) ?? null,
        service_charge: (s.service_charge as number) ?? 0,
        delivery_fee: (s.delivery_fee as number) ?? 0,
        total_amount: (s.total_amount as number) ?? 0,
        loyalty_points_earned: (s.loyalty_points_earned as number) ?? 0,
        loyalty_points_redeemed: (s.loyalty_points_redeemed as number) ?? 0,
        loyalty_points_remaining: (s.loyalty_points_remaining as number) ?? 0,
      },
    ],
    gross_total: (s.total_amount as number) ?? 0,
    loyalty_points_remaining: (s.loyalty_points_remaining as number) ?? 0,
  };
}

interface CustomerInvoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  orderGroupId: string | null;
  /** When set and orderGroupId is null, show single-order invoice (e.g. for orders without a group). */
  orderId?: number | null;
  /**
   * Set by surfaces that open this modal right after PLACING an order (POS /
   * kiosk finalize). When the tenant's auto-print business setting is on, the
   * customer and kitchen invoices print as soon as the invoice loads. Viewers
   * of past orders (admin orders list) omit it.
   */
  autoPrintOnOpen?: boolean;
}

const CustomerInvoiceModal: React.FC<CustomerInvoiceModalProps> = ({
  isOpen,
  onClose,
  orderGroupId,
  orderId,
  autoPrintOnOpen = false,
}) => {
  const hasGroup = !!orderGroupId;
  const hasSingle = !!orderId && !orderGroupId;

  // Per-terminal cutter-feed override (localStorage). Empty = use template default.
  const [deviceFeed, setDeviceFeed] = React.useState<number | null>(() => getDeviceBottomFeedMm());
  const updateDeviceFeed = (v: number | null) => {
    setDeviceBottomFeedMm(v);
    setDeviceFeed(v);
  };

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
      brand_logo_url: singleInvoice.brand?.logo_url ?? null,
      items: (singleInvoice.items ?? []).map((i: MainInvoiceLine & { name?: string }) => ({
        name_snapshot: i.name ?? i.name_snapshot,
        quantity: i.quantity,
        unit_price: i.unit_price,
        subtotal: i.subtotal,
        variant_name: i.variant_name ?? null,
        // The backend sends per-item notes (kitchen instructions); dropping them
        // here hid them from the on-screen view of any single (non-group) order.
        notes: i.notes ?? null,
        deal_id: i.deal_id ?? null,
        deal_slot_index: i.deal_slot_index ?? null,
        deal_name: i.deal_name ?? null,
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

  /**
   * Add-on and modifier rows for ONE item line. `depth` is the indent of the
   * owning line: 0 for a standalone item, 1 for a deal component (already
   * indented under its deal). Deal components carry their own modifiers — the
   * flavour chosen for a component is what the kitchen cooks — so they render
   * in both cases, just one step further in.
   */
  const extrasRows = (
    line: MainInvoiceLine,
    keyPrefix: string,
    depth: 0 | 1,
  ): React.ReactNode[] => {
    const pad = depth === 0 ? 'pl-4' : 'pl-8';
    const nestPad = depth === 0 ? 'pl-8' : 'pl-12';
    const rows: React.ReactNode[] = [];
    (line.addons ?? []).forEach((a, ai: number) => {
      rows.push(
        <tr key={`a-${keyPrefix}-${ai}`} className="border-b border-gray-100">
          <td className={`py-1 text-gray-500 ${pad}`}>
            Add-on: {a.name ?? '—'}
            {Number(a.quantity ?? 1) !== 1 ? ` × ${a.quantity}` : ''}
          </td>
          <td className="py-1 text-right text-gray-600">
            {formatCurrency(Number(addonTotal(a)))}
          </td>
        </tr>,
      );
    });
    // Nest conditional chooser picks under their trigger option
    // (e.g. milkshake upgrade under "Add a 345ml Drink").
    const mods = line.modifiers ?? [];
    const isChild = (m: (typeof mods)[number]) =>
      !!m.triggered_by && mods.some((x) => x !== m && (x.name ?? '') === m.triggered_by);
    const roots = mods.filter((m) => !isChild(m));
    roots.forEach((m, mi) => {
      rows.push(
        <tr key={`m-${keyPrefix}-${mi}`} className="border-b border-gray-100">
          <td className={`py-1 text-gray-500 ${pad}`}>
            {m.group ?? 'Modifier'}: {m.name ?? '—'}
          </td>
          <td className="py-1 text-right text-gray-600">
            {formatCurrency(Number(m.unit_price))}
          </td>
        </tr>,
      );
      mods
        .filter((c) => isChild(c) && c.triggered_by === (m.name ?? ''))
        .forEach((c, ci) => {
          rows.push(
            <tr key={`mc-${keyPrefix}-${mi}-${ci}`} className="border-b border-gray-100">
              <td className={`py-1 text-gray-500 ${nestPad}`}>↳ {c.name ?? '—'}</td>
              <td className="py-1 text-right text-gray-600">
                {Number(c.unit_price) ? formatCurrency(Number(c.unit_price)) : (
                  <span className="text-emerald-600">Included</span>
                )}
              </td>
            </tr>,
          );
        });
    });
    return rows;
  };

  /**
   * PRINT ONLY: render the printout from the tenant's configured invoice template
   * (selectable schema + field toggles). The on-screen view below is unchanged.
   */
  const handlePrint = () => {
    const printData: InvoiceVM | null = hasGroup
      ? ((mainInvoice as unknown as InvoiceVM) ?? null)
      : singleInvoice
        ? singleToPrintVM(singleInvoice as unknown as Record<string, unknown>)
        : null;
    if (!printData) return;
    const layout: InvoiceLayout = printData.template?.layout ?? 'bill_bordered';
    // This terminal's cutter-feed override (if set) wins over the template default.
    const deviceFeed = getDeviceBottomFeedMm();
    const baseCfg = printData.template?.config ?? null;
    const cfg = deviceFeed != null ? { ...(baseCfg ?? {}), bottomFeedMm: deviceFeed } : baseCfg;
    const { html, css } = renderInvoiceHtml(printData, layout, cfg);
    printContent(html, 'Customer invoice', css);
  };

  /**
   * Kitchen (KOT) print: refetch each order with purpose=kitchen so the
   * kitchen-default template applies (it may differ from the customer one
   * this modal already holds), then render through the same engine. Group
   * invoices print one kitchen ticket per order.
   */
  const handlePrintKot = async () => {
    const orderIds = (invoiceData?.orders ?? []).map((o) => o.order_id);
    if (!orderIds.length) return;
    for (const oid of orderIds) {
      try {
        const data = (await orderService.getOrderInvoice(oid, 'kitchen')) as Record<string, unknown>;
        const printData = singleToPrintVM(data);
        const layout: InvoiceLayout = printData.template?.layout ?? 'bill_bordered';
        const deviceFeed = getDeviceBottomFeedMm();
        const baseCfg = printData.template?.config ?? null;
        // Kitchen tickets never carry the FBR fiscal block — that is customer-receipt chrome.
        const cfg = {
          ...(baseCfg ?? {}),
          ...(deviceFeed != null ? { bottomFeedMm: deviceFeed } : {}),
          showFbrInvoice: false,
        };
        const { html, css } = renderInvoiceHtml(printData, layout, cfg);
        printContent(html, `KOT ${(data.order_number as string) ?? String(oid)}`, css);
      } catch {
        toast.error('Failed to print kitchen invoice');
      }
    }
  };

  // Auto-print on order placement: fire once per order group, only when the
  // opener flags placement AND the tenant setting (carried on the invoice
  // payload) is on.
  const autoPrintEnabled = Boolean(
    (mainInvoice as MainInvoiceData | undefined)?.auto_print_invoices ??
      (singleInvoice as { auto_print_invoices?: boolean } | undefined)?.auto_print_invoices,
  );
  const autoPrintedFor = React.useRef<string | null>(null);
  React.useEffect(() => {
    if (!isOpen || !autoPrintOnOpen || !autoPrintEnabled || !invoiceData) return;
    const key = invoiceData.order_group_id;
    if (autoPrintedFor.current === key) return;
    autoPrintedFor.current = key;
    handlePrint();
    void handlePrintKot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, autoPrintOnOpen, autoPrintEnabled, invoiceData]);

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
          <div className="flex justify-center">
            {(() => {
              // Single-brand invoice → that brand's logo; mixed-brand group (or
              // no brand logo uploaded) → the Foodies umbrella logo.
              const logos = [
                ...new Set(
                  (invoiceData.orders ?? [])
                    .map((o: MainInvoiceOrder) => o.brand_logo_url)
                    .filter(Boolean),
                ),
              ];
              const src = logos.length === 1 ? (logos[0] as string) : '/foodies-logo.png';
              return (
                <img
                  src={src}
                  alt={invoiceData.orders?.[0]?.brand_name ?? 'Foodies'}
                  className="w-20 h-20 object-contain"
                  onError={(e) => {
                    const img = e.target as HTMLImageElement;
                    if (!img.src.endsWith('/foodies-logo.png')) img.src = '/foodies-logo.png';
                  }}
                />
              );
            })()}
          </div>
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
                                <React.Fragment key={`${gi}-${si}`}>
                                  <tr className="border-b border-gray-100">
                                    <td className="py-1 text-gray-600 pl-4">
                                      {line.name_snapshot ?? 'Item'}
                                      {line.variant_name ? ` (${line.variant_name})` : ''} × {line.quantity}
                                    </td>
                                    <td className="py-1 text-right text-gray-500">
                                      {Number(line.unit_price) === 0 ? '—' : formatCurrency(Number(line.subtotal))}
                                    </td>
                                  </tr>
                                  {extrasRows(line, `d-${gi}-${si}`, 1)}
                                  {line.notes ? (
                                    <tr className="border-b border-gray-100">
                                      <td colSpan={2} className="py-1 pl-8 text-amber-700 italic">
                                        Note: {line.notes}
                                      </td>
                                    </tr>
                                  ) : null}
                                </React.Fragment>
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
                                  {extrasRows(line, `${gi}-${i}`, 0)}
                                  {line.notes ? (
                                    <tr className="border-b border-gray-100">
                                      <td colSpan={2} className="py-1 pl-8 text-amber-700 italic">
                                        Note: {line.notes}
                                      </td>
                                    </tr>
                                  ) : null}
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
                {o.notes ? (
                  <div className="mt-2 text-sm text-amber-700 italic border border-amber-200 bg-amber-50 rounded px-2 py-1">
                    Order note: {o.notes}
                  </div>
                ) : null}
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
          <div className="flex flex-wrap items-center justify-between gap-3">
            <label
              className="flex items-center gap-1.5 text-xs text-gray-500"
              title="Blank paper fed after the last line so it clears this printer's cutter. Saved on THIS terminal only — leave empty to use the template's value. Raise it if the last line is cut off."
            >
              <span className="whitespace-nowrap">Cutter feed <span className="text-gray-400">(this device)</span></span>
              <input
                type="number"
                min={0}
                max={80}
                value={deviceFeed ?? ''}
                placeholder="template"
                onChange={(e) => updateDeviceFeed(e.target.value === '' ? null : Number(e.target.value))}
                className="w-20 rounded-md border border-gray-300 px-2 py-1 text-right text-gray-800 focus:border-red-500 focus:outline-none focus:ring-1 focus:ring-red-500/30"
              />
              <span className="text-gray-400">mm</span>
            </label>
            <div className="flex gap-2">
              <Button variant="outline" onClick={handlePrint}>
                Print
              </Button>
              <Button variant="outline" onClick={() => void handlePrintKot()}>
                Print KOT
              </Button>
              <Button variant="outline" onClick={onClose}>
                Close
              </Button>
            </div>
          </div>
        </div>
      ) : (
        <p className="text-gray-500 py-4">No invoice data.</p>
      )}
    </Modal>
  );
};

export default CustomerInvoiceModal;
