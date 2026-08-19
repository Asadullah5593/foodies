import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Order, Branch } from '../../types';
import Loader from '../../components/Loader';
import FetchingOverlay from '../../components/FetchingOverlay';
import { formatCurrency } from '../../utils/currency';
import { formatOrderType } from '../../utils/format';
import AssignRiderModal from '../../components/AssignRiderModal';
import CustomerInvoiceModal from '../../components/CustomerInvoiceModal';
import PaginationBar from '../../components/PaginationBar';
import { ORDER_POLL_INTERVAL_MS } from '../../constants/polling';
import { useHasPermission, useHasRestriction } from '../../hooks/useHasPermission';
import {
  NO_CANCEL_PERMISSION,
  NO_TOTALS_PERMISSION,
  STATUS_CHANGE_PERMISSIONS,
  selectableStatuses,
} from '../../lib/orderStatusPermissions';
import { canAccessPath } from '../../lib/pathPermissions';
import {
  ORDERS_GRID_MIN_PX,
  ordersCardColumns,
  ordersGridTemplate,
  ordersLayoutForWidth,
  type OrdersLayout,
} from './ordersLayout';
import { useAuth } from '../../contexts/AuthContext';
import { ORDER_SOURCES, ORDER_SOURCE_LABEL, orderSourceLabel } from '../../utils/orderSources';
import { deliveryStatusLabel } from '../../lib/deliveryStatus';
import { useResultsRefreshing } from '../../components/useResultsRefreshing';

type OrderPayment = { paymentMethod?: string; payment_method?: string; status?: string; amount?: number | string };

type OrderRow = Omit<Order, 'payments' | 'creator'> & {
  order_number?: string;
  orderNumber?: string;
  total_amount?: number;
  totalAmount?: number;
  // The discount split, in both casings — /admin/orders returns raw entities.
  discountAmount?: number | string;
  promo_discount_amount?: number | string;
  promoDiscountAmount?: number | string;
  order_discount_amount?: number | string;
  orderDiscountAmount?: number | string;
  coupon_discount_amount?: number | string;
  couponDiscountAmount?: number | string;
  card_discount_amount?: number | string;
  cardDiscountAmount?: number | string;
  staff_discount_amount?: number | string;
  staffDiscountAmount?: number | string;
  order_group_id?: string | null;
  orderGroupId?: string | null;
  branch?: { id: number; name: string; code: string };
  brand?: { id: number; name: string };
  order_type?: string;
  orderType?: string;
  status?: string;
  source?: 'pos' | 'consumer_app' | string;
  rider_id?: number | null;
  rider?: { id: number; name: string } | null;
  delivery_status?: string | null;
  delivery_failed_reason?: string | null;
  customer_name?: string | null;
  table_number?: string | null;
  placed_at?: string | null;
  creator?: { id: number; name?: string | null } | null;
  orderItems?: unknown[];
  items_count?: number;
  payments?: OrderPayment[] | null;
};

/** Server-paginated envelope from GET /admin/orders. */
type OrdersEnvelope = {
  data: OrderRow[];
  total: number;
  total_all: number;
  page: number;
  page_size: number;
  status_counts: Record<string, number>;
};

function normalizeOrder(o: OrderRow): OrderRow {
  const row = o as OrderRow & {
    riderId?: number; brandId?: number; deliveryStatus?: string; deliveryFailedReason?: string;
    customerName?: string | null; tableNumber?: string | null; placedAt?: string; createdAt?: string;
  };
  return {
    ...o,
    order_number: o.order_number ?? o.orderNumber,
    total_amount: o.total_amount ?? o.totalAmount ?? 0,
    // /admin/orders returns raw entities, so the discount split arrives
    // camelCase. Normalised here so the column reads one shape.
    discount_amount: Number(o.discount_amount ?? row.discountAmount ?? 0),
    promo_discount_amount: Number(o.promo_discount_amount ?? row.promoDiscountAmount ?? 0),
    order_discount_amount: Number(o.order_discount_amount ?? row.orderDiscountAmount ?? 0),
    coupon_discount_amount: Number(o.coupon_discount_amount ?? row.couponDiscountAmount ?? 0),
    card_discount_amount: Number(o.card_discount_amount ?? row.cardDiscountAmount ?? 0),
    staff_discount_amount: Number(o.staff_discount_amount ?? row.staffDiscountAmount ?? 0),
    order_group_id: o.order_group_id ?? o.orderGroupId ?? null,
    order_type: o.order_type ?? o.orderType,
    // /admin/orders returns raw entities (camelCase + nested brand), never brand_id.
    // Without this the rider dropdown drops its brand filter and lists every rider.
    brand_id: o.brand_id ?? row.brandId ?? o.brand?.id ?? null,
    brand_name: o.brand_name ?? o.brand?.name ?? null,
    rider_id: o.rider_id ?? row.riderId ?? null,
    rider: o.rider ?? null,
    delivery_status: o.delivery_status ?? row.deliveryStatus ?? null,
    delivery_failed_reason: o.delivery_failed_reason ?? row.deliveryFailedReason ?? null,
    source: o.source ?? 'pos',
    customer_name: o.customer_name ?? row.customerName ?? null,
    table_number: o.table_number ?? row.tableNumber ?? null,
    placed_at: o.placed_at ?? row.placedAt ?? row.createdAt ?? null,
    items_count: o.items_count ?? (Array.isArray(o.orderItems) ? o.orderItems.length : 0),
    payments: o.payments ?? null,
  };
}

const ORDER_STATUS_LABELS: Record<string, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  preparing: 'Preparing',
  ready: 'Ready',
  completed: 'Completed',
  cancelled: 'Cancelled',
};


/* ------------------------------------------------------------------ meta -- */

const STATUS_META: Record<string, { bg: string; color: string; dot: string }> = {
  placed: { bg: 'bg-gray-100 dark:bg-slate-700', color: 'text-gray-600 dark:text-slate-300', dot: 'bg-gray-400' },
  accepted: { bg: 'bg-blue-50 dark:bg-blue-900/40', color: 'text-blue-600 dark:text-blue-300', dot: 'bg-blue-500' },
  preparing: { bg: 'bg-amber-50 dark:bg-amber-900/40', color: 'text-amber-700 dark:text-amber-300', dot: 'bg-amber-500' },
  ready: { bg: 'bg-emerald-50 dark:bg-emerald-900/40', color: 'text-emerald-600 dark:text-emerald-300', dot: 'bg-emerald-500' },
  completed: { bg: 'bg-gray-100 dark:bg-slate-700', color: 'text-gray-500 dark:text-slate-400', dot: 'bg-gray-300' },
  cancelled: { bg: 'bg-red-50 dark:bg-red-900/40', color: 'text-red-600 dark:text-red-300', dot: 'bg-red-600' },
};

const DELIVERY_META: Record<string, { bg: string; color: string }> = {
  assigned: { bg: 'bg-blue-50 dark:bg-blue-900/40', color: 'text-blue-600 dark:text-blue-300' },
  accepted: { bg: 'bg-blue-50 dark:bg-blue-900/40', color: 'text-blue-600 dark:text-blue-300' },
  picked_up: { bg: 'bg-amber-50 dark:bg-amber-900/40', color: 'text-amber-700 dark:text-amber-300' },
  delivered: { bg: 'bg-emerald-50 dark:bg-emerald-900/40', color: 'text-emerald-600 dark:text-emerald-300' },
  delivery_failed: { bg: 'bg-red-50 dark:bg-red-900/40', color: 'text-red-600 dark:text-red-300' },
};

