import React, { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { Order } from '../../types';
import Loader from '../../components/Loader';
import { formatCurrency, taxLabel as taxLabelFor } from '../../utils/currency';
import { formatOrderType } from '../../utils/format';
import { printContent } from '../../utils/print';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';
import { useHasPermission, useHasRestriction } from '../../hooks/useHasPermission';
import { NO_CANCEL_PERMISSION, STATUS_CHANGE_PERMISSIONS } from '../../lib/orderStatusPermissions';
import { deliveryStatusLabel, deliveryStatusTone, isDeliveryFailed } from '../../lib/deliveryStatus';
import CustomerInvoiceModal from '../../components/CustomerInvoiceModal';
import { usePaymentRequiredPrompt } from '../../components/PaymentRequiredModal';
import { formatTripDuration } from '../../utils/tripTime';
import { groupOrderItems } from '../../utils/orderItemGrouping';
import { orderModifiersWithNesting } from '../../utils/modifierNesting';
import { orderLineExtrasUnits, savedAddonAmount, savedModifierBilling } from '../../utils/modifierPricing';
import { orderSourceLabel } from '../../utils/orderSources';
import { formatPhone, nameInitials } from '../../utils/customerDisplay';
import { formatDay } from '../../utils/dateDisplay';
import { useViewport } from '../../hooks/useViewport';
import { ActionsSheet } from '../../components/ActionsSheet';
import { useAuth } from '../../contexts/AuthContext';
import { canAccessPath } from '../../lib/pathPermissions';
import { cu } from './customersUi';

/**
 * One order, in the design language the Customers pages use (same cards, labels and pills).
 *
 * The layout is the supplied "Order Detail Redesign": a header card with the order's badges, a
 * status pill that is also the status control, and a progress strip; then items on the left and
 * customer / totals / payment on the right. Everything the old page showed is still here — the
 * mock-up only had a delivery order from the app, so the dine-in table, rider trip, printed
 * vouchers, coupon, service charge, delivery fee, loyalty points, deal groups, nested options and
 * item notes all keep their place. Below lg everything stacks into one column; phones also pin an
 * "Update status" button to the bottom edge and pick the status in a bottom sheet.
 */

type OrderDetailItem = {
  id: number;
  name_snapshot?: string;
  price_snapshot?: number;
  quantity: number;
  unit_price: number;
  subtotal: number;
  notes?: string | null;
  triggered_by?: string | null;
  variant_id?: number | null;
  variant_name?: string | null;
  deal_id?: number | null;
  deal_slot_index?: number | null;
  deal_name?: string | null;
  addons?: Array<{ name: string | null; unit_price: number; quantity: number; subtotal?: number }>;
  /** quantity / free_quantity are per unit of the line (see savedModifierBilling). */
  modifiers?: Array<{
    name: string | null;
    unit_price: number;
    group?: string | null;
    triggered_by?: string | null;
    quantity?: number;
    free_quantity?: number;
  }>;
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
  table_number?: string | null;
  notes?: string | null;
  customer_id?: number | null;
  customer_name?: string | null;
  customer_phone?: string | null;
  delivery_address?: string | null;
  delivery_tier?: string | null;
  delivery_eta_min_minutes?: number | null;
  delivery_eta_max_minutes?: number | null;
  source?: 'pos' | 'consumer_app' | string;
  subtotal?: number;
  discount_amount?: number;
  /** Printed vouchers the order used (as one line, e.g. "Any Large Pizza ×3"), and what they took off. */
  voucher_name?: string | null;
  voucher_discount_amount?: number;
  /** One entry per voucher kind, with its paper count. */
  vouchers?: Array<{ name: string; quantity: number; discount_amount: number }>;
  tax_amount?: number;
  /** GST rate as a fraction (0.16), by the tender it was charged on. */
  tax_rate?: number | null;
  /** What the GST was charged on when Business Settings taxes the menu price; null = the discounted price. */
  tax_base?: number | null;
  service_charge?: number;
  delivery_fee?: number;
  total_amount?: number;
  discount_code?: string | null;
  placed_at?: string | null;
  completed_at?: string | null;
  branch?: { id: number; name: string; code: string } | null;
  brand?: { id: number; name: string } | null;
  creator?: { id: number; name: string } | null;
  items?: OrderDetailItem[];
  payments?: Array<{ id: number; method?: string | null; payment_method?: string; amount: number; status: string; paid_at?: string | null }>;
  /** The tender the order is due to be paid by before any is recorded ('cod' for an app order); null once tendered. */
  pending_payment_method?: string | null;
  loyalty_points_earned?: number;
  loyalty_points_redeemed?: number;
  rider_id?: number | null;
  rider?: { id: number; name: string } | null;
  delivery_status?: string | null;
  /** Why the rider could not deliver. Set by the rider when marking delivery failed. */
  delivery_failed_reason?: string | null;
  /** When the rider marked the order picked up / delivered (null = not tapped). */
  picked_up_at?: string | null;
  delivered_at?: string | null;
  /** Pickup → delivered; null unless both taps were recorded. */
  trip_duration_seconds?: number | null;
};

const cardCls = `${cu.card} rounded-[16px]`;

/** The order's own status flow, in the order the kitchen walks it. Cancelled sits outside it. */
const STATUS_FLOW = ['placed', 'accepted', 'preparing', 'ready', 'completed'] as const;
const STATUS_LABEL: Record<string, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};
const statusLabel = (s: string | null | undefined) => (s ? (STATUS_LABEL[s] ?? s.replace(/_/g, ' ')) : '—');

/** Status pill colours from the design, with a dark counterpart each. */
const STATUS_META: Record<string, { pill: string; dot: string }> = {
  placed: { pill: 'bg-[#EEF0F3] text-[#5A6473] dark:bg-slate-700 dark:text-slate-300', dot: 'bg-[#9AA1AD]' },
  accepted: { pill: 'bg-[#EAF1FF] text-[#2563EB] dark:bg-blue-900/40 dark:text-blue-300', dot: 'bg-[#3B82F6]' },
  preparing: { pill: 'bg-[#FFF6E6] text-[#B45309] dark:bg-amber-900/40 dark:text-amber-300', dot: 'bg-[#E0932B]' },
  ready: { pill: 'bg-[#EAF7EE] text-[#16A34A] dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-[#22C55E]' },
  completed: { pill: 'bg-[#EAF7EE] text-[#059669] dark:bg-emerald-900/40 dark:text-emerald-300', dot: 'bg-[#10B981]' },
  cancelled: { pill: 'bg-[#FCEEF0] text-[#DC2A2A] dark:bg-red-900/40 dark:text-red-300', dot: 'bg-[#DC2A2A]' },
};