const TYPE_META: Record<string, { bg: string; color: string; short: string; icon: React.ReactNode }> = {
  delivery: {
    bg: 'bg-blue-50 dark:bg-blue-900/40', color: 'text-blue-600 dark:text-blue-300', short: 'DEL',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <circle cx="4" cy="11.5" r="2" /><circle cx="12" cy="11.5" r="2" /><path d="M4 11.5l3-5.5h2.5l2 5.5M7 6l-1-2H4.3" />
      </svg>
    ),
  },
  dine_in: {
    bg: 'bg-violet-50 dark:bg-violet-900/40', color: 'text-violet-600 dark:text-violet-300', short: 'DINE',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 2v4a1.5 1.5 0 0 0 3 0V2M5.5 6v8" /><path d="M11 2c-1 0-1.6 1.6-1.6 3.4S10 8.4 11 8.4V14" />
      </svg>
    ),
  },
  takeaway: {
    bg: 'bg-orange-50 dark:bg-orange-900/40', color: 'text-orange-700 dark:text-orange-300', short: 'T/A',
    icon: (
      <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 5.5h8l-.7 8.2a.8.8 0 0 1-.8.8H5.5a.8.8 0 0 1-.8-.8z" /><path d="M6 5.5V4.2a2 2 0 0 1 4 0v1.3" />
      </svg>
    ),
  },
};

const PAYMENT_METHOD_LABEL: Record<string, string> = { cash: 'Cash', card: 'Card', online_transfer: 'Online transfer', cod: 'COD', other: 'Other', online: 'Online' };

/** Rows-per-page choices. Capped at 1000 — the server's ceiling, and beyond that
 *  a single page drags too many joined rows to render comfortably. */
const ORDERS_PAGE_SIZE_OPTIONS = [25, 50, 100, 200, 500, 1000];
const ORDERS_DEFAULT_PAGE_SIZE = 25;

/* --------------------------------------------------------------- helpers -- */

function localDateYYYYMMDD(date?: Date): string {
  const d = date ?? new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function getOrderType(o: OrderRow): string {
  return String(o.order_type ?? o.orderType ?? '').trim();
}

function isDeliveryOrder(o: OrderRow): boolean {
  return getOrderType(o) === 'delivery';
}

/** Delivery order still needing a rider while the kitchen is actively working it. */
function needsRider(o: OrderRow): boolean {
  return (
    isDeliveryOrder(o) &&
    o.rider_id == null &&
    ['placed', 'accepted', 'preparing', 'ready'].includes(String(o.status ?? ''))
  );
}

function placedTimeText(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function ageMinutes(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 60000));
}

function ageText(m: number | null): string {
  if (m == null) return '';
  if (m >= 60) return `${Math.floor(m / 60)}h ${m % 60}m ago`;
  return `${m}m ago`;
}

/** Distinct completed tender methods ("Cash + Card" for a split bill), '—' before any tender. */
function paymentMethodText(o: OrderRow): string {
  const done = (o.payments ?? []).filter((p) => (p.status ?? '') === 'completed');
  const methods = [...new Set(done.map((p) => p.paymentMethod ?? p.payment_method).filter(Boolean))] as string[];
  if (!methods.length) return '—';
  return methods.map((m) => PAYMENT_METHOD_LABEL[m] ?? m).join(' + ');
}

/**
 * Which kinds of discount made up an order's total reduction.
 *
 * The stored split (promo / order / coupon / card / staff) is what the invoice
 * itemises, so a single "Discount: 120" column would hide the thing people
 * actually ask about — whether the money came out of the merchant's margin or
 * the bank's.
 */
const DISCOUNT_KINDS: Array<{
  key: keyof OrderRow;
  /** Column label — kept short, several share one cell. */
  label: string;
  /** `discount` query value; matches the server's whitelist. */
  filter: string;
  /** Filter-dropdown label, where there is room to be unambiguous. */
  long: string;
}> = [
  { key: 'promo_discount_amount' as keyof OrderRow, label: 'Promo', filter: 'promo', long: 'Promotion only' },
  { key: 'order_discount_amount' as keyof OrderRow, label: 'Discount', filter: 'order', long: 'Order discount only' },
  { key: 'coupon_discount_amount' as keyof OrderRow, label: 'Coupon', filter: 'coupon', long: 'Coupon only' },
  { key: 'card_discount_amount' as keyof OrderRow, label: 'Card', filter: 'card', long: 'Card offer only' },
  { key: 'staff_discount_amount' as keyof OrderRow, label: 'Staff', filter: 'staff', long: 'Staff discount only' },
];

function discountKinds(o: OrderRow): Array<{ label: string; amount: number }> {
  return DISCOUNT_KINDS.map(({ key, label }) => ({
    label,
    amount: Number((o as unknown as Record<string, unknown>)[key] ?? 0),
  })).filter((d) => d.amount > 0);
}

function paymentState(o: OrderRow): 'paid' | 'partial' | 'unpaid' {
  const done = (o.payments ?? []).filter((p) => (p.status ?? '') === 'completed');
  const paid = done.reduce((s, p) => s + Number(p.amount ?? 0), 0);
  const total = Number(o.total_amount ?? 0);
  if (paid <= 0) return 'unpaid';
  return paid + 0.01 >= total ? 'paid' : 'partial';
}

function customerText(o: OrderRow): string {
  if (o.customer_name?.trim()) return o.customer_name;
  if (o.table_number) return `Table ${o.table_number}`;
  return 'Walk-in';
}

function createdByText(o: OrderRow): string {
  if (o.creator?.name) return o.creator.name;
  return orderSourceLabel(o.source);
}

const cellHead =
  'text-[11.5px] font-bold uppercase tracking-[.05em] text-gray-400 dark:text-slate-500';

/** Shared 13-column grid for the table head and rows (leading serial #). */

const SOURCE_BADGE: Record<string, string> = {
  pos: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200',
  call_centre: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-200',
  consumer_app: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  consumer_web: 'bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200',
  kiosk: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
};

/* ------------------------------------------------------------------ page -- */

const Orders: React.FC = () => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const canAssignRider = useHasPermission(['orders:assign-rider', 'customer-display:update']);
  const canFilterBranch = useHasPermission('orders:filter:branch');
  const canFilterBrand = useHasPermission('orders:filter:brand');
  const canFilterOrderType = useHasPermission('orders:filter:order-type');
  const canFilterSource = useHasPermission('orders:filter:source');
  const canFilterStatus = useHasPermission('orders:filter:status');
  const canFilterSearch = useHasPermission('orders:filter:search');
  const canFilterPayment = useHasPermission('orders:filter:payment');
  const canFilterDiscount = useHasPermission('orders:filter:discount');
  /**
   * Changing the kitchen status is its own right. Without it the pill must be
   * inert text, not a menu button — order-taking tablets read status, they do
   * not drive the kitchen. The server guards the mutation too; this stops the
   * UI offering an action that would be refused.
   */
  // Either permission works the status flow; the no-cancel one simply cannot
  // reach 'cancelled' (filtered below, and refused server-side).
  const canUpdateStatus = useHasPermission(STATUS_CHANGE_PERMISSIONS);
  const noCancel = useHasRestriction(NO_CANCEL_PERMISSION);
  const hideOrderTotals = useHasRestriction(NO_TOTALS_PERMISSION);
  // Gate the rider-ops banner + auto-assign pill on the routes they link to, so
  // a user with orders:view but no rider-HRM / branch access never sees
  // dead-end buttons or the auto-assign status they cannot act on.
  const canOpenRiderHrm = canAccessPath(user, '/admin/rider-hrm');
  const canConfigBranches = canAccessPath(user, '/admin/branches');
  // Roles can be limited to the last N days; the server enforces the same floor,
  // so this only stops the picker offering dates that would return nothing.
  const historyDays = user?.order_history_days ?? null;
  const minDate = useMemo(() => {
    if (historyDays == null || historyDays < 1) return undefined;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - (Math.floor(historyDays) - 1));
    return localDateYYYYMMDD(d);
  }, [historyDays]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [ordersPage, setOrdersPage] = useState(1);
  const [pageSize, setPageSize] = useState(ORDERS_DEFAULT_PAGE_SIZE);
  const [search, setSearch] = useState('');
  const [customerInvoiceGroupId, setCustomerInvoiceGroupId] = useState<string | null>(null);
  const [customerInvoiceOrderId, setCustomerInvoiceOrderId] = useState<number | null>(null);
  const [riderModalOrderId, setRiderModalOrderId] = useState<number | null>(null);
  const [riderModalGroupId, setRiderModalGroupId] = useState<string | null>(null);
  const [riderModalIsChange, setRiderModalIsChange] = useState(false);
  const [riderModalBrandId, setRiderModalBrandId] = useState<number | null>(null);
  const [riderModalBrandName, setRiderModalBrandName] = useState<string | null>(null);
  const [selectedRiderId, setSelectedRiderId] = useState<number | null>(null);
  // Custom kitchen-status dropdown (fixed-position popover so the table's
  // overflow container can't clip it).
  /**
   * Layout is chosen from the table container's own measured width, not a
   * viewport breakpoint: the sidebar collapses and the page has padding, so the
   * viewport says nothing useful about how much room the table actually has.
   */
  const [layout, setLayout] = useState<OrdersLayout | null>(null);
  const [measuredWidth, setMeasuredWidth] = useState(0);

  const measure = useCallback((width: number) => {
    setMeasuredWidth((prev) => (prev === width ? prev : width));
    setLayout((prev) => {
      const next = ordersLayoutForWidth(width);
      return next === prev ? prev : next;
    });
  }, []);

  /**
   * A CALLBACK ref, not useRef + useLayoutEffect. This page returns a
   * full-screen loader while the first fetch is in flight, so the table simply
   * does not exist on the first render — an effect would run against a null ref,
   * bail, and never re-run once the table mounted, leaving every user stuck on
   * the fallback layout. A callback ref fires on every mount, so the table is
   * measured whenever it actually appears.
   */
  const roRef = useRef<ResizeObserver | null>(null);
  const setTableEl = useCallback(
    (el: HTMLDivElement | null) => {
      roRef.current?.disconnect();
      roRef.current = null;
      if (!el) return;
      measure(el.getBoundingClientRect().width);
      if (typeof ResizeObserver === 'undefined') return;
      const ro = new ResizeObserver((entries) => {
        measure(entries[0]?.contentRect.width ?? 0);
      });
      ro.observe(el);
      roRef.current = ro;
    },
    [measure],
  );

  const showGrid = layout === 'grid';
  const cardColumns = ordersCardColumns(measuredWidth);

  const [statusMenu, setStatusMenu] = useState<{
    orderId: number; orderNumber?: string; current: string; x: number; y: number; openUp: boolean;
  } | null>(null);
  const branchId = searchParams.get('branch_id') || '';
  const brandId = searchParams.get('brand_id') || '';
  const status = searchParams.get('status') || '';
  const orderType = searchParams.get('order_type') || '';
  const source = searchParams.get('source') || '';
  const paymentMethod = searchParams.get('payment_method') || '';
  const discount = searchParams.get('discount') || '';
  const defaultToday = localDateYYYYMMDD();
  const dateFrom = searchParams.get('date_from') || defaultToday;
  const dateTo = searchParams.get('date_to') || defaultToday;

  const baseParams = {
    ...(branchId && { branch_id: +branchId }),
    ...(brandId && { brand_id: +brandId }),
    ...(orderType && { order_type: orderType }),
    ...(source && { source }),
    ...(paymentMethod && { payment_method: paymentMethod }),
    ...(discount && { discount }),
    ...(dateFrom && { date_from: dateFrom }),
    ...(dateTo && { date_to: dateTo }),
  };

  // Debounce the search box so we fire one request after typing settles, not per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300);
    return () => clearTimeout(t);
  }, [search]);

  const fetchOrders = async (): Promise<OrdersEnvelope> => {
    const sp = new URLSearchParams();
    if (baseParams.branch_id) sp.append('branch_id', String(baseParams.branch_id));
    if (baseParams.brand_id) sp.append('brand_id', String(baseParams.brand_id));
    // 'needs_rider' is a real server-side view now, so it is sent like any status.
    if (status) sp.append('status', status);
    if (baseParams.order_type) sp.append('order_type', baseParams.order_type);
    if (baseParams.source) sp.append('source', baseParams.source);
    if (baseParams.payment_method) sp.append('payment_method', baseParams.payment_method);
    if (baseParams.discount) sp.append('discount', baseParams.discount);
    if (baseParams.date_from) sp.append('date_from', baseParams.date_from);
    if (baseParams.date_to) sp.append('date_to', baseParams.date_to);
    if (debouncedSearch) sp.append('search', debouncedSearch);
    sp.append('page', String(ordersPage));
    sp.append('page_size', String(pageSize));
    const response = await apiClient.get<OrdersEnvelope>(`/admin/orders?${sp.toString()}`);
    const env = response.data;
    return { ...env, data: (env.data ?? []).map(normalizeOrder) };
  };

  // One server-paginated query. status_counts (every tile, over the full filtered
  // set) come back with each page, so there is no separate counting query and no
  // row cap — pagination scales to 100k+ orders.
  const ordersKey = ['admin-orders', baseParams, status, debouncedSearch, ordersPage, pageSize];
  const { data: envelope, isLoading, isFetching } = useQuery({
    queryKey: ordersKey,
    queryFn: fetchOrders,
    placeholderData: keepPreviousData,
    refetchInterval: ORDER_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });
  const ordersRefreshing = useResultsRefreshing(ordersKey, isFetching);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get<Branch[]>('/admin/branches');
      return response.data;
    },
  });

  // The pill used to be a hardcoded "on" label. Derive it from the branches the
  // page already loads: scoped to the selected branch, or aggregated when the
  // filter is "All branches".
  const autoAssign = useMemo(() => {
    const all = branches ?? [];
    const scoped = branchId ? all.filter((b) => String(b.id) === branchId) : all;
    if (scoped.length === 0) {
      return { tone: 'on' as const, label: 'Auto-assign on', title: 'Delivery orders get a rider automatically when the kitchen status moves to Preparing', branchId: null as number | null };
    }
    const off = scoped.filter((b) => b.auto_dispatch_enabled === false);
    const only = scoped.length === 1 ? scoped[0].id : null;
    if (off.length === 0) {
      return { tone: 'on' as const, label: 'Auto-assign on', title: 'Delivery orders get a rider automatically when the kitchen status moves to Preparing. Click to change it per branch.', branchId: only };
    }
    if (off.length === scoped.length) {
      return { tone: 'off' as const, label: 'Auto-assign off', title: 'Delivery orders will NOT get a rider automatically — assign each one manually. Click to change it.', branchId: only };
    }
    return { tone: 'partial' as const, label: `Auto-assign off at ${off.length} branch${off.length === 1 ? '' : 'es'}`, title: `Off at: ${off.map((b) => b.name).join(', ')}. Click to change it per branch.`, branchId: null };
  }, [branches, branchId]);

  // Brand filter (owner sees all; brand-locked users get only their brand back)
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<{ id: number; name: string }[]>('/admin/brands');
      return response.data;
    },
  });

  const { data: onDutyRiders } = useQuery({
    queryKey: ['rider-on-duty-banner'],
    queryFn: () => adminService.getOnDutyRiders(),
    refetchInterval: ORDER_POLL_INTERVAL_MS,
    refetchIntervalInBackground: true,
  });

  const updateStatusMutation = useMutation({
    mutationFn: async ({ id, status }: { id: number; status: string }) => {
      const response = await apiClient.put(`/admin/orders/${id}/status`, { status });
      return response.data;
    },
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
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

  const closeRiderModal = () => {
    setRiderModalOrderId(null);
    setRiderModalGroupId(null);
    setRiderModalBrandId(null);
    setRiderModalBrandName(null);
    setSelectedRiderId(null);
  };

  const assignRiderMutation = useMutation({
    mutationFn: async (params: {
      orderId?: number;
      orderGroupId?: string;
      riderId: number;
      isChange: boolean;
      isGroup: boolean;
    }) => {
      const { riderId, isChange, isGroup, orderId, orderGroupId } = params;
      if (isGroup && orderGroupId) {
        if (isChange) return adminService.changeRiderForGroup(orderGroupId, riderId);
        return adminService.assignRiderToGroup(orderGroupId, riderId);
      }
      if (orderId != null) {
        if (isChange) return adminService.changeRider(orderId, riderId);
        return adminService.assignRider(orderId, riderId);
      }
      throw new Error('Missing orderId or orderGroupId');
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      closeRiderModal();
      toast.success(variables.isGroup ? 'Rider assigned to group' : 'Rider assignment updated');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to assign rider');
    },
  });

  const retryAutoAssignMutation = useMutation({
    mutationFn: (orderId: number) => adminService.retryAutoAssignOrder(orderId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admin-orders'] });
      toast.success('Automatic rider assignment retried');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to retry automatic assignment');
    },
  });

  const setFilter = (key: string, value: string) => {
    const p = new URLSearchParams(searchParams);
    if (value) p.set(key, value);
    else p.delete(key);
    setSearchParams(p);
  };

  const orders = useMemo(() => envelope?.data ?? [], [envelope]);
  // Total rows matching the current filters/search (across ALL pages) — drives
  // the pagination bar and the header count.
  const totalCount = envelope?.total ?? 0;

  /* Status tiles — counts come from the server over the full filtered set (all
     statuses), so every tile is accurate no matter how many pages exist. */
  const tiles = useMemo(() => {
    const sc = envelope?.status_counts ?? {};
    const c = (k: string) => sc[k] ?? 0;
    return [
      { key: '', label: 'All', dot: 'bg-gray-300', n: envelope?.total_all ?? 0 },
      { key: 'placed', label: 'Placed', dot: 'bg-gray-400', n: c('placed') },
      { key: 'accepted', label: 'Accepted', dot: 'bg-blue-500', n: c('accepted') },
      { key: 'preparing', label: 'Preparing', dot: 'bg-amber-500', n: c('preparing') },
      { key: 'ready', label: 'Ready', dot: 'bg-emerald-500', n: c('ready') },
      { key: 'completed', label: 'Completed', dot: 'bg-gray-300', n: c('completed') },
      { key: 'cancelled', label: 'Cancelled', dot: 'bg-red-600', n: c('cancelled') },
      { key: 'needs_rider', label: 'Needs rider', dot: 'bg-red-600', n: c('needs_rider'), alert: true },
    ];
  }, [envelope]);

  /* Group split web orders (shared order_group_id) within the current page. */
  const displayGroups = useMemo(() => {
    const map = new Map<string, OrderRow[]>();
    for (const o of orders) {
      const gid = o.order_group_id ?? null;
      // Ungrouped orders each form their own "group" so keys stay unique.
      const key = gid ?? `single-${o.id}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    const result: { orderGroupId: string | null; orders: OrderRow[] }[] = [];
    map.forEach((orderList, key) => {
      orderList.sort((a, b) => (b.id ?? 0) - (a.id ?? 0));
      result.push({ orderGroupId: key.startsWith('single-') ? null : key, orders: orderList });
    });
    result.sort((a, b) => (b.orders[0]?.id ?? 0) - (a.orders[0]?.id ?? 0));
    return result;
  }, [orders]);

  const visibleOrders = useMemo(() => displayGroups.flatMap((g) => g.orders), [displayGroups]);
  const visibleTotal = visibleOrders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  useEffect(() => {
    setOrdersPage(1);
  }, [branchId, brandId, status, orderType, source, paymentMethod, dateFrom, dateTo, search]);

  // The status popover is position:fixed — dismiss it whenever the page moves
  // or ESC is pressed, so it can never drift away from its pill.
  useEffect(() => {
    if (!statusMenu) return;
    const close = () => setStatusMenu(null);
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      window.removeEventListener('keydown', onKey);
    };
  }, [statusMenu]);

  /** Serial number of each order, continuous across pages (offset by the page). */
  const serialByOrderId = useMemo(() => {
    const m = new Map<number, number>();
    let i = (ordersPage - 1) * pageSize;
    for (const g of displayGroups) for (const o of g.orders) m.set(o.id, ++i);
    return m;
  }, [displayGroups, ordersPage]);

  const isSubmitting = assignRiderMutation.isPending || updateStatusMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading orders...'} />;
  }

  const selectCls =
    'min-w-0 flex-1 sm:flex-none rounded-[10px] border-[1.5px] border-gray-200 bg-white px-3.5 py-3 text-[15px] text-gray-700 outline-none cursor-pointer focus:border-red-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100';

  const openRiderModal = (opts: {
    orderId?: number | null; groupId?: string | null; isChange: boolean;
    brandId: number | null; brandName: string | null; riderId: number | null;
  }) => {
    setRiderModalOrderId(opts.orderId ?? null);
    setRiderModalGroupId(opts.groupId ?? null);
    setRiderModalIsChange(opts.isChange);
    setRiderModalBrandId(opts.brandId);
    setRiderModalBrandName(opts.brandName);
    setSelectedRiderId(opts.riderId);
  };

  const openInvoice = (o: OrderRow) => {
    if (o.order_group_id) {
      setCustomerInvoiceGroupId(o.order_group_id);
      setCustomerInvoiceOrderId(null);
    } else {
      setCustomerInvoiceOrderId(o.id);
      setCustomerInvoiceGroupId(null);
    }
  };

  /* ---------------------------------------------------- shared pieces ----- */

  /** Kitchen-status pill; opens the custom popover. Used by grid rows and cards. */
  const statusPillFor = (o: OrderRow) => {
    const sm = STATUS_META[o.status ?? 'placed'] ?? STATUS_META.placed;
    const label = ORDER_STATUS_LABELS[o.status ?? ''] ?? o.status;
    if (!canUpdateStatus) {
      return (
        <span
          aria-label={`Kitchen status for order #${o.order_number}: ${label}`}
          className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-bold ${sm.bg} ${sm.color}`}
        >
          <span className={`h-2 w-2 rounded-full ${sm.dot}`} />
          {label}
        </span>
      );
    }
    return (
      <button
        type="button"
        aria-label={`Kitchen status for order #${o.order_number}`}
        onClick={(e) => {
          const rect = e.currentTarget.getBoundingClientRect();
          const menuHeight = 6 * 42 + 18;
          const openUp = rect.bottom + menuHeight > window.innerHeight;
          setStatusMenu({
            orderId: o.id,
            orderNumber: o.order_number,
            current: String(o.status ?? 'placed'),
            x: rect.left,
            y: openUp ? rect.top - 6 : rect.bottom + 6,
            openUp,
          });
        }}
        className={`inline-flex cursor-pointer items-center gap-2 rounded-full px-3 py-1.5 text-[13px] font-bold transition-shadow hover:shadow-md ${sm.bg} ${sm.color}`}
      >
        <span className={`h-2 w-2 rounded-full ${sm.dot}`} />
        {ORDER_STATUS_LABELS[o.status ?? ''] ?? o.status}
        <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="opacity-70">
          <path d="M3 4.5l3 3 3-3" />
        </svg>
      </button>
    );
  };

  /** Per-order icon actions (assign/change rider, retry, invoice, view). */
  const actionsFor = (o: OrderRow, canAssign: boolean) => (
    <>
      {canAssign && (
        <button
          title={o.rider_id ? 'Change rider' : 'Assign rider'}
          onClick={() => openRiderModal({
            orderId: o.id, groupId: null, isChange: !!o.rider_id,
            brandId: o.brand_id ?? null, brandName: o.brand_name ?? o.brand?.name ?? null,
            riderId: o.rider_id ?? null,
          })}
          className={`flex h-9 w-9 flex-none items-center justify-center rounded-lg ${
            o.rider_id
              ? 'border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'
              : 'bg-red-600 text-white shadow-sm hover:bg-red-700'
          }`}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <circle cx="6" cy="5" r="2.3" /><path d="M2 13c0-2.2 1.8-3.6 4-3.6" /><path d="M11.5 8v4M9.5 10h4" />
          </svg>
        </button>
      )}
      {!o.rider_id && isDeliveryOrder(o) && (
        <button
          title="Retry auto-assign"
          disabled={retryAutoAssignMutation.isPending}
          onClick={() => retryAutoAssignMutation.mutate(o.id)}
          className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
            <path d="M13 3v3h-3M3 13v-3h3" /><path d="M12 6a4.2 4.2 0 0 0-7.5-1M4 10a4.2 4.2 0 0 0 7.5 1" />
          </svg>
        </button>
      )}
      <button
        title="Customer invoice"
        onClick={() => openInvoice(o)}
        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M4 2h6l2 2v10l-2-1-2 1-2-1-2 1z" /><path d="M5.5 6h5M5.5 9h5" />
        </svg>
      </button>
      <Link
        to={`/admin/orders/${o.id}`}
        title="View order"
        className="flex h-9 w-9 flex-none items-center justify-center rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
          <path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" /><circle cx="8" cy="8" r="2" />
        </svg>
      </Link>
    </>
  );

  const canAssignFor = (o: OrderRow, showPerOrderRiderButton: boolean) =>
    canAssignRider &&
    showPerOrderRiderButton &&
    isDeliveryOrder(o) &&
    (o.delivery_status === 'accepted' || o.delivery_status == null);

  /* ------------------------------------------------------------- row ----- */

  const renderRow = (o: OrderRow, opts: { showPerOrderRiderButton: boolean }) => {
    const type = getOrderType(o);
    const tm = TYPE_META[type] ?? TYPE_META.takeaway;
    const rowNeeds = needsRider(o);
    const age = ageMinutes(o.placed_at);
    const overdue = rowNeeds && (age ?? 0) > 15;
    const payState = paymentState(o);
    const dm = o.delivery_status ? DELIVERY_META[o.delivery_status] : null;
    const canAssign = canAssignFor(o, opts.showPerOrderRiderButton);

    return (
      <div
        key={o.id}
        style={{ gridTemplateColumns: ordersGridTemplate, minWidth: ORDERS_GRID_MIN_PX }}
        className={`grid items-center gap-2.5 border-b border-l-[3px] border-b-gray-100 py-3.5 pl-4 pr-5 dark:border-b-slate-700 ${
          rowNeeds ? 'border-l-red-600 bg-red-50/30 dark:bg-red-900/10' : 'border-l-transparent bg-white dark:bg-slate-800'
        }`}
      >
        {/* Serial */}
        <span className="text-[13px] font-bold tabular-nums text-gray-400 dark:text-slate-500">
          {serialByOrderId.get(o.id) ?? '—'}
        </span>
        {/* Type */}
        <span
          title={formatOrderType(type)}
          className={`inline-flex items-center gap-1.5 justify-self-start rounded-md px-2 py-1 text-[11px] font-extrabold uppercase ${tm.bg} ${tm.color}`}
        >
          {tm.icon}{tm.short}
        </span>
        {/* Order */}
        <div className="min-w-0">
          <Link to={`/admin/orders/${o.id}`} className="text-[15px] font-extrabold text-gray-800 hover:text-red-600 dark:text-slate-100">
            #{o.order_number}
          </Link>
          <div className="truncate text-[12.5px] text-gray-400 dark:text-slate-500">{o.brand?.name ?? o.brand_name ?? '—'}</div>
        </div>
        {/* Customer */}
        <div className="min-w-0">
          <div className="truncate text-[14px] font-semibold text-gray-800 dark:text-slate-100">{customerText(o)}</div>
          <div className="truncate text-[12.5px] text-gray-400 dark:text-slate-500">by {createdByText(o)}</div>
        </div>
        {/* Source */}
        <div>
          <span className={`inline-flex items-center rounded-md px-2.5 py-1 text-[12px] font-bold ${
            SOURCE_BADGE[String(o.source ?? '')] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-200'
          }`}>
            {orderSourceLabel(o.source)}
          </span>
        </div>
        {/* Items */}
        <div className="text-center">
          <span className="inline-flex h-7 min-w-[28px] items-center justify-center rounded-lg bg-gray-100 px-2 text-[13.5px] font-extrabold tabular-nums text-gray-700 dark:bg-slate-700 dark:text-slate-200">
            {o.items_count ?? 0}
          </span>
        </div>
        {/* Placed */}
        <div>
          <div className="text-[13px] text-gray-700 dark:text-slate-300">{placedTimeText(o.placed_at)}</div>
          <div className={`text-[11.5px] font-bold ${overdue ? 'text-red-600' : 'text-gray-400 dark:text-slate-500'}`}>{ageText(age)}</div>
        </div>
        {/* Total */}
        <div className="text-right text-[14.5px] font-extrabold tabular-nums text-gray-800 dark:text-slate-100">
          {formatCurrency(Number(o.total_amount ?? 0))}
        </div>
        {/* Discount — total, with the kinds that produced it underneath */}
        <div className="text-right">
          {Number(o.discount_amount ?? 0) > 0 ? (
            <>
              <div className="text-[14px] font-bold tabular-nums text-amber-700 dark:text-amber-400">
                −{formatCurrency(Number(o.discount_amount ?? 0))}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-gray-400 dark:text-slate-500">
                {discountKinds(o).map((d) => d.label).join(', ') || 'Discount'}
              </div>
            </>
          ) : (
            <span className="text-[13.5px] text-gray-300 dark:text-slate-600">—</span>
          )}
        </div>
        {/* Payment */}
        <div>
          <div className="text-[13.5px] font-semibold text-gray-700 dark:text-slate-200">{paymentMethodText(o)}</div>
          <div className={`mt-0.5 text-[11.5px] font-bold ${
            payState === 'paid' ? 'text-emerald-600' : payState === 'partial' ? 'text-amber-600' : 'text-amber-700 dark:text-amber-400'
          }`}>
            {payState === 'paid' ? 'Paid' : payState === 'partial' ? 'Partial' : 'Unpaid'}
          </div>
        </div>
        {/* Kitchen status — opens the custom popover menu */}
        <div>{statusPillFor(o)}</div>
        {/* Delivery */}
        <div>
          {isDeliveryOrder(o) ? (
            <span
              title={o.delivery_status === 'delivery_failed' ? (o.delivery_failed_reason ?? undefined) : undefined}
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${
                dm ? `${dm.bg} ${dm.color}` : 'bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-400'
              }`}
            >
              {deliveryStatusLabel(o.delivery_status, { short: true })}
            </span>
          ) : (
            <span className="text-[12.5px] text-gray-300 dark:text-slate-600">—</span>
          )}
        </div>
        {/* Rider */}
        <div className={`truncate text-[13.5px] font-semibold ${
          o.rider ? 'text-gray-700 dark:text-slate-200' : isDeliveryOrder(o) ? 'text-red-600' : 'text-gray-300 dark:text-slate-600'
        }`}>
          {o.rider?.name ?? (isDeliveryOrder(o) ? 'Unassigned' : '—')}
        </div>
        {/* Actions */}
        <div className="flex items-center justify-end gap-1.5">
          {actionsFor(o, canAssign)}
        </div>
      </div>
    );
  };

  /* ------------------------------------------------ card (below xl) ------ */

  const renderCard = (o: OrderRow, opts: { showPerOrderRiderButton: boolean }) => {
    const type = getOrderType(o);
    const tm = TYPE_META[type] ?? TYPE_META.takeaway;
    const rowNeeds = needsRider(o);
    const age = ageMinutes(o.placed_at);
    const overdue = rowNeeds && (age ?? 0) > 15;
    const payState = paymentState(o);
    const dm = o.delivery_status ? DELIVERY_META[o.delivery_status] : null;
    const canAssign = canAssignFor(o, opts.showPerOrderRiderButton);

    return (
      <div
        key={o.id}
        className={`rounded-xl border border-l-4 p-3.5 ${
          rowNeeds
            ? 'border-gray-200 border-l-red-600 bg-red-50/30 dark:border-slate-700 dark:bg-red-900/10'
            : 'border-gray-200 border-l-gray-200 bg-white dark:border-slate-700 dark:border-l-slate-600 dark:bg-slate-800'
        }`}
      >
        {/* top: serial + type + order · total */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <span className="text-[13px] font-bold tabular-nums text-gray-400 dark:text-slate-500">
              {serialByOrderId.get(o.id) ?? '—'}
            </span>
            <span
              title={formatOrderType(type)}
              className={`inline-flex flex-none items-center gap-1.5 rounded-md px-2 py-1 text-[11px] font-extrabold uppercase ${tm.bg} ${tm.color}`}
            >
              {tm.icon}{tm.short}
            </span>
            <Link to={`/admin/orders/${o.id}`} className="truncate text-[15px] font-extrabold text-gray-800 hover:text-red-600 dark:text-slate-100">
              #{o.order_number}
            </Link>
            <span className="truncate text-[12.5px] text-gray-400 dark:text-slate-500">· {o.brand?.name ?? o.brand_name ?? '—'}</span>
          </div>
          <span className="flex-none text-right">
            <span className="block text-[15px] font-extrabold tabular-nums text-gray-800 dark:text-slate-100">
              {formatCurrency(Number(o.total_amount ?? 0))}
            </span>
            {Number(o.discount_amount ?? 0) > 0 && (
              <span className="block text-[11px] font-bold tabular-nums text-amber-700 dark:text-amber-400">
                −{formatCurrency(Number(o.discount_amount ?? 0))}
                {' '}
                <span className="font-medium text-gray-400 dark:text-slate-500">
                  {discountKinds(o).map((d) => d.label).join(', ')}
                </span>
              </span>
            )}
          </span>
        </div>
        {/* customer + source */}
        <div className="mt-2 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <span className="text-[14px] font-semibold text-gray-800 dark:text-slate-100">{customerText(o)}</span>
            <span className="ml-1.5 text-[12.5px] text-gray-400 dark:text-slate-500">by {createdByText(o)}</span>
          </div>
          <span className={`inline-flex flex-none items-center rounded-md px-2.5 py-1 text-[12px] font-bold ${
            SOURCE_BADGE[String(o.source ?? '')] ?? 'bg-gray-100 text-gray-600 dark:bg-slate-700 dark:text-slate-200'
          }`}>
            {orderSourceLabel(o.source)}
          </span>
        </div>
        {/* meta line */}
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] text-gray-500 dark:text-slate-400">
          <span>{placedTimeText(o.placed_at)}</span>
          <span className={`font-bold ${overdue ? 'text-red-600' : 'text-gray-400 dark:text-slate-500'}`}>{ageText(age)}</span>
          <span>· {o.items_count ?? 0} item{(o.items_count ?? 0) === 1 ? '' : 's'}</span>
          <span>· {paymentMethodText(o)}</span>
          <span className={`font-bold ${
            payState === 'paid' ? 'text-emerald-600' : payState === 'partial' ? 'text-amber-600' : 'text-amber-700 dark:text-amber-400'
          }`}>
            {payState === 'paid' ? 'Paid' : payState === 'partial' ? 'Partial' : 'Unpaid'}
          </span>
        </div>
        {/* status + delivery + rider */}
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {statusPillFor(o)}
          {isDeliveryOrder(o) && (
            <span
              title={o.delivery_status === 'delivery_failed' ? (o.delivery_failed_reason ?? undefined) : undefined}
              className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12.5px] font-semibold ${
                dm ? `${dm.bg} ${dm.color}` : 'bg-gray-100 text-gray-400 dark:bg-slate-700 dark:text-slate-400'
              }`}
            >
              {deliveryStatusLabel(o.delivery_status, { short: true })}
            </span>
          )}
          {isDeliveryOrder(o) && (
            <span className={`text-[13px] font-semibold ${o.rider ? 'text-gray-600 dark:text-slate-300' : 'text-red-600'}`}>
              {o.rider?.name ?? 'Unassigned'}
            </span>
          )}
          <span className="ml-auto flex items-center gap-1.5">{actionsFor(o, canAssign)}</span>
        </div>
      </div>
    );
  };

  /* -------------------------------------------------- group helpers ----- */

  const groupMetaFor = (groupOrders: OrderRow[]) => {
    const groupTotal = groupOrders.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);
    const allDelivery = groupOrders.every((o) => isDeliveryOrder(o));
    const allSameRider = groupOrders.every((o) => o.rider_id != null && o.rider_id === groupOrders[0].rider_id);
    const groupRider = allSameRider && groupOrders[0].rider ? groupOrders[0].rider : null;
    const groupCanChangeRider = allDelivery && groupRider != null && groupOrders.every((o) => o.delivery_status === 'accepted');
    return { groupTotal, allDelivery, groupRider, groupCanChangeRider, first: groupOrders[0] };
  };

  /** Band content for a split web checkout (label + total + group actions). */
  const groupBandContent = (gid: string, groupOrders: OrderRow[], g: ReturnType<typeof groupMetaFor>) => (
    <>
      <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
        <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="text-violet-500">
          <path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.4-2.4a3 3 0 1 0-4.2-4.2l-1 1" /><path d="M9.5 6.5a3 3 0 0 0-4.2 0L2.9 8.9a3 3 0 1 0 4.2 4.2l1-1" />
        </svg>
        <span className="font-bold text-violet-700 dark:text-violet-300">
          Group · {groupOrders.length} orders
        </span>
        <span className="text-gray-400">·</span>
        <span className="font-extrabold tabular-nums text-gray-800 dark:text-slate-100">{formatCurrency(g.groupTotal)}</span>
        {g.groupRider && <span className="text-gray-500 dark:text-slate-400">· Rider: {g.groupRider.name}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {canAssignRider && g.allDelivery && !g.groupRider && (
          <button
            onClick={() => openRiderModal({
              orderId: null, groupId: gid, isChange: false,
              brandId: g.first.brand_id ?? null, brandName: g.first.brand_name ?? g.first.brand?.name ?? null, riderId: null,
            })}
            className="rounded-lg bg-red-600 px-3 py-1.5 text-[13px] font-bold text-white hover:bg-red-700"
          >
            Assign rider to group
          </button>
        )}
        {canAssignRider && g.groupCanChangeRider && (
          <button
            onClick={() => openRiderModal({
              orderId: null, groupId: gid, isChange: true,
              brandId: g.first.brand_id ?? null, brandName: g.first.brand_name ?? g.first.brand?.name ?? null,
              riderId: g.first.rider_id ?? null,
            })}
            className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-bold text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
          >
            Change rider
          </button>
        )}
        <button
          onClick={() => { setCustomerInvoiceGroupId(gid); setCustomerInvoiceOrderId(null); }}
          className="rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[13px] font-bold text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200"
        >
          Group invoice
        </button>
      </div>
    </>
  );

  return (
    <div className="w-full min-w-0 px-4 py-6 sm:px-6 lg:px-8">
      {/* Header */}
      <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-baseline gap-3">
          <h1 className="text-2xl font-extrabold tracking-tight text-gray-800 dark:text-slate-100 sm:text-3xl">Orders</h1>
          <span className="text-[15px] text-gray-400 dark:text-slate-500">
            {totalCount} {totalCount === 1 ? 'order' : 'orders'} · {dateFrom === dateTo ? dateFrom : `${dateFrom} → ${dateTo}`}
          </span>
        </div>
        <div className="flex items-center gap-2.5">
          {canConfigBranches && (
            <Link
              to={autoAssign.branchId ? `/admin/branches/${autoAssign.branchId}` : '/admin/branches'}
              title={autoAssign.title}
              className={`inline-flex items-center gap-2 rounded-full border px-4 py-2.5 text-[14.5px] font-semibold ${
                autoAssign.tone === 'on'
                  ? 'border-emerald-200 bg-emerald-50 text-emerald-600 dark:border-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : autoAssign.tone === 'off'
                    ? 'border-gray-200 bg-gray-100 text-gray-500 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-300'
                    : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800 dark:bg-amber-900/30 dark:text-amber-300'
              }`}
            >
              <span
                className={`h-2 w-2 rounded-full ${
                  autoAssign.tone === 'on' ? 'bg-emerald-500' : autoAssign.tone === 'off' ? 'bg-gray-400' : 'bg-amber-500'
                }`}
              />
              {autoAssign.label}
            </Link>
          )}
          <button
            title="Refresh"
            onClick={() => queryClient.invalidateQueries({ queryKey: ['admin-orders'] })}
            className="flex h-[42px] w-[42px] items-center justify-center rounded-[10px] border border-gray-200 bg-white text-gray-500 hover:bg-gray-100 dark:border-slate-600 dark:bg-slate-800 dark:text-slate-300"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 4v4h-4M3 14v-4h4" /><path d="M14 8a5 5 0 0 0-9-2M4 10a5 5 0 0 0 9 2" />
            </svg>
          </button>
        </div>
      </div>

      {/* Rider banner — shown only if the user can reach at least one of its
          actions (Rider HRM or branch config). */}
      {(canOpenRiderHrm || canConfigBranches) && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-[14px] border border-gray-200 bg-white px-4 py-3 shadow-sm dark:border-slate-700 dark:bg-slate-800">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl bg-blue-50 text-blue-600 dark:bg-blue-900/40 dark:text-blue-300">
              <svg width="22" height="22" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
                <circle cx="4" cy="11.5" r="2" /><circle cx="12" cy="11.5" r="2" /><path d="M4 11.5l3-5.5h2.5l2 5.5M7 6l-1-2H4.3" />
              </svg>
            </span>
            <div className="min-w-0">
              <div className="text-[16px] font-bold text-gray-800 dark:text-slate-100">
                Automatic rider assignment
                <span className="ml-2 text-[14px] font-semibold text-gray-400 dark:text-slate-500">
                  {onDutyRiders?.length ?? 0} rider{(onDutyRiders?.length ?? 0) === 1 ? '' : 's'} on duty
                </span>
              </div>
              <div className="truncate text-[14px] text-gray-500 dark:text-slate-400" title="Riders need an HR profile, check-in, fresh heartbeat/location, and the branch needs coordinates plus delivery radius.">
                Delivery orders get a rider automatically when the kitchen moves to <strong>Preparing</strong>. Riders need an HR profile, check-in, a fresh heartbeat, and a branch delivery radius.
              </div>
            </div>
          </div>
          <div className="flex flex-none gap-2">
            {canOpenRiderHrm && (
              <Link to="/admin/rider-hrm" className="rounded-[9px] border border-gray-200 bg-white px-4 py-2.5 text-[14px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">
                Open Rider HRM
              </Link>
            )}
            {canConfigBranches && (
              <Link to="/admin/branches" className="rounded-[9px] border border-gray-200 bg-white px-4 py-2.5 text-[14px] font-semibold text-gray-600 hover:bg-gray-50 dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200">
                Configure Branch Radius
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Filters row */}
      <div className="mb-4 flex flex-wrap items-center gap-2.5 rounded-[14px] border border-gray-200 bg-white px-3.5 py-2.5 shadow-sm dark:border-slate-700 dark:bg-slate-800">
        {canFilterSearch && <div className="flex basis-full items-center gap-2 rounded-[10px] border-[1.5px] border-gray-100 bg-gray-50 px-3 dark:border-slate-600 dark:bg-slate-700 lg:min-w-[200px] lg:flex-1 lg:basis-0">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" className="text-gray-400">
            <circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="14" y2="14" />
          </svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search order #, customer"
            className="flex-1 border-none bg-transparent py-3 text-[15px] text-gray-800 outline-none dark:text-slate-100"
          />
        </div>}
        {canFilterBranch && <select value={branchId} onChange={(e) => setFilter('branch_id', e.target.value)} className={selectCls} aria-label="Branch">
          <option value="">All branches</option>
          {(branches ?? []).map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </select>}
        {canFilterBrand && <select value={brandId} onChange={(e) => setFilter('brand_id', e.target.value)} className={selectCls} aria-label="Brand">
          <option value="">All brands</option>
          {(brands ?? []).map((b) => <option key={b.id} value={String(b.id)}>{b.name}</option>)}
        </select>}
        {canFilterOrderType && <select value={orderType} onChange={(e) => setFilter('order_type', e.target.value)} className={selectCls} aria-label="Order type">
          <option value="">All types</option>
          <option value="delivery">Delivery</option>
          <option value="dine_in">Dine in</option>
          <option value="takeaway">Takeaway</option>
        </select>}
        {canFilterSource && <select value={source} onChange={(e) => setFilter('source', e.target.value)} className={selectCls} aria-label="Source">
          <option value="">All sources</option>
          {ORDER_SOURCES.map((s) => <option key={s} value={s}>{ORDER_SOURCE_LABEL[s]}</option>)}
        </select>}
        {canFilterPayment && <select value={paymentMethod} onChange={(e) => setFilter('payment_method', e.target.value)} className={selectCls} aria-label="Payment type">
          <option value="">All payments</option>
          <option value="cash">Cash</option>
          <option value="card">Card</option>
          <option value="online_transfer">Online transfer</option>
          <option value="cod">COD</option>
        </select>}
        {canFilterDiscount && <select value={discount} onChange={(e) => setFilter('discount', e.target.value)} className={selectCls} aria-label="Discount">
          <option value="">All discounts</option>
          <option value="any">Discounted only</option>
          <option value="none">Full price only</option>
          {DISCOUNT_KINDS.map((k) => <option key={k.filter} value={k.filter}>{k.long}</option>)}
        </select>}
        <input type="date" min={minDate} value={dateFrom} onChange={(e) => setFilter('date_from', e.target.value)} className={selectCls} aria-label="Date from" />
        <input type="date" min={minDate} value={dateTo} onChange={(e) => setFilter('date_to', e.target.value)} className={selectCls} aria-label="Date to" />
        <button
          onClick={() => {
            const t = localDateYYYYMMDD();
            setSearch('');
            setSearchParams({ date_from: t, date_to: t });
          }}
          className="whitespace-nowrap rounded-[10px] bg-red-50 px-4 py-3 text-[14.5px] font-bold text-red-600 hover:bg-red-100 dark:bg-red-900/30 dark:text-red-300"
        >
          Clear
        </button>
      </div>

      {/* Status tiles */}
      {canFilterStatus && <div className="mb-5 flex flex-wrap gap-2">
        {tiles.map((t) => {
          const active = status === t.key || (t.key === '' && status === '');
          const isAlert = 'alert' in t && t.alert;
          return (
            <button
              key={t.key || 'all'}
              onClick={() => setFilter('status', t.key)}
              className={`flex items-center gap-2.5 rounded-xl border-[1.5px] px-4 py-3 transition-colors ${
                active
                  ? isAlert
                    ? 'border-red-600 bg-red-50 dark:bg-red-900/30'
                    : 'border-gray-400 bg-gray-100 dark:border-slate-400 dark:bg-slate-700'
                  : isAlert
                    ? 'border-red-200 bg-red-50/40 hover:border-red-300 dark:border-red-900 dark:bg-red-900/10'
                    : 'border-gray-200 bg-white hover:border-gray-300 dark:border-slate-600 dark:bg-slate-800'
              }`}
            >
              <span className={`h-2.5 w-2.5 flex-none rounded-full ${t.dot}`} />
              <span className={`text-[14.5px] font-semibold ${isAlert ? 'text-red-700 dark:text-red-300' : active ? 'text-gray-800 dark:text-slate-100' : 'text-gray-500 dark:text-slate-400'}`}>
                {t.label}
              </span>
              <span className={`text-[15px] font-extrabold tabular-nums ${isAlert ? 'text-red-600' : 'text-gray-800 dark:text-slate-100'}`}>{t.n}</span>
            </button>
          );
        })}
      </div>}

      {/* Table: data grid on xl+, stacked cards below. While a filter/page
          change is fetching, the previous results stay mounted and a soft
          veil fades in over them (see useResultsRefreshing — background polls stay silent). */}
      <FetchingOverlay active={ordersRefreshing} label="Updating orders…" className="rounded-2xl">
      <div ref={setTableEl} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-[0_10px_30px_rgba(15,23,42,.05)] dark:border-slate-700 dark:bg-slate-800">
        {/* Wide enough for all 13 columns: data grid. overflow-x-auto is kept as a
            backstop only — at this width nothing should actually need to scroll. */}
        <div className={showGrid ? 'block' : 'hidden'}>
          <div className="overflow-x-auto">
            <div style={{ minWidth: ORDERS_GRID_MIN_PX }}>
              {/* Head */}
              <div
                style={{ gridTemplateColumns: ordersGridTemplate, minWidth: ORDERS_GRID_MIN_PX }}
                className="grid gap-2.5 border-b border-l-[3px] border-b-gray-100 border-l-transparent bg-gray-50/80 py-3 pl-4 pr-5 dark:border-b-slate-700 dark:bg-slate-900/40"
              >
                <span className={cellHead}>#</span>
                <span className={cellHead}>Type</span>
                <span className={cellHead}>Order</span>
                <span className={cellHead}>Customer</span>
                <span className={cellHead}>Source</span>
                <span className={`${cellHead} text-center`}>Items</span>
                <span className={cellHead}>Placed</span>
                <span className={`${cellHead} text-right`}>Total</span>
                <span className={`${cellHead} text-right`}>Discount</span>
                <span className={cellHead}>Payment</span>
                <span className={cellHead}>Kitchen</span>
                <span className={cellHead}>Delivery</span>
                <span className={cellHead}>Rider</span>
                <span className={`${cellHead} text-right`}>Actions</span>
              </div>

              {displayGroups.length === 0 ? (
                <p className="py-14 text-center text-gray-500 dark:text-slate-400">No orders found.</p>
              ) : (
                displayGroups.map(({ orderGroupId: gid, orders: groupOrders }) => {
                  const isGroup = !!gid && groupOrders.length > 1;
                  if (!isGroup) {
                    return renderRow(groupOrders[0], { showPerOrderRiderButton: true });
                  }
                  const g = groupMetaFor(groupOrders);
                  return (
                    <div key={gid}>
                      {/* Group band: one web checkout split into per-brand orders */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-l-[3px] border-b-gray-100 border-l-violet-500 bg-violet-50/50 py-2.5 pl-4 pr-5 dark:border-b-slate-700 dark:bg-violet-900/10">
                        {groupBandContent(gid!, groupOrders, g)}
                      </div>
                      {groupOrders.map((o) => renderRow(o, { showPerOrderRiderButton: !g.groupRider }))}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </div>

        {/* Narrower than the full table — phone, tablet, or a laptop with the
            sidebar expanded. Same fields, stacked, no sideways scroll. */}
        <div className={showGrid ? 'hidden' : 'block'}>
          {displayGroups.length === 0 ? (
            <p className="py-14 text-center text-gray-500 dark:text-slate-400">No orders found.</p>
          ) : (
            <div
              className="grid gap-3 p-3"
              style={{ gridTemplateColumns: `repeat(${cardColumns}, minmax(0, 1fr))` }}
            >
              {displayGroups.map(({ orderGroupId: gid, orders: groupOrders }) => {
                const isGroup = !!gid && groupOrders.length > 1;
                if (!isGroup) {
                  return renderCard(groupOrders[0], { showPerOrderRiderButton: true });
                }
                const g = groupMetaFor(groupOrders);
                return (
                  <div key={gid} style={{ gridColumn: `span ${cardColumns}` }} className="rounded-xl border border-violet-200 bg-violet-50/40 p-2.5 dark:border-violet-900 dark:bg-violet-900/10">
                    <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2 px-1">
                      {groupBandContent(gid!, groupOrders, g)}
                    </div>
                    <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                      {groupOrders.map((o) => renderCard(o, { showPerOrderRiderButton: !g.groupRider }))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer (both layouts) */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-gray-100 bg-gray-50/80 px-5 py-3 dark:border-slate-700 dark:bg-slate-900/40">
          <span className="text-[14px] font-bold text-gray-500 dark:text-slate-400">
            {visibleOrders.length} on this page · {totalCount} total
          </span>
          {!hideOrderTotals && (
          <span className="text-[14px] text-gray-400 dark:text-slate-500">
            Page value
            <span className="ml-2 text-[17px] font-black tabular-nums text-gray-800 dark:text-slate-100">{formatCurrency(visibleTotal)}</span>
          </span>
          )}
        </div>
      </div>
      </FetchingOverlay>

      <div className="mt-3">
        <PaginationBar
          totalCount={totalCount}
          page={ordersPage}
          pageSize={pageSize}
          onPageChange={setOrdersPage}
          itemLabel="orders"
          pageSizeOptions={ORDERS_PAGE_SIZE_OPTIONS}
          onPageSizeChange={(n) => {
            setPageSize(n);
            setOrdersPage(1);
          }}
        />
      </div>

      {/* Kitchen-status popover */}
      {statusMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setStatusMenu(null)} />
          <div
            role="menu"
            aria-label={`Change status for order #${statusMenu.orderNumber}`}
            className="fixed z-50 w-[190px] overflow-hidden rounded-xl border border-gray-100 bg-white p-1.5 shadow-[0_18px_44px_rgba(15,23,42,.18)] dark:border-slate-600 dark:bg-slate-800"
            style={{
              left: statusMenu.x,
              top: statusMenu.openUp ? undefined : statusMenu.y,
              bottom: statusMenu.openUp ? window.innerHeight - statusMenu.y : undefined,
            }}
          >
            <div className="px-2.5 pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-[.08em] text-gray-400 dark:text-slate-500">
              Kitchen status
            </div>
            {selectableStatuses(Object.keys(ORDER_STATUS_LABELS), noCancel).map((value) => {
              const label = ORDER_STATUS_LABELS[value];
              const m = STATUS_META[value] ?? STATUS_META.placed;
              const isCurrent = statusMenu.current === value;
              return (
                <button
                  key={value}
                  role="menuitem"
                  onClick={() => {
                    setStatusMenu(null);
                    if (!isCurrent) updateStatusMutation.mutate({ id: statusMenu.orderId, status: value });
                  }}
                  className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13.5px] font-semibold transition-colors ${
                    isCurrent
                      ? `${m.bg} ${m.color}`
                      : 'text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-700'
                  }`}
                >
                  <span className={`h-2 w-2 flex-none rounded-full ${m.dot}`} />
                  <span className="flex-1">{label}</span>
                  {isCurrent && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <path d="M3 8.5l3.5 3.5L13 5" />
                    </svg>
                  )}
                </button>
              );
            })}
          </div>
        </>
      )}

      <CustomerInvoiceModal
        isOpen={!!customerInvoiceGroupId || !!customerInvoiceOrderId}
        onClose={() => {
          setCustomerInvoiceGroupId(null);
          setCustomerInvoiceOrderId(null);
        }}
        orderGroupId={customerInvoiceGroupId}
        orderId={customerInvoiceOrderId}
      />

      <AssignRiderModal
        isOpen={riderModalOrderId != null || riderModalGroupId != null}
        onClose={closeRiderModal}
        title={
          riderModalGroupId
            ? (riderModalIsChange ? 'Change rider for group' : 'Assign rider to group')
            : (riderModalIsChange ? 'Change rider' : 'Assign rider')
        }
        subject={
          riderModalGroupId
            ? `Group ${riderModalGroupId.slice(0, 8)}… (all orders in this group)`
            : `Order #${orders.find((o) => o.id === riderModalOrderId)?.order_number ?? riderModalOrderId}`
        }
        confirmLabel={riderModalIsChange ? 'Change' : 'Assign'}
        brandId={riderModalBrandId}
        brandName={riderModalBrandName}
        orderId={riderModalOrderId}
        selectedRiderId={selectedRiderId}
        onSelectRider={setSelectedRiderId}
        isPending={assignRiderMutation.isPending}
        onConfirm={() => {
          if (selectedRiderId != null) {
            assignRiderMutation.mutate({
              orderId: riderModalOrderId ?? undefined,
              orderGroupId: riderModalGroupId ?? undefined,
              riderId: selectedRiderId,
              isChange: riderModalIsChange,
              isGroup: riderModalGroupId != null,
            });
          }
        }}
      />
    </div>
  );
};

export default Orders;