const svgProps = {
  width: 13,
  height: 13,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

/** Type badge: the Orders list's icons and tints. */
const TYPE_BADGE: Record<string, { cls: string; icon: React.ReactNode }> = {
  delivery: {
    cls: 'bg-[#EAF1FF] text-[#2563EB] dark:bg-blue-900/40 dark:text-blue-300',
    icon: (
      <svg {...svgProps}>
        <circle cx="4" cy="11.5" r="2" /><circle cx="12" cy="11.5" r="2" /><path d="M4 11.5l3-5.5h2.5l2 5.5M7 6l-1-2H4.3" />
      </svg>
    ),
  },
  dine_in: {
    cls: 'bg-[#F1EAFB] text-[#7C3AED] dark:bg-violet-900/40 dark:text-violet-300',
    icon: (
      <svg {...svgProps}>
        <path d="M4 2v4a1.5 1.5 0 0 0 3 0V2M5.5 6v8" /><path d="M11 2c-1 0-1.6 1.6-1.6 3.4S10 8.4 11 8.4V14" />
      </svg>
    ),
  },
  takeaway: {
    cls: 'bg-[#FFF1E6] text-[#C2410C] dark:bg-orange-900/40 dark:text-orange-300',
    icon: (
      <svg {...svgProps}>
        <path d="M4 5.5h8l-.7 8.2a.8.8 0 0 1-.8.8H5.5a.8.8 0 0 1-.8-.8z" /><path d="M6 5.5V4.2a2 2 0 0 1 4 0v1.3" />
      </svg>
    ),
  },
};

const SOURCE_BADGE: Record<string, string> = {
  pos: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200',
  call_centre: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  consumer_app: 'bg-[#EAF7EE] text-[#16A34A] dark:bg-emerald-900/40 dark:text-emerald-200',
  consumer_web: 'bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200',
  kiosk: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
};

/** "24 Jul 2026, 2:59 PM" in the viewer's own timezone; '—' when absent. */
function formatDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return `${formatDay(d)}, ${d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Paid / partly paid / unpaid, by the same rule as the Orders list. */
function paymentState(payments: OrderDetailData['payments'], total: number): { key: 'paid' | 'partial' | 'unpaid'; paid: number } {
  const paid = (payments ?? [])
    .filter((p) => (p.status ?? '') === 'completed')
    .reduce((s, p) => s + Number(p.amount ?? 0), 0);
  if (paid <= 0) return { key: 'unpaid', paid };
  return { key: paid + 0.01 >= total ? 'paid' : 'partial', paid };
}

const PAYMENT_PILL: Record<'paid' | 'partial' | 'unpaid', { cls: string; label: string }> = {
  paid: { cls: 'border-[#CDEBD6] bg-[#EAF7EE] text-[#16A34A] dark:border-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300', label: 'Paid' },
  partial: { cls: 'border-[#FBE4B8] bg-[#FFF6E6] text-[#B45309] dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300', label: 'Partly paid' },
  unpaid: { cls: 'border-[#FBE4B8] bg-[#FFF6E6] text-[#B45309] dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300', label: 'Unpaid' },
};

/** How a tender that is still to come reads; the server names only COD today. */
const PENDING_TENDER_LABEL: Record<string, string> = { cod: 'Cash on delivery (COD)' };

/** "cash" → "Cash", "bank_transfer" → "Bank transfer". */
function tenderLabel(method: string | null | undefined): string {
  const m = (method ?? '').trim().replace(/_/g, ' ');
  return m ? m.charAt(0).toUpperCase() + m.slice(1) : '—';
}

/* ---------- Options on a line, as chips grouped the way the menu groups them ---------- */

type Chip = { label: string; tone: 'plain' | 'removal' | 'included' };
type ChipGroup = { group: string; chips: Chip[] };

const CHIP_TONE: Record<Chip['tone'], string> = {
  plain: 'bg-[#F3F4F6] text-[#374151] dark:bg-slate-700 dark:text-slate-200',
  removal: 'bg-[#FCEEEE] text-[#B5121B] dark:bg-red-900/30 dark:text-red-300',
  included: 'bg-[#EAF7EE] text-[#067647] dark:bg-emerald-900/30 dark:text-emerald-300',
};

const priceSuffix = (n: number) => (n > 0 ? ` +${formatCurrency(n)}` : '');
const isRemoval = (name: string) => /^(no|without)\s/i.test(name.trim());

/**
 * Add-ons first, then each modifier group in menu order. A conditional pick (the meal's drink)
 * stays under the option that revealed it, marked ↳, and reads "Included" when it costs nothing —
 * the same hierarchy the receipt, KDS and FOH print.
 */
function optionGroups(item: OrderDetailItem): ChipGroup[] {
  // Extras are chosen per unit: × 3 burgers with an extra patty bills 3 patties.
  const units = orderLineExtrasUnits(item);
  const times = (n: number) => (n !== 1 ? ` ×${n}` : '');
  const groups: ChipGroup[] = [];
  const push = (group: string, chip: Chip) => {
    let g = groups.find((x) => x.group === group);
    if (!g) {
      g = { group, chips: [] };
      groups.push(g);
    }
    g.chips.push(chip);
  };
  for (const a of item.addons ?? []) {
    const qty = Number(a.quantity ?? 1) * units;
    push('Add-ons', { label: `${a.name ?? '—'}${times(qty)}${priceSuffix(savedAddonAmount(a, units))}`, tone: 'plain' });
  }
  let lastGroup = 'Options';
  for (const { mod: m, nested } of orderModifiersWithNesting(item.modifiers ?? [])) {
    const name = m.name ?? '—';
    const b = savedModifierBilling(m, units);
    const price = b.amount || 0;
    if (!nested) {
      lastGroup = m.group?.trim() || 'Options';
      push(lastGroup, { label: `${name}${times(b.qty)}${priceSuffix(price)}`, tone: isRemoval(name) ? 'removal' : 'plain' });
    } else if (price > 0) {
      push(lastGroup, { label: `↳ ${name}${times(b.qty)}${priceSuffix(price)}`, tone: 'plain' });
    } else {
      push(lastGroup, { label: `↳ ${name} · Included`, tone: 'included' });
    }
  }
  return groups;
}

const OrderDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const { user } = useAuth();
  const { isDesktop, isPhone } = useViewport();
  const canUpdateStatus = useHasPermission(STATUS_CHANGE_PERMISSIONS);
  const noCancel = useHasRestriction(NO_CANCEL_PERMISSION);
  const canViewCustomers = canAccessPath(user, '/admin/customers');
  const queryClient = useQueryClient();
  const [showCustomerInvoice, setShowCustomerInvoice] = useState(false);
  const [statusSheet, setStatusSheet] = useState(false);
  const [ratingsHelp, setRatingsHelp] = useState(false);

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

  const invalidateAfterStatus = (status: string) => {
    queryClient.invalidateQueries({ queryKey: ['admin-order', id] });
    queryClient.invalidateQueries({ queryKey: ['admin-order-ratings', id] });
    if (status === 'completed') {
      queryClient.invalidateQueries({ queryKey: ['salesSummary'] });
      queryClient.invalidateQueries({ queryKey: ['topItems'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
    }
  };

  // Completing an unpaid till order asks for the payment method first.
  const paymentPrompt = usePaymentRequiredPrompt({
    complete: (orderId, method) =>
      apiClient.put(`/admin/orders/${orderId}/status`, { status: 'completed', payment_method: method }),
    onCompleted: () => invalidateAfterStatus('completed'),
  });

  const updateStatusMutation = useMutation({
    mutationFn: async (status: string) => {
      const response = await apiClient.put(`/admin/orders/${id}/status`, { status });
      return response.data;
    },
    onSuccess: (_data, status) => {
      invalidateAfterStatus(status);
      toast.success('Order status updated');
    },
    onError: (error: any) => {
      if (paymentPrompt.ask(error)) return;
      toast.error(error.response?.data?.message || 'Failed to update status');
    },
  });

  if (isLoading || !order) {
    return <Loader fullScreen text="Loading order..." />;
  }

  const o = order as OrderDetailData;
  const pending = updateStatusMutation.isPending;
  const setStatus = (status: string) => {
    if (pending || status === o.status) return;
    updateStatusMutation.mutate(status);
  };
  const statusOptions: string[] = [...STATUS_FLOW, ...(noCancel ? [] : ['cancelled'])];

  const orderNum = o.order_number ?? (order as any).order_number;
  const orderType = o.order_type ?? (order as any).order_type;
  const typeBadge = TYPE_BADGE[String(orderType)] ?? { cls: 'bg-[#EEF0F3] text-[#5A6473] dark:bg-slate-700 dark:text-slate-300', icon: TYPE_BADGE.takeaway.icon };
  const totalAmount = Number(o.total_amount ?? order.total_amount ?? 0);
  const subtotal = Number(o.subtotal ?? 0);
  const discountAmount = Number(o.discount_amount ?? 0);
  const taxAmount = Number(o.tax_amount ?? 0);
  const taxLabel = taxLabelFor(o.tax_rate);
  const serviceCharge = Number(o.service_charge ?? 0);
  const deliveryFee = Number(o.delivery_fee ?? 0);
  const hasDiscount = discountAmount > 0;
  const hasCoupon = !!(o.discount_code?.trim());
  // Printed vouchers are the order's only discount, so the discount line is them.
  const voucherName = Number(o.voucher_discount_amount ?? 0) > 0 ? (o.voucher_name ?? '').trim() : '';
  // Several kinds on one order get a line each under the total.
  const voucherKinds = voucherName ? (o.vouchers ?? []).filter((v) => Number(v.discount_amount) > 0) : [];
  const voucherKindLabel = (v: { name: string; quantity: number }) =>
    `${v.name}${Number(v.quantity) > 1 ? ` ×${Number(v.quantity)}` : ''}`;
  const items = o.items ?? [];
  const itemCount = items.length;
  const qtyCount = items.reduce((s, it) => s + Number(it.quantity ?? 0), 0);
  const pay = paymentState(o.payments, totalAmount);
  const amountDue = Math.max(0, totalAmount - pay.paid);
  const isDelivery = String(orderType) === 'delivery';
  const showDelivery = isDelivery || !!o.delivery_status || !!o.rider;
  const customerName = o.customer_name?.trim() ?? '';
  const customerPhone = o.customer_phone?.trim() ?? '';
  const hasCustomer = !!(customerName || customerPhone);
  const eta =
    o.delivery_eta_min_minutes != null && o.delivery_eta_max_minutes != null
      ? `${o.delivery_eta_min_minutes}–${o.delivery_eta_max_minutes} min`
      : o.delivery_eta_max_minutes != null
        ? `up to ${o.delivery_eta_max_minutes} min`
        : '';
  const cancelled = o.status === 'cancelled';
  const finished = o.status === 'completed';
  const stepIndex = STATUS_FLOW.indexOf(o.status as (typeof STATUS_FLOW)[number]);
  // A 5-up strip on a phone has sub-44px targets and a mis-tap would change the order, so the
  // steps are tappable only on desktop; phones use the pinned button and the sheet.
  const stepsClickable = canUpdateStatus && isDesktop;

  const handlePrint = () => {
    const typeLabel = formatOrderType(orderType);
    const itemsHtml = items
      .map((item) => {
        // Extras are per unit: the line bills them × its units.
        const units = orderLineExtrasUnits(item);
        const times = (n: number) => (n !== 1 ? ` × ${n}` : '');
        const base = Number(item.unit_price ?? 0) * item.quantity;
        const baseRow = `<tr><td>${escapeHtml(String(item.name_snapshot ?? 'Item'))}${item.variant_name ? ` <span style="color:#666;">(Variant: ${escapeHtml(item.variant_name)})</span>` : ''} × ${item.quantity}</td><td class="text-right">${formatCurrency(base)}</td></tr>`;
        const addonRows = (item.addons ?? []).map((a) => `<tr class="sub"><td style="padding-left:14px;">Add-on: ${escapeHtml(a.name ?? '—')}${times(Number(a.quantity ?? 1) * units)}</td><td class="text-right">${formatCurrency(savedAddonAmount(a, units))}</td></tr>`).join('');
        const modRows = orderModifiersWithNesting(item.modifiers ?? [])
          .map(({ mod: m, nested }) => {
            const b = savedModifierBilling(m, units);
            return nested
              ? `<tr class="sub"><td style="padding-left:28px;">↳ ${escapeHtml(m.name ?? '—')}${times(b.qty)}</td><td class="text-right">${b.amount ? formatCurrency(b.amount) : '<span style="color:#067647;">Included</span>'}</td></tr>`
              : `<tr class="sub"><td style="padding-left:14px;">${escapeHtml(m.group ?? 'Modifier')}: ${escapeHtml(m.name ?? '—')}${times(b.qty)}</td><td class="text-right">${formatCurrency(b.amount)}</td></tr>`;
          })
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
      ${hasDiscount ? `<p class="py-2">${voucherName ? `Voucher (${escapeHtml(voucherName)})` : `Discount${hasCoupon ? ` (${escapeHtml(o.discount_code ?? '')})` : ''}`}: -${formatCurrency(discountAmount)}</p>` : ''}
      <p class="py-2">${taxLabel}: ${formatCurrency(taxAmount)}</p>
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

  /* ---------- pieces ---------- */

  const dot = <span className="text-[#D1D5DB] dark:text-slate-600" aria-hidden="true">·</span>;
  // A text link's tap area below lg, without changing how it looks (the app's usual halo).
  const tapHalo = "max-lg:relative max-lg:before:absolute max-lg:before:-inset-x-2 max-lg:before:-inset-y-3.5 max-lg:before:content-['']";
  const sectionTitle = 'text-[15px] font-extrabold text-[#1F2430] dark:text-slate-100';

  const statusPill = (() => {
    const sm = STATUS_META[o.status] ?? STATUS_META.placed;
    const cls = `relative inline-flex items-center gap-2 rounded-[10px] py-[9px] pl-3 pr-[13px] text-[13.5px] font-extrabold ${sm.pill}`;
    const label = pending ? 'Updating…' : statusLabel(o.status);
    const dotEl = <span className={`h-2 w-2 flex-none rounded-full ${sm.dot}`} aria-hidden="true" />;
    const caret = (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.9} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 4.5l3 3 3-3" />
      </svg>
    );
    if (!canUpdateStatus) {
      return (
        <span className={cls} data-testid="status-pill">
          {dotEl}
          {label}
        </span>
      );
    }
    if (isDesktop) {
      // The native select sits invisibly over the pill, so the pill is the control.
      return (
        <span className={`${cls} cursor-pointer`} data-testid="status-pill" aria-busy={pending || undefined}>
          {dotEl}
          {label}
          {caret}
          <select
            aria-label="Update status"
            value={o.status}
            disabled={pending}
            onChange={(e) => setStatus(e.target.value)}
            className="absolute inset-0 w-full cursor-pointer opacity-0"
          >
            {statusOptions.map((s) => (
              <option key={s} value={s}>
                {statusLabel(s)}
              </option>
            ))}
          </select>
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() => setStatusSheet(true)}
        disabled={pending}
        aria-label="Update status"
        aria-haspopup="dialog"
        aria-expanded={statusSheet}
        className={`${cls} min-h-[40px]`}
        data-testid="status-pill"
      >
        {dotEl}
        {label}
        {caret}
      </button>
    );
  })();

  const stepper = (
    <div className="mt-5 grid grid-cols-5 gap-x-1.5 gap-y-2.5 max-sm:gap-x-1" aria-label="Order progress" data-testid="stepper">
      {STATUS_FLOW.map((s, i) => {
        // A finished order has nothing in progress: every step reads as done.
        const done = !cancelled && (finished || i < stepIndex);
        const current = !cancelled && !finished && i === stepIndex;
        const bar = cancelled
          ? 'bg-[#F3D0D0] dark:bg-red-900/40'
          : done
            ? 'bg-[#34D399]'
            : current
              ? 'bg-[#DC2A2A]'
              : 'bg-[#ECEDF0] dark:bg-slate-700';
        const text = done
          ? 'font-semibold text-[#16A34A] dark:text-emerald-400'
          : current
            ? 'font-extrabold text-[#B5121B] dark:text-red-300'
            : 'font-semibold text-[#9AA1AD] dark:text-slate-500';
        const inner = (
          <>
            <div className={`h-1.5 rounded-full ${bar}`} />
            <div className={`mt-2 flex items-center gap-1 text-[12px] max-sm:text-[10.5px] ${text}`}>
              {done && (
                <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="#16A34A" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="flex-none max-sm:hidden">
                  <polyline points="3,8.5 6.5,12 13,4.5" />
                </svg>
              )}
              <span className="truncate">{statusLabel(s)}</span>
            </div>
          </>
        );
        return stepsClickable ? (
          <button
            key={s}
            type="button"
            onClick={() => setStatus(s)}
            disabled={pending}
            aria-label={`Set status to ${statusLabel(s)}`}
            aria-current={current ? 'step' : undefined}
            className="min-w-0 rounded-md text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-[#DC2A2A]/40"
          >
            {inner}
          </button>
        ) : (
          <div key={s} className="min-w-0" aria-current={current ? 'step' : undefined}>
            {inner}
          </div>
        );
      })}
    </div>
  );

  const chipGroups = (groups: ChipGroup[]) =>
    groups.length === 0 ? null : (
      <div className="mt-2.5 flex flex-col gap-2">
        {groups.map((g) => (
          <div key={g.group} className="flex flex-col gap-1 text-[12.5px] leading-[1.45]">
            <span className={cu.label}>{g.group}</span>
            <span className="flex flex-wrap gap-1.5">
              {g.chips.map((c, i) => (
                <span key={i} data-testid="option-chip" data-tone={c.tone} className={`rounded-[6px] px-[7px] py-px font-semibold ${CHIP_TONE[c.tone]}`}>
                  {c.label}
                </span>
              ))}
            </span>
          </div>
        ))}
      </div>
    );

  const itemLine = (item: OrderDetailItem, opts: { inDeal: boolean; last: boolean }) => {
    const qty = Number(item.quantity ?? 1);
    const unit = Number(item.unit_price ?? 0);
    const lineTotal = Number(item.subtotal ?? 0);
    const extras = Math.max(0, lineTotal - unit * qty);
    const pad = opts.inDeal ? 'px-4' : 'px-[22px] max-sm:px-4';
    return (
      <div
        key={item.id}
        data-testid="item-line"
        className={`grid grid-cols-[minmax(0,1fr)_56px_120px] items-start gap-3.5 py-4 max-sm:grid-cols-[minmax(0,1fr)_auto] max-sm:gap-3 ${pad} ${
          opts.last ? '' : 'border-b border-[#F4F5F7] dark:border-slate-700/70'
        }`}
      >
        <div className="min-w-0">
          <div className={`text-[15px] font-bold ${cu.strong}`}>{item.name_snapshot ?? 'Item'}</div>
          <div className={`mt-0.5 text-[12px] tabular-nums ${cu.muted}`}>
            <span className="max-sm:hidden">{formatCurrency(unit)} each</span>
            <span className="sm:hidden">{qty} × {formatCurrency(unit)}</span>
            {item.variant_name && <> · {item.variant_name}</>}
            {extras > 0 && <> · extras {formatCurrency(extras)}</>}
          </div>
          {chipGroups(optionGroups(item))}
          {item.notes && (
            <div className="mt-2 inline-block rounded-[6px] bg-[#FFF6E6] px-2 py-0.5 text-[12.5px] font-semibold italic text-[#B45309] dark:bg-amber-900/30 dark:text-amber-300">
              Note: {item.notes}
            </div>
          )}
        </div>
        <span className={`text-center text-[14px] font-bold tabular-nums max-sm:hidden ${cu.text}`}>{qty}</span>
        <span className={`whitespace-nowrap text-right text-[14px] font-extrabold tabular-nums ${cu.strong}`}>{formatCurrency(lineTotal)}</span>
      </div>
    );
  };

  const groups = groupOrderItems(items);
  const itemsCard = (
    <div className={`${cardCls} overflow-hidden max-lg:order-1`} data-testid="items-card">
      <div className="flex items-baseline justify-between gap-2.5 px-[22px] pb-3 pt-[18px] max-sm:px-4">
        <h2 className="text-[16px] font-extrabold text-[#1F2430] dark:text-slate-100">Items</h2>
        <span className={`text-[12.5px] ${cu.muted}`}>
          {itemCount} item{itemCount === 1 ? '' : 's'} · {qtyCount} qty
        </span>
      </div>
      <div className={`grid grid-cols-[minmax(0,1fr)_56px_120px] gap-3.5 border-y px-[22px] py-[9px] max-sm:hidden ${cu.headRow}`}>
        <span className={cu.label}>Item</span>
        <span className={`text-center ${cu.label}`}>Qty</span>
        <span className={`text-right ${cu.label}`}>Line total</span>
      </div>
      <div className="border-t border-[#F1F2F5] sm:border-t-0 dark:border-slate-700">
        {itemCount === 0 && <p className={`px-[22px] py-5 text-[13px] ${cu.muted}`}>No items on this order.</p>}
        {groups.map((group, gi) => {
          const lastGroup = gi === groups.length - 1;
          if (group.dealId == null) return group.lines.map((line) => itemLine(line, { inDeal: false, last: lastGroup }));
          const dealTotal = group.lines.reduce((s, l) => s + Number(l.subtotal ?? 0), 0);
          return (
            <div key={`deal-${gi}`} data-testid="deal-group" className={lastGroup ? '' : 'border-b border-[#F4F5F7] dark:border-slate-700/70'}>
              <div className="flex items-center justify-between gap-3 px-[22px] pb-1 pt-4 max-sm:px-4">
                <span className="min-w-0 truncate text-[15px] font-bold text-indigo-700 dark:text-indigo-300">
                  <span className="mr-1.5 text-[10.5px] font-bold uppercase tracking-[.06em] text-indigo-500 dark:text-indigo-400">Deal</span>
                  {group.dealName ?? 'Deal'}
                </span>
                <span className={`whitespace-nowrap text-[14px] font-extrabold tabular-nums ${cu.strong}`}>{formatCurrency(dealTotal)}</span>
              </div>
              <div className="mb-3 ml-[22px] border-l-2 border-indigo-200 dark:border-indigo-800 max-sm:ml-4">
                {group.lines.map((line, li) => itemLine(line, { inDeal: true, last: li === group.lines.length - 1 }))}
              </div>
            </div>
          );
        })}
      </div>
      <div className={`border-t border-[#F4F5F7] px-[22px] py-3 text-[12px] dark:border-slate-700/70 max-sm:px-4 ${cu.muted}`}>
        Options with no extra charge are shown without a price.
      </div>
    </div>
  );

  const stars = (n: number | null) => {
    const filled = n ? Math.max(1, Math.min(5, Math.round(n))) : 0;
    return (
      <div className="mt-[9px] flex gap-[3px] text-[17px] leading-none" aria-label={filled ? `${filled} out of 5 stars` : 'Not rated'}>
        {[1, 2, 3, 4, 5].map((i) => (
          <span key={i} className={i <= filled ? 'text-[#F59E0B] dark:text-amber-400' : 'text-[#E2E5EA] dark:text-slate-600'} aria-hidden="true">
            ★
          </span>
        ))}
      </div>
    );
  };
  const ratingBox = (
    key: React.Key,
    title: string,
    body: { stars: number | null; caption: React.ReactNode; name?: string | null; comment?: string | null; extra?: React.ReactNode },
  ) => (
    <div key={key} className="rounded-[12px] border-[1.5px] border-dashed border-[#E2E5EA] px-4 py-3.5 dark:border-slate-600">
      <div className={cu.label}>{title}</div>
      {body.name && <div className={`mt-1 text-[13.5px] font-bold ${cu.strong}`}>{body.name}</div>}
      {stars(body.stars)}
      <div className={`mt-[5px] text-[12.5px] ${cu.muted}`}>{body.caption}</div>
      {body.extra}
      {body.comment ? <p className={`mt-2 border-t border-[#F1F2F5] pt-2 text-[13px] italic dark:border-slate-700 ${cu.text}`}>“{body.comment}”</p> : null}
    </div>
  );
  const ratingsCard = (
    <div className={`${cardCls} px-[22px] pb-5 pt-[18px] max-sm:px-4 max-lg:order-6`} data-testid="ratings-card">
      <div className="flex items-baseline justify-between gap-2.5">
        <h2 className="text-[16px] font-extrabold text-[#1F2430] dark:text-slate-100">Customer ratings</h2>
        <button
          type="button"
          onClick={() => setRatingsHelp((v) => !v)}
          aria-expanded={ratingsHelp}
          className={`border-b border-dashed border-[#C7CCD6] text-[12px] font-semibold dark:border-slate-500 ${cu.muted} ${tapHalo}`}
        >
          What's shown?
        </button>
      </div>
      {ratingsHelp && (
        <p className={`mt-2 text-[12px] leading-relaxed ${cu.muted}`}>
          Stars only — no customer names or phones. Optional short comments may appear when the customer left feedback with their rating.
          Rider scores are internal (not shown on public menus). Public brand average is the same all-time figure customers see for that brand online.
        </p>
      )}
      {ratingsLoading ? (
        <p className={`mt-3.5 text-[13px] ${cu.muted}`}>Loading ratings…</p>
      ) : (
        <div className="mt-3.5 grid grid-cols-2 gap-3 max-sm:grid-cols-1">
          {(isDelivery || ratings?.rider_rating) &&
            ratingBox('rider', 'Delivery rider', {
              stars: ratings?.rider_rating?.stars ?? null,
              caption: ratings?.rider_rating
                ? `${ratings.rider_rating.stars}/5${ratings.rider_rating.rated_at ? ` · Updated ${formatDateTime(ratings.rider_rating.rated_at)}` : ''}`
                : 'Not rated yet',
              comment: ratings?.rider_rating?.comment,
            })}
          {ratings?.brand_ratings && ratings.brand_ratings.length > 0
            ? ratings.brand_ratings.map((br) =>
                ratingBox(br.brand_id, 'Brand / food', {
                  name: br.brand_name ?? `Brand #${br.brand_id}`,
                  stars: br.order_stars,
                  caption: `${br.order_stars}/5${br.order_rated_at ? ` · ${formatDateTime(br.order_rated_at)}` : ''}`,
                  comment: br.order_comment,
                  extra: (
                    <div className={`mt-1 text-[12px] ${cu.muted}`}>
                      Public average:{' '}
                      {br.public_rating_average != null ? (
                        <>
                          <strong className={cu.text}>{br.public_rating_average.toFixed(1)} / 5</strong> · {br.public_rating_count} rating
                          {br.public_rating_count === 1 ? '' : 's'} (all orders)
                        </>
                      ) : (
                        'no public ratings yet'
                      )}
                    </div>
                  ),
                }),
              )
            : ratingBox('brand', 'Brand / food', { name: o.brand?.name ?? null, stars: null, caption: 'Not rated yet' })}
        </div>
      )}
    </div>
  );

  const infoBox = (icon: React.ReactNode, label: string, children: React.ReactNode) => (
    <div className="mt-3.5 flex items-start gap-2.5 rounded-[11px] bg-[#F6F7F9] px-[13px] py-3 dark:bg-slate-700/50">
      <span className="mt-px flex-none text-[#8A92A0] dark:text-slate-400" aria-hidden="true">
        {icon}
      </span>
      <div className="min-w-0">
        <div className={cu.label}>{label}</div>
        <div className={`mt-0.5 text-[13px] leading-[1.45] ${cu.text}`}>{children}</div>
      </div>
    </div>
  );
  const pinIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5c2.8 0 5 2.1 5 4.8 0 3.2-5 8.2-5 8.2S3 9.5 3 6.3C3 3.6 5.2 1.5 8 1.5z" /><circle cx="8" cy="6.2" r="1.6" />
    </svg>
  );
  const tableIcon = (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 5.5h12M4 5.5v7M12 5.5v7M3 8.5h10" />
    </svg>
  );
  const customerCard = (
    <div className={`${cardCls} px-5 py-[18px] max-lg:order-2`} data-testid="customer-card">
      <div className="mb-3.5 flex items-center justify-between gap-2.5">
        <h2 className={sectionTitle}>Customer</h2>
        {o.customer_id != null && canViewCustomers && (
          <Link to={`/admin/customers/${o.customer_id}`} className="text-[12.5px] font-bold text-[#DC2A2A] hover:text-[#B5121B] dark:text-red-400 dark:hover:text-red-300">
            View profile
          </Link>
        )}
      </div>
      {hasCustomer ? (
        <div className="flex items-center gap-3">
          <span
            aria-hidden="true"
            className="flex h-10 w-10 flex-none items-center justify-center rounded-full bg-[#F1F2F5] text-[14px] font-extrabold text-[#5A6473] dark:bg-slate-700 dark:text-slate-300"
          >
            {nameInitials(customerName || null)}
          </span>
          <div className="min-w-0">
            <div className={`text-[14.5px] font-bold ${cu.strong}`}>{customerName || 'No name'}</div>
            {customerPhone && (
              <a href={`tel:${customerPhone}`} className={`text-[13px] font-semibold tabular-nums text-[#DC2A2A] hover:text-[#B5121B] dark:text-red-400 dark:hover:text-red-300 ${tapHalo}`}>
                {formatPhone(customerPhone)}
              </a>
            )}
          </div>
        </div>
      ) : (
        <p className={`text-[13px] ${cu.muted}`}>{o.table_number ? 'Dine-in guest — no customer record on this order.' : 'Walk-in — no customer details on this order.'}</p>
      )}
      {o.table_number && infoBox(tableIcon, 'Table', o.table_number)}
      {o.delivery_address &&
        infoBox(
          pinIcon,
          'Deliver to',
          <>
            {o.delivery_address}
            {(eta || o.delivery_tier) && (
              <div className={`mt-1 text-[12px] ${cu.muted}`}>
                {o.delivery_tier ? `${o.delivery_tier} delivery` : 'Delivery'}
                {eta ? ` · ETA ${eta}` : ''}
              </div>
            )}
          </>,
        )}
    </div>
  );

  const row = (label: React.ReactNode, value: React.ReactNode, cls = '') => (
    <div className={`flex items-baseline justify-between gap-3 py-[5px] text-[13.5px] ${cls}`}>
      <span className={`min-w-0 ${cu.soft}`}>{label}</span>
      <span className={`flex-none whitespace-nowrap text-right tabular-nums ${cu.text}`}>{value}</span>
    </div>
  );
  const deliveryCard = showDelivery && (
    <div className={`${cardCls} px-5 py-[18px] max-lg:order-3`} data-testid="delivery-card">
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <h2 className={sectionTitle}>Delivery</h2>
        <span className={`rounded-full px-2.5 py-1 text-[11.5px] font-bold ${deliveryStatusTone(o.delivery_status)}`}>
          {deliveryStatusLabel(o.delivery_status, { fallback: 'Not assigned' })}
        </span>
      </div>
      {row('Rider', o.rider ? <span className={`font-bold ${cu.strong}`}>{o.rider.name}</span> : 'Not assigned')}
      {/* The rider's own taps — never the order's completed time, which staff can set. */}
      {row('Picked up', formatDateTime(o.picked_up_at))}
      {row('Delivered', formatDateTime(o.delivered_at))}
      {row('Trip time', <span className={`font-bold ${cu.strong}`}>{formatTripDuration(o.trip_duration_seconds)}</span>)}
      {/* The rider's own words for why it failed. */}
      {isDeliveryFailed(o.delivery_status) && (
        <p className="mt-2.5 rounded-[10px] border border-red-200 bg-red-50 px-3 py-2 text-[13px] text-red-800 dark:border-red-800 dark:bg-red-900/25 dark:text-red-200">
          <span className="font-bold">Reason: </span>
          {o.delivery_failed_reason?.trim() ? o.delivery_failed_reason : 'No reason was recorded by the rider.'}
        </p>
      )}
    </div>
  );

  const totalsCard = (
    <div className={`${cardCls} px-5 py-[18px] max-lg:order-4`} data-testid="totals-card">
      <h2 className={`mb-3 ${sectionTitle}`}>Totals</h2>
      {row('Subtotal', formatCurrency(subtotal))}
      {hasDiscount &&
        row(
          <>
            {voucherName ? 'Voucher' : 'Discount'}
            {voucherName && (
              <span className={`ml-1 ${cu.muted}`}>
                (<strong className={cu.text}>{voucherName}</strong>)
              </span>
            )}
            {hasCoupon && (
              <span className={`ml-1 ${cu.muted}`}>
                (Coupon: <strong className={cu.text}>{o.discount_code}</strong>)
              </span>
            )}
          </>,
          <span className={`font-semibold ${cu.good}`}>-{formatCurrency(discountAmount)}</span>,
        )}
      {voucherKinds.length > 1 && (
        <div className={`pl-4 text-[12.5px] ${cu.muted}`}>
          {voucherKinds.map((v) => (
            <div key={v.name} className="flex justify-between gap-3 py-0.5">
              <span>{voucherKindLabel(v)}</span>
              <span className="tabular-nums">-{formatCurrency(Number(v.discount_amount))}</span>
            </div>
          ))}
        </div>
      )}
      {!hasDiscount && hasCoupon && row(`Coupon applied: ${o.discount_code}`, '—')}
      {row(taxLabel, formatCurrency(taxAmount))}
      {serviceCharge > 0 && row('Service charge', formatCurrency(serviceCharge))}
      {deliveryFee > 0 && row('Delivery fee', formatCurrency(deliveryFee))}
      {(o.loyalty_points_earned ?? 0) > 0 && row('Points earned', <span className={`font-semibold ${cu.good}`}>+{o.loyalty_points_earned}</span>)}
      {(o.loyalty_points_redeemed ?? 0) > 0 && row('Points redeemed', `−${o.loyalty_points_redeemed}`)}
      <div className="mt-2 flex items-baseline justify-between gap-3 border-t border-dashed border-[#E2E5EA] pt-3 dark:border-slate-600">
        <span className={`text-[14px] font-extrabold ${cu.strong}`}>Total</span>
        <span className={`text-[22px] font-black tracking-[-.01em] tabular-nums ${cu.strong}`} data-testid="grand-total">
          {formatCurrency(totalAmount)}
        </span>
      </div>
    </div>
  );

  const paymentCard = (
    <div className={`${cardCls} px-5 py-[18px] max-lg:order-5`} data-testid="payment-card">
      <div className="mb-3 flex items-center justify-between gap-2.5">
        <h2 className={sectionTitle}>Payment</h2>
        <span className={`rounded-full border px-2.5 py-1 text-[11.5px] font-bold ${PAYMENT_PILL[pay.key].cls}`} data-testid="payment-pill">
          {PAYMENT_PILL[pay.key].label}
        </span>
      </div>
      {amountDue > 0 && row('Amount due', <span className={`font-extrabold ${cu.strong}`}>{formatCurrency(amountDue)}</span>)}
      {/* An app order the rider (or the counter) collects cash for: the tender is known from the
          moment it arrives, the money only once completion records it. */}
      {o.pending_payment_method && (
        <div data-testid="pending-tender">
          {row('Method', <span className={`font-bold ${cu.strong}`}>{PENDING_TENDER_LABEL[o.pending_payment_method] ?? o.pending_payment_method}</span>)}
          <p className={`mt-0.5 text-[12px] ${cu.muted}`}>Collected on delivery or at the counter, and recorded here when the order is completed.</p>
        </div>
      )}
      {o.payments && o.payments.length > 0 ? (
        <div className="mt-1">
          {o.payments.map((p) => (
            <div key={p.id} className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 border-t border-[#F4F5F7] py-2.5 text-[13.5px] first:border-t-0 dark:border-slate-700/70">
              <span className="min-w-0">
                <span className={`font-bold ${cu.strong}`}>{tenderLabel(p.method ?? p.payment_method)}</span>
                <span className={`ml-2 text-[12px] capitalize ${cu.muted}`}>{p.status}</span>
              </span>
              <span className={`font-extrabold tabular-nums ${cu.strong}`}>{formatCurrency(Number(p.amount))}</span>
              {p.paid_at && <span className={`w-full text-[12px] ${cu.muted}`}>{formatDateTime(p.paid_at)}</span>}
            </div>
          ))}
        </div>
      ) : (
        <p className={`mt-1.5 text-[12.5px] ${cu.muted}`}>No payments recorded for this order yet.</p>
      )}
    </div>
  );

  const outlineBtn = `${cu.btnOutline} inline-flex items-center justify-center gap-2 max-sm:flex-1 max-sm:px-3`;

  return (
    <div className={`${cu.page} ${isPhone && canUpdateStatus ? 'pb-28' : ''}`}>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3.5">
        <Link
          to="/admin/orders"
          className={`inline-flex items-center gap-[7px] text-[13px] font-semibold text-[#6B7280] hover:text-[#B5121B] dark:text-slate-400 dark:hover:text-red-300 ${tapHalo}`}
        >
          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M13 8H3M6.5 4.5L3 8l3.5 3.5" />
          </svg>
          Orders
        </Link>
        <div className="flex gap-[9px] max-sm:w-full">
          <button type="button" onClick={handlePrint} className={outlineBtn}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4.5 6V2.5h7V6" /><rect x="2.5" y="6" width="11" height="5.5" rx="1.2" /><path d="M4.5 9.5h7v4h-7z" />
            </svg>
            Print
          </button>
          <button type="button" onClick={() => setShowCustomerInvoice(true)} className={outlineBtn}>
            <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M4 2h6l2 2v10l-2-1-2 1-2-1-2 1z" /><path d="M5.5 6h5M5.5 9h5" />
            </svg>
            Customer invoice
          </button>
        </div>
      </div>

      {/* Who, what, where, and the status */}
      <div className={`${cardCls} mb-4 px-6 pb-[22px] pt-5 max-sm:px-4`} data-testid="header-card">
        <div className="flex flex-wrap items-start justify-between gap-x-[18px] gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-[25px] font-extrabold tracking-[-.02em] text-[#1F2430] dark:text-slate-100 max-sm:text-[22px]">Order #{orderNum}</h1>
              <span
                data-testid="type-badge"
                className={`inline-flex items-center gap-1.5 rounded-[7px] px-[9px] py-1 text-[11.5px] font-extrabold uppercase tracking-[.03em] ${typeBadge.cls}`}
              >
                {typeBadge.icon}
                {formatOrderType(orderType)}
              </span>
              <span
                data-testid="source-badge"
                title="Order source"
                className={`rounded-[7px] px-[9px] py-1 text-[11.5px] font-bold ${SOURCE_BADGE[String(o.source ?? '')] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-200'}`}
              >
                {orderSourceLabel(o.source)}
              </span>
            </div>
            <div className={`mt-[5px] flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] ${cu.muted}`} data-testid="order-meta">
              {o.brand?.name && (
                <>
                  <span className={`font-bold ${cu.text}`}>{o.brand.name}</span>
                  {dot}
                </>
              )}
              {o.branch?.name && (
                <>
                  <span>{o.branch.name}</span>
                  {dot}
                </>
              )}
              <span>Placed {formatDateTime(o.placed_at)}</span>
              {o.creator?.name && (
                <>
                  {dot}
                  <span>by {o.creator.name}</span>
                </>
              )}
            </div>
          </div>
          <div className="flex flex-none items-center gap-2.5 max-lg:w-full max-lg:justify-between">
            <span className={`text-[12.5px] font-semibold ${cu.muted}`}>Status</span>
            {statusPill}
          </div>
        </div>
        {o.notes && (
          <div className="mt-4 rounded-[11px] border border-[#FBE4B8] bg-[#FFF6E6] px-3.5 py-2.5 dark:border-amber-800 dark:bg-amber-900/30" data-testid="order-note">
            <div className="text-[10.5px] font-bold uppercase tracking-[.06em] text-[#B45309] dark:text-amber-300">Order note</div>
            <div className="mt-0.5 text-[13px] font-semibold text-[#92400E] dark:text-amber-200">{o.notes}</div>
          </div>
        )}
        {stepper}
      </div>

      {/* Below lg the two columns fall into one and the cards keep a reading order (ratings last). */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_320px] xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="grid min-w-0 gap-4 max-lg:contents">
          {itemsCard}
          {ratingsCard}
        </div>
        <div className="grid min-w-0 gap-4 max-lg:contents">
          {customerCard}
          {deliveryCard}
          {totalsCard}
          {paymentCard}
        </div>
      </div>

      {/* Phones: the status is what staff come here to change, and the header scrolls away. */}
      {isPhone && canUpdateStatus && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-gray-200 bg-white/95 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3 shadow-[0_-4px_16px_rgba(15,23,42,.08)] backdrop-blur dark:border-slate-700 dark:bg-slate-800/95">
          <button
            type="button"
            onClick={() => setStatusSheet(true)}
            disabled={pending}
            aria-haspopup="dialog"
            aria-expanded={statusSheet}
            className={`${cu.btnPrimary} min-h-[48px] w-full disabled:opacity-60`}
          >
            {pending ? 'Updating…' : `Update status · ${statusLabel(o.status)}`}
          </button>
        </div>
      )}
      {canUpdateStatus && !isDesktop && (
        <ActionsSheet open={statusSheet} onClose={() => setStatusSheet(false)} title={`Order #${orderNum} · status`}>
          {statusOptions.map((s) => {
            const current = s === o.status;
            return (
              <button
                key={s}
                type="button"
                onClick={() => setStatus(s)}
                aria-current={current ? 'true' : undefined}
                className={s === 'cancelled' ? 'text-red-700' : ''}
              >
                {statusLabel(s)}
                {current && <span className="ml-auto text-[12px] font-bold text-[#9AA1AD] dark:text-slate-400">Current</span>}
              </button>
            );
          })}
        </ActionsSheet>
      )}

      <CustomerInvoiceModal
        isOpen={showCustomerInvoice}
        onClose={() => setShowCustomerInvoice(false)}
        orderGroupId={o.order_group_id ?? null}
        orderId={o.id}
      />
      {paymentPrompt.modal}
    </div>
  );
};

export default OrderDetail;
