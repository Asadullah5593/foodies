import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import apiClient from '../../utils/apiClient';
import { adminService } from '../../services/api/adminService';
import { Shift, Branch, Brand } from '../../types';
import { useAuth } from '../../contexts/AuthContext';
import Loader from '../../components/Loader';
import FetchingOverlay from '../../components/FetchingOverlay';
import { printContent } from '../../utils/print';
import Button from '../../components/Button';
import { useHasPermission } from '../../hooks/useHasPermission';
import SearchableSelect from '../../components/SearchableSelect';
import Modal from '../../components/Modal';
import { useSensitivePageView } from '../../hooks/useSensitivePageView';
import RecordHistoryLink from '../../components/RecordHistoryLink';
import { useResultsRefreshing } from '../../components/useResultsRefreshing';
import { isEntityInactive } from '../../utils/entityStatus';

/* ------------------------------------------------------------- helpers --- */

/** Spec format for this page: Rs. 1,234.56 (the global util prints no separators). */
const fmtMoney = (n: number | null | undefined): string =>
  `Rs. ${Number(n ?? 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** A shift's business date = the LOCAL calendar day it was opened. */
const businessDate = (iso: string): string => {
  const d = new Date(iso);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const todayYMD = (): string => businessDate(new Date().toISOString());

/** "2h 41m" between two instants (open shifts run to now). */
const durationText = (openedAt: string, closedAt?: string | null): string => {
  const ms = (closedAt ? new Date(closedAt).getTime() : Date.now()) - new Date(openedAt).getTime();
  const mins = Math.max(0, Math.floor(ms / 60000));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

/** Brand chip palette from the design; unknown brands get the neutral pair. */
const BRAND_CHIP: Record<string, { c: string; bg: string }> = {
  fireaway: { c: '#DC2A2A', bg: '#FCEEEE' },
  'wok & go': { c: '#B45309', bg: '#FFF3E0' },
  'peperi. co': { c: '#7C3AED', bg: '#F1EAFB' },
  'peperi co': { c: '#7C3AED', bg: '#F1EAFB' },
};
const brandChip = (name?: string | null) =>
  BRAND_CHIP[(name ?? '').trim().toLowerCase()] ?? { c: '#5A6473', bg: '#EEF0F3' };

/**
 * Cash handed out of the till mid-shift (voided entries already excluded
 * server-side). Absent on payloads that predate cash-outs ⇒ nothing was taken.
 */
export const cashOutTotal = (s: Shift): number => Number(s.cash_out_total ?? 0);

/**
 * What the drawer should hold: opening float + cash sales − cash taken out.
 *
 * The server is the source of truth (it derives this for open shifts and
 * freezes it at close, net of cash-outs); the local sum is only a fallback for
 * a payload that predates the field. Re-deriving it here is how this page used
 * to drift from the backend — don't reintroduce that.
 */
export const expectedInDrawer = (s: Shift): number =>
  s.expected_cash != null
    ? Number(s.expected_cash)
    : Number(s.opening_cash) + Number(s.cash_collected ?? 0) - cashOutTotal(s);

/**
 * Drawer variance: counted − expected. Server-computed where available.
 * Null until the drawer has been counted (open shifts).
 */
export const drawerVariance = (s: Shift): number | null => {
  if (s.status !== 'closed' || s.actual_cash == null) return null;
  return s.difference != null
    ? Number(s.difference)
    : Number(s.actual_cash) - expectedInDrawer(s);
};

/** Total takings: drawer expectation + card + online transfer (the latter two never reach the till). */
export const expectedTotal = (s: Shift): number =>
  expectedInDrawer(s) + Number(s.card_collected ?? 0) + Number(s.online_transfer_collected ?? 0);

/** Payment chip colors for the close-modal order rows: cash teal, card/mixed blue. */
const payChip = (method: string | null | undefined) => {
  const m = (method ?? '').toLowerCase();
  if (!m) return { bg: '#EEF0F3', c: '#6B7280', label: '—' };
  const label = m
    .split(' + ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' + ');
  return m === 'cash' ? { bg: '#E6F4F1', c: '#0F766E', label } : { bg: '#EAF1FF', c: '#2563EB', label };
};

/* ---------------------------------------------------------------- icons --- */

const I = {
  clock: (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="9" cy="9" r="6.5" /><path d="M9 5.5V9l2.5 1.5" />
    </svg>
  ),
  money: (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 2.5v13M11.7 5.2A2.6 2.6 0 0 0 9.3 4H8a2.2 2.2 0 0 0 0 4.4h2a2.2 2.2 0 0 1 0 4.4H8a2.6 2.6 0 0 1-2.4-1.2" />
    </svg>
  ),
  cash: (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <rect x="2" y="4.5" width="14" height="9" rx="2" /><circle cx="9" cy="9" r="2" />
    </svg>
  ),
  check: (
    <svg width="16" height="16" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,9.5 7.5,13 14,5" />
    </svg>
  ),
  pin: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9AA1AD" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 1.5c2.8 0 5 2.1 5 4.8 0 3.2-5 8.2-5 8.2S3 9.5 3 6.3C3 3.6 5.2 1.5 8 1.5z" /><circle cx="8" cy="6.2" r="1.6" />
    </svg>
  ),
  smallClock: (
    <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="#9AA1AD" strokeWidth={1.6}>
      <circle cx="8" cy="8" r="6" /><path d="M8 5v3l2 1.4" />
    </svg>
  ),
  search: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="#9AA1AD" strokeWidth={1.7} strokeLinecap="round">
      <circle cx="7" cy="7" r="4.5" /><line x1="10.5" y1="10.5" x2="14" y2="14" />
    </svg>
  ),
  calendar: (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#9AA1AD" strokeWidth={1.6}>
      <rect x="2.5" y="3.5" width="11" height="10" rx="1.5" /><line x1="2.5" y1="6.5" x2="13.5" y2="6.5" /><line x1="5.5" y1="2" x2="5.5" y2="5" /><line x1="10.5" y1="2" x2="10.5" y2="5" />
    </svg>
  ),
  x: (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
      <line x1="4" y1="4" x2="12" y2="12" /><line x1="12" y1="4" x2="4" y2="12" />
    </svg>
  ),
  bigClock: (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="9" /><path d="M12 7v5l3.5 2" />
    </svg>
  ),
  varCheck: (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <polyline points="4,10.5 8.5,15 16,5.5" />
    </svg>
  ),
  varUp: (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 16V4M5 9l5-5 5 5" />
    </svg>
  ),
  varDown: (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M10 4v12M5 11l5 5 5-5" />
    </svg>
  ),
  varClock: (
    <svg width="17" height="17" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="10" cy="10" r="7" /><path d="M10 6v4l2.5 1.5" />
    </svg>
  ),
};

/** Status pill (Open green / Closed grey), shared by cards and the modal. */
const StatusPill: React.FC<{ open: boolean }> = ({ open }) => (
  <span
    className="inline-flex items-center gap-1.5 rounded-full px-[11px] py-1 text-[11px] font-extrabold uppercase tracking-[.04em]"
    style={{ background: open ? '#E7F7EE' : '#EEF0F3', color: open ? '#0F9D58' : '#6B7280' }}
  >
    <span className="h-[7px] w-[7px] rounded-full" style={{ background: open ? '#2FB86B' : '#B6BCC6' }} />
    {open ? 'Open' : 'Closed'}
  </span>
);

/* ------------------------------------------------------------ component --- */

const Shifts: React.FC = () => {
  // Opening this screen is itself worth recording — see the hook.
  useSensitivePageView('shifts');
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const today = todayYMD();

  // Filters (mock semantics): date range defaulting to today, status tabs,
  // branch select and free-text search — all combined as AND, client-side.
  const [search, setSearch] = useState('');
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(today);
  const [branchFilter, setBranchFilter] = useState('');
  const [statusTab, setStatusTab] = useState<'all' | 'open' | 'closed'>('all');

  const [showOpenForm, setShowOpenForm] = useState(false);
  const [showCloseForm, setShowCloseForm] = useState(false);
  const [detailShiftId, setDetailShiftId] = useState<number | null>(null);
  const [selectedShift, setSelectedShift] = useState<Shift | null>(null);
  const [formData, setFormData] = useState({ branch_id: '', brand_id: '', opening_cash: '', notes: '' });
  const [closeFormData, setCloseFormData] = useState({ actual_cash: '', notes: '' });
  const [cashOutForm, setCashOutForm] = useState({ amount: '', note: '' });

  // Open-shift durations tick along once a minute.
  const [, setNowTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setNowTick((n) => n + 1), 60_000);
    return () => clearInterval(t);
  }, []);

  // Custom modals (detail z-50, close z-60): Escape closes the top-most one,
  // and the page behind stays put.
  useEffect(() => {
    if (detailShiftId == null && !showCloseForm) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (showCloseForm) setShowCloseForm(false);
      else setDetailShiftId(null);
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [detailShiftId, showCloseForm]);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const response = await apiClient.get<Branch[]>('/admin/branches');
      return response.data;
    },
  });

  // Brands (server already filters to the user's own brand when brand-locked)
  const { data: brands } = useQuery({
    queryKey: ['brands'],
    queryFn: async () => {
      const response = await apiClient.get<Brand[]>('/admin/brands');
      return response.data;
    },
  });

  // Shifts are opened by brand staff; shifts:override holders (owner/admin,
  // managers) can also open — for any brand at the branch — and close shifts
  // opened by OTHER users. Without the override, closing is opener-only (the
  // server enforces both; these flags only decide what to show).
  // Super admins pass every useHasPermission check but the server rejects
  // both shift POSTs without a tenant context — don't offer dead-end buttons.
  const isTenantStaff = !user?.is_super_admin;
  const hasShiftsOpen = useHasPermission('shifts:open');
  const hasShiftOverride = useHasPermission('shifts:override');
  const canOpenShift =
    isTenantStaff && hasShiftsOpen && (user?.allowed_brand_ids != null || hasShiftOverride);
  const hasShiftsClose = useHasPermission('shifts:close');
  // Recording/voiding a cash-out is admin-held; everyone else who can see the
  // shift still sees the entries, read-only.
  const canCashOut = isTenantStaff && useHasPermission('shifts:cash-out');
  const canCloseShift = (s: { user_id?: number | null }) =>
    isTenantStaff && hasShiftsClose && (hasShiftOverride || s.user_id === user?.id);

  // When there is only one branch/brand to choose from, pre-select it and show
  // it read-only — no point making the user pick the only option.
  const singleBranch = (branches?.length ?? 0) === 1 ? branches![0] : null;
  const singleBrand = (brands?.length ?? 0) === 1 ? brands![0] : null;

  useEffect(() => {
    if (!showOpenForm) return;
    if (singleBranch) {
      setFormData((p) => (p.branch_id ? p : { ...p, branch_id: String(singleBranch.id) }));
    }
    if (singleBrand) {
      setFormData((p) => (p.brand_id ? p : { ...p, brand_id: String(singleBrand.id) }));
    }
  }, [showOpenForm, singleBranch, singleBrand]);

  // The server prunes to the selected range (sent as LOCAL-midnight instants,
  // so its window matches the client's business-date math exactly) and always
  // returns open shifts; status / branch / search still filter client-side.
  // keepPreviousData: changing dates swaps data in place, no full-page loader.
  const shiftsKey = ['shifts', fromDate, toDate];
  const { data: shifts, isLoading, isFetching } = useQuery({
    queryKey: shiftsKey,
    queryFn: () =>
      adminService.getShifts(undefined, undefined, undefined, {
        from: new Date(`${fromDate}T00:00:00`).toISOString(),
        to: new Date(`${toDate}T23:59:59.999`).toISOString(),
      }),
    placeholderData: keepPreviousData,
  });
  const shiftsRefreshing = useResultsRefreshing(shiftsKey, isFetching);

  // Detect a shift already open for the branch + brand chosen in the Open
  // form — one open shift per brand per branch.
  const openFormBranchId = formData.branch_id ? parseInt(formData.branch_id, 10) : null;
  const openFormBrandId = formData.brand_id ? parseInt(formData.brand_id, 10) : null;
  // Only offer brands actually served at the chosen branch (branch_brands) —
  // the server rejects an unlinked pair, so don't let the form build one.
  const openFormBranch = (branches ?? []).find((b) => b.id === openFormBranchId) ?? null;
  const openFormBrands = (brands ?? []).filter(
    (b) => !openFormBranch || (openFormBranch.brand_ids ?? []).includes(b.id),
  );
  const { data: openShiftsForBranch } = useQuery({
    queryKey: ['shifts', 'open-for-branch', openFormBranchId, openFormBrandId],
    queryFn: () => adminService.getShifts(openFormBranchId!, 'open', openFormBrandId ?? undefined),
    enabled: showOpenForm && openFormBranchId != null && openFormBrandId != null,
  });
  const existingOpenShift = (openShiftsForBranch ?? [])[0] ?? null;

  // Fetch shift detail for the modal (includes cash/card collected).
  const { data: shiftDetail, isError: shiftDetailError } = useQuery({
    queryKey: ['shift-detail', detailShiftId],
    queryFn: () => adminService.getShift(detailShiftId!),
    enabled: !!detailShiftId,
  });

  // Cash-outs of the shift on screen (detail modal, or the one being closed).
  // Readable by anyone who can see the shift; adding needs shifts:cash-out.
  const cashOutShiftId = detailShiftId ?? (showCloseForm ? selectedShift?.id ?? null : null);
  const { data: cashOutData } = useQuery({
    queryKey: ['shift-cash-outs', cashOutShiftId],
    queryFn: () => adminService.getShiftCashOuts(cashOutShiftId!),
    enabled: cashOutShiftId != null,
  });

  // Completed orders for the shift being closed (closing-clearance review).
  const { data: shiftOrders, isLoading: shiftOrdersLoading } = useQuery({
    queryKey: ['shift-orders', selectedShift?.id],
    queryFn: () => adminService.getShiftOrders(selectedShift!.id),
    enabled: showCloseForm && !!selectedShift,
  });

  // Orders punched during the shift that are NOT completed/cancelled yet — the
  // shift cannot close while any remain (server enforces it too). Polled while
  // the modal is open so orders completed from KDS/POS drop off live.
  const { data: pendingOrders, isLoading: pendingLoading } = useQuery({
    queryKey: ['shift-pending-orders', selectedShift?.id],
    queryFn: () => adminService.getShiftPendingOrders(selectedShift!.id),
    enabled: showCloseForm && !!selectedShift,
    refetchInterval: showCloseForm ? 5000 : false,
  });
  const pendingCount = pendingOrders?.pending_count ?? 0;

  const createMutation = useMutation({
    mutationFn: adminService.createShift,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      setShowOpenForm(false);
      setFormData({ branch_id: '', brand_id: '', opening_cash: '', notes: '' });
      toast.success('Shift opened successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to open shift');
    },
  });

  /**
   * Recording a hand-over refreshes the cash-out list AND the shift queries —
   * expected cash is derived from these rows, and the close modal reads its
   * figure from the ['shifts'] list, so invalidating only the detail would
   * leave a stale Expected cash on screen.
   */
  const invalidateCashSurfaces = () => {
    queryClient.invalidateQueries({ queryKey: ['shift-cash-outs'] });
    queryClient.invalidateQueries({ queryKey: ['shifts'] });
    queryClient.invalidateQueries({ queryKey: ['shift-detail'] });
  };

  const addCashOutMutation = useMutation({
    mutationFn: ({ id, amount, note }: { id: number; amount: number; note?: string }) =>
      adminService.addShiftCashOut(id, amount, note),
    onSuccess: () => {
      invalidateCashSurfaces();
      setCashOutForm({ amount: '', note: '' });
      toast.success('Cash-out recorded');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to record cash-out');
    },
  });

  const voidCashOutMutation = useMutation({
    mutationFn: ({ id, cashOutId }: { id: number; cashOutId: number }) =>
      adminService.voidShiftCashOut(id, cashOutId),
    onSuccess: () => {
      invalidateCashSurfaces();
      toast.success('Cash-out voided');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to void cash-out');
    },
  });

  const closeMutation = useMutation({
    mutationFn: ({
      id,
      actualCash,
      notes,
    }: {
      id: number;
      actualCash: number;
      notes?: string;
    }) => adminService.closeShift(id, actualCash, notes),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      queryClient.invalidateQueries({ queryKey: ['shift-detail'] });
      setShowCloseForm(false);
      setSelectedShift(null);
      setCloseFormData({ actual_cash: '', notes: '' });
      toast.success('Shift closed successfully!');
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to close shift');
    },
  });

  const completeOrderMutation = useMutation({
    mutationFn: (orderId: number) => adminService.updateOrderStatus(orderId, 'completed'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['shift-pending-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shift-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
    },
    onError: (error: any) => {
      toast.error(error.response?.data?.message || 'Failed to complete order');
    },
  });

  const completeAllMutation = useMutation({
    // Sequential on purpose: each completion also bumps the shift's expected
    // cash server-side; a burst of parallel PUTs buys nothing here.
    mutationFn: async (orderIds: number[]) => {
      for (const id of orderIds) await adminService.updateOrderStatus(id, 'completed');
      return orderIds.length;
    },
    onSuccess: (n) => {
      queryClient.invalidateQueries({ queryKey: ['shift-pending-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shift-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.success(`${n} order${n === 1 ? '' : 's'} marked completed`);
    },
    onError: (error: any) => {
      // Partial progress is possible — refresh so the list shows what's left.
      queryClient.invalidateQueries({ queryKey: ['shift-pending-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shift-orders'] });
      queryClient.invalidateQueries({ queryKey: ['shifts'] });
      toast.error(error.response?.data?.message || 'Failed to complete all orders');
    },
  });

  const handleOpenShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.branch_id) {
      toast.error('Select a branch');
      return;
    }
    if (!formData.brand_id) {
      toast.error('Select a brand');
      return;
    }
    if (existingOpenShift) {
      toast.error('A shift is already open for this brand at this branch. Use the open shift instead.');
      return;
    }
    createMutation.mutate({
      branch_id: parseInt(formData.branch_id),
      brand_id: parseInt(formData.brand_id),
      opening_cash: parseFloat(formData.opening_cash),
      notes: formData.notes || undefined,
    });
  };

  const handleCloseShift = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedShift) return;
    if (pendingLoading || pendingCount > 0) {
      toast.error('Complete all open orders of this shift before closing it.');
      return;
    }
    closeMutation.mutate({
      id: selectedShift.id,
      actualCash: parseFloat(closeFormData.actual_cash),
      notes: closeFormData.notes || undefined,
    });
  };

  const startClose = (shift: Shift) => {
    setSelectedShift(shift);
    setCloseFormData({ actual_cash: '', notes: '' });
    setShowOpenForm(false);
    setDetailShiftId(null);
    setShowCloseForm(true);
  };

  /* ------------------------------------------------------- derived data --- */

  const allShifts = shifts ?? [];
  const isTodaySelected = fromDate === today && toDate === today;

  const inRange = (s: Shift) => {
    const d = businessDate(s.opened_at);
    return d >= fromDate && d <= toDate;
  };
  // Open shifts are ALWAYS shown regardless of the date range: this page is the
  // only place a drawer can be closed, and a shift opened before midnight that
  // is still running (routine for 1–2 AM closers) must not vanish from the view
  // or the stats the moment the calendar flips.
  const rangeShifts = useMemo(
    () => allShifts.filter((s) => s.status === 'open' || inRange(s)),
    [allShifts, fromDate, toDate],
  );

  const openInRange = rangeShifts.filter((s) => s.status === 'open');
  const closedInRange = rangeShifts.filter((s) => s.status === 'closed');

  const stats = [
    {
      label: 'Open shifts',
      value: String(openInRange.length),
      sub: `across ${new Set(openInRange.map((s) => s.brand?.name ?? `#${s.brand_id ?? 'legacy'}`)).size} brands`,
      icon: I.clock,
      iconBg: '#E7F7EE',
      iconColor: '#0F9D58',
    },
    {
      label: 'Expected in drawers',
      value: fmtMoney(openInRange.reduce((a, s) => a + expectedTotal(s), 0)),
      sub: 'open shifts combined',
      icon: I.money,
      iconBg: '#FCEEEE',
      iconColor: '#DC2A2A',
    },
    {
      label: 'Cash sales',
      value: fmtMoney(rangeShifts.reduce((a, s) => a + Number(s.cash_collected ?? 0), 0)),
      sub: isTodaySelected ? 'today' : 'selected day',
      icon: I.cash,
      iconBg: '#E6F4F1',
      iconColor: '#0F766E',
    },
    {
      label: 'Closed',
      value: String(closedInRange.length),
      sub: 'reconciled',
      icon: I.check,
      iconBg: '#EAF1FF',
      iconColor: '#2563EB',
    },
  ];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rangeShifts.filter((s) => {
      if (statusTab !== 'all' && s.status !== statusTab) return false;
      if (branchFilter && String(s.branch_id) !== branchFilter) return false;
      if (q) {
        const hay = `${s.shift_number} ${s.brand?.name ?? ''} ${s.user?.name ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rangeShifts, statusTab, branchFilter, search]);

  /* ------------------------------------------------------------- print --- */

  /** X-report (open snapshot) / Z-report (closed final) from what's on screen. */
  const printReport = (s: Shift, kind: 'X' | 'Z') => {
    const esc = (x: unknown) =>
      String(x ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const v = drawerVariance(s);
    const row = (k: string, val: string) =>
      `<tr><td>${k}</td><td class="text-right">${val}</td></tr>`;
    const html = `
      <h1>${kind}-report — ${esc(s.shift_number)}</h1>
      <p class="meta">${esc(s.brand?.name ?? '')} · ${esc(s.branch?.name ?? '')} · ${s.status === 'open' ? 'Open (snapshot)' : 'Closed'}</p>
      <table>
        ${row('Opened by', `${esc(s.user?.name ?? '—')} — ${new Date(s.opened_at).toLocaleString()}`)}
        ${s.closed_at ? row('Closed by', `${esc(s.closer?.name ?? '—')} — ${new Date(s.closed_at).toLocaleString()}`) : ''}
        ${row('Opening float', fmtMoney(s.opening_cash))}
        ${row('Cash sales', fmtMoney(s.cash_collected ?? 0))}
        ${row('Card sales', fmtMoney(s.card_collected ?? 0))}
        ${row('Online transfer sales', fmtMoney(s.online_transfer_collected ?? 0))}
        ${row('Expected total', fmtMoney(expectedTotal(s)))}
        ${cashOutTotal(s) > 0 ? row('Cash taken out', `− ${fmtMoney(cashOutTotal(s))}`) : ''}
        ${row('Expected in drawer', fmtMoney(expectedInDrawer(s)))}
        ${row('Counted cash', s.actual_cash != null ? fmtMoney(s.actual_cash) : 'Not counted')}
        ${v != null ? row('Variance', `${v > 0 ? '+' : ''}${fmtMoney(v)}`) : ''}
      </table>`;
    printContent(html, `${kind}-report ${s.shift_number}`, '', {
      subject: kind === 'Z' ? 'z-report' : 'shift-report',
      entityId: s.id,
      label: `${kind}-report ${s.shift_number}`,
    });
  };

  /* ------------------------------------------------------------ render --- */

  const isSubmitting = createMutation.isPending || closeMutation.isPending;
  if (isLoading || isSubmitting) {
    return <Loader fullScreen text={isSubmitting ? 'Saving...' : 'Loading shifts...'} />;
  }

  // Close modal: expected drawer cash = opening float + cash collected. The
  // orders fetch carries the freshest figure; the list row's value stands in
  // while it loads (same backend computation).
  // `selectedShift` is a snapshot taken when the modal opened and never changes
  // while it's open. Completing an order in-modal recomputes the shift's
  // expected cash server-side and invalidates the ['shifts'] list, so read the
  // live row from that (refetched) list — otherwise Expected cash stays stale
  // until the modal is closed and reopened. Falls back to the snapshot.
  const liveShift =
    (selectedShift != null ? shifts?.find((s) => s.id === selectedShift.id) : null) ??
    selectedShift;
  // Prefer the server's figure: it is already net of any cash handed out
  // mid-shift. Falls back to the local sum only if the payload predates it.
  const closeExpectedCash =
    liveShift == null
      ? null
      : liveShift.expected_cash != null
        ? Number(liveShift.expected_cash)
        : Number(liveShift.opening_cash) +
          Number(shiftOrders?.cash_collected ?? liveShift.cash_collected ?? 0) -
          cashOutTotal(liveShift);
  // Actual cash is simply what was counted in the drawer.
  const closeActualNum = parseFloat(closeFormData.actual_cash);
  // Prefer the live cash-out list; fall back to the figure on the shift row.
  const closeCashOutTotal =
    cashOutData?.total ?? (liveShift != null ? cashOutTotal(liveShift) : 0);
  const closeVariance = (() => {
    if (closeExpectedCash == null || closeFormData.actual_cash === '' || isNaN(closeActualNum)) return null;
    const diff = closeActualNum - closeExpectedCash;
    if (Math.abs(diff) < 0.005) return { text: 'Balanced', bg: '#E7F7EE', color: '#0F9D58' };
    if (diff > 0) return { text: `Over ${fmtMoney(diff)}`, bg: '#EAF1FF', color: '#2563EB' };
    return { text: `Short ${fmtMoney(Math.abs(diff))}`, bg: '#FCEEEE', color: '#C21F1F' };
  })();

  const detail = shiftDetail ?? null;
  const detailOpen = detail?.status === 'open';
  const detailVariance = detail ? drawerVariance(detail) : null;
  // Live list wins over the figure baked into the shift payload.
  const detailCashOutTotal =
    cashOutData?.total ?? (detail != null ? cashOutTotal(detail) : 0);
  const cashOutItems = cashOutData?.items ?? [];
  const varianceUi = !detail
    ? null
    : detailOpen || detailVariance == null
      ? { headline: 'Awaiting count', color: '#8A6D33', amount: '—', panelBg: '#FFF9EC', icon: I.varClock, countedTone: 'muted' as const }
      : Math.abs(detailVariance) < 0.005
        ? { headline: 'Drawer balanced', color: '#0F9D58', amount: fmtMoney(0), panelBg: '#EAF7EE', icon: I.varCheck, countedTone: 'normal' as const }
        : detailVariance > 0
          ? { headline: 'Over', color: '#2563EB', amount: `+${fmtMoney(detailVariance)}`, panelBg: '#EEF4FF', icon: I.varUp, countedTone: 'normal' as const }
          : { headline: 'Short', color: '#C21F1F', amount: `−${fmtMoney(Math.abs(detailVariance))}`, panelBg: '#FDECEC', icon: I.varDown, countedTone: 'short' as const };

  return (
    <div className="w-full px-4 sm:px-6 lg:px-8 py-6">
      {/* Header */}
      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="m-0 text-[25px] font-extrabold tracking-[-.02em] text-[#1A1D24] dark:text-slate-100">Shifts</h2>
          <p className="m-0 mt-1 text-[13.5px] text-[#8A92A0]">
            {hasShiftOverride
              ? 'Opened by brand staff — you can review the drawer and close any shift.'
              : 'Opened by brand staff — each shift is closed by the person who opened it.'}
          </p>
        </div>
        {canOpenShift ? (
          <Button onClick={() => setShowOpenForm(true)}>Open New Shift</Button>
        ) : null}
      </div>

      {/* Summary strip */}
      <div className="mb-[22px] grid grid-cols-1 gap-[14px] sm:grid-cols-2 xl:grid-cols-4">
        {stats.map((s) => (
          <div
            key={s.label}
            className="rounded-[14px] border border-[#ECEDF0] bg-white px-[17px] py-[15px] shadow-[0_6px_18px_rgba(15,23,42,.04)] dark:border-slate-700 dark:bg-slate-800"
          >
            <div className="flex items-center gap-2">
              <span
                className="flex h-7 w-7 flex-none items-center justify-center rounded-lg"
                style={{ background: s.iconBg, color: s.iconColor }}
              >
                {s.icon}
              </span>
              <span className="text-[11.5px] font-bold uppercase tracking-[.05em] text-[#9AA1AD]">{s.label}</span>
            </div>
            <div className="mt-[9px] text-[22px] font-black tabular-nums text-[#1A1D24] dark:text-slate-100">{s.value}</div>
            <div className="mt-px text-xs text-[#9AA1AD]">{s.sub}</div>
          </div>
        ))}
      </div>

      {/* Toolbar */}
      <div className="mb-[18px] flex flex-wrap items-center gap-[11px] rounded-[14px] border border-[#ECEDF0] bg-white px-[15px] py-3 shadow-[0_6px_18px_rgba(15,23,42,.04)] dark:border-slate-700 dark:bg-slate-800">
        <div className="flex min-w-[200px] flex-1 items-center gap-[9px] rounded-[10px] border-[1.5px] border-[#EEEFF2] bg-[#F6F7F9] px-3 dark:border-slate-600 dark:bg-slate-700">
          {I.search}
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search shift #, brand, staff…"
            className="flex-1 border-none bg-transparent py-2.5 text-[13.5px] text-[#1A1D24] outline-none dark:text-slate-100"
          />
        </div>
        <div className="flex items-center gap-2 rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-[11px] dark:border-slate-600 dark:bg-slate-800">
          {I.calendar}
          <input
            type="date"
            value={fromDate}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return; // cleared: keep the previous date
              setFromDate(v);
              if (v > toDate) setToDate(v);
            }}
            className="cursor-pointer border-none bg-transparent py-[9px] text-[13px] font-semibold text-[#374151] outline-none dark:text-slate-200"
          />
          <span className="text-[13px] text-[#C0C5CD]">→</span>
          <input
            type="date"
            value={toDate}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) return; // cleared: keep the previous date
              setToDate(v);
              if (v < fromDate) setFromDate(v);
            }}
            className="cursor-pointer border-none bg-transparent py-[9px] text-[13px] font-semibold text-[#374151] outline-none dark:text-slate-200"
          />
          {isTodaySelected ? (
            <span className="rounded-md bg-[#E7F7EE] px-[7px] py-0.5 text-[10.5px] font-extrabold uppercase tracking-[.04em] text-[#0F9D58]">
              Today
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setFromDate(today);
                setToDate(today);
              }}
              className="whitespace-nowrap border-none bg-transparent text-[11.5px] font-bold text-[#DC2A2A] cursor-pointer"
            >
              Today
            </button>
          )}
        </div>
        <select
          value={branchFilter}
          onChange={(e) => setBranchFilter(e.target.value)}
          className="cursor-pointer rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-[13px] py-2.5 text-[13px] text-[#374151] outline-none dark:border-slate-600 dark:bg-slate-800 dark:text-slate-200"
        >
          <option value="">All branches</option>
          {(branches ?? []).map((b) => (
            <option key={b.id} value={String(b.id)}>
              {b.name}
            </option>
          ))}
        </select>
        <div className="flex gap-[7px]">
          {(
            [
              { key: 'all', label: 'All', dot: null },
              { key: 'open', label: 'Open', dot: '#2FB86B' },
              { key: 'closed', label: 'Closed', dot: '#B6BCC6' },
            ] as const
          ).map((t) => {
            const active = statusTab === t.key;
            return (
              <button
                key={t.key}
                type="button"
                onClick={() => setStatusTab(t.key)}
                className={`inline-flex cursor-pointer items-center gap-[7px] rounded-[10px] border-[1.5px] px-[15px] py-[9px] text-[13px] font-bold ${
                  active ? '' : 'border-[#E2E5EA] text-[#4B5563] dark:border-slate-600 dark:text-slate-300'
                }`}
                style={active ? { borderColor: '#DC2A2A', background: '#FCEEEE', color: '#B5121B' } : undefined}
              >
                {t.dot && <span className="h-[7px] w-[7px] rounded-full" style={{ background: t.dot }} />}
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Shift cards. While a date-range change is fetching, the previous
          results stay mounted and a soft veil fades in over them
          (see useResultsRefreshing — background polls stay silent). */}
      <FetchingOverlay active={shiftsRefreshing} label="Updating shifts…" className="rounded-[14px]">
      {filtered.length === 0 ? (
        <div className="rounded-[14px] border border-[#ECEDF0] bg-white py-12 text-center text-sm text-[#8A92A0] shadow-[0_6px_18px_rgba(15,23,42,.04)] dark:border-slate-700 dark:bg-slate-800">
          No shifts for the selected day and filters.
        </div>
      ) : (
        <div className="flex flex-col gap-[14px]">
          {filtered.map((s) => {
            const open = s.status === 'open';
            const chip = brandChip(s.brand?.name);
            const v = drawerVariance(s);
            const varBadge =
              v == null
                ? null
                : Math.abs(v) < 0.005
                  ? { text: 'Balanced', bg: '#E7F7EE', color: '#0F9D58' }
                  : v > 0
                    ? { text: `Over ${fmtMoney(v)}`, bg: '#EAF1FF', color: '#2563EB' }
                    : { text: `Short ${fmtMoney(Math.abs(v))}`, bg: '#FCEEEE', color: '#C21F1F' };
            return (
              <div
                key={s.id}
                className="flex flex-wrap items-center gap-[18px] rounded-[14px] border border-[#ECEDF0] bg-white py-[17px] pl-[15px] pr-5 shadow-[0_6px_18px_rgba(15,23,42,.05)] dark:border-slate-700 dark:bg-slate-800"
                style={{ borderLeft: `5px solid ${open ? '#2FB86B' : '#B6BCC6'}` }}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-[11px]">
                    <span className="text-[17px] font-extrabold tabular-nums tracking-[-.01em] text-[#1A1D24] dark:text-slate-100">
                      {s.shift_number}
                    </span>
                    <StatusPill open={open} />
                    <span
                      className="rounded-[7px] px-[9px] py-[3px] text-xs font-bold"
                      style={{ background: chip.bg, color: chip.c }}
                    >
                      {s.brand?.name ?? '—'}
                    </span>
                    <span className="inline-flex items-center gap-[5px] text-[12.5px] font-semibold text-[#6B7280] dark:text-slate-400">
                      {I.pin}
                      {s.branch?.name ?? '—'}
                    </span>
                  </div>
                  <div className="mt-[9px] flex flex-wrap items-center gap-4">
                    <span className="text-[12.5px] text-[#6B7280] dark:text-slate-400">
                      <span className="text-[#9AA1AD]">Staff</span>{' '}
                      <span className="font-bold text-[#374151] dark:text-slate-200">{s.user?.name ?? '—'}</span>
                    </span>
                    <span className="text-[12.5px] text-[#6B7280] dark:text-slate-400">
                      <span className="text-[#9AA1AD]">Opening float</span>{' '}
                      <span className="font-bold tabular-nums text-[#374151] dark:text-slate-200">{fmtMoney(s.opening_cash)}</span>
                    </span>
                    <span className="text-[12.5px] text-[#6B7280] dark:text-slate-400">
                      <span className="text-[#9AA1AD]">Opened</span>{' '}
                      <span className="font-bold text-[#374151] dark:text-slate-200">{new Date(s.opened_at).toLocaleString()}</span>
                    </span>
                    <span className="inline-flex items-center gap-[5px] text-[12.5px] text-[#6B7280]">
                      {I.smallClock}
                      <span className={`font-bold ${open ? 'text-[#0F9D58]' : 'text-[#6B7280] dark:text-slate-400'}`}>
                        {open ? `Open ${durationText(s.opened_at)}` : durationText(s.opened_at, s.closed_at)}
                      </span>
                    </span>
                  </div>
                </div>
                <div className="flex-none text-right">
                  <div className="text-[10.5px] font-bold uppercase tracking-[.06em] text-[#9AA1AD]">
                    {open ? 'Expected so far' : 'Expected total'}
                  </div>
                  <div className="mt-0.5 text-lg font-black tabular-nums text-[#1A1D24] dark:text-slate-100">
                    {fmtMoney(expectedTotal(s))}
                  </div>
                  {varBadge && (
                    <span
                      className="mt-[5px] inline-block rounded-full px-[9px] py-0.5 text-[11px] font-extrabold"
                      style={{ background: varBadge.bg, color: varBadge.color }}
                    >
                      {varBadge.text}
                    </span>
                  )}
                </div>
                <div className="flex flex-none items-center gap-[9px]">
                  <button
                    type="button"
                    onClick={() => setDetailShiftId(s.id)}
                    className="cursor-pointer rounded-[10px] border-[1.5px] border-[#E2E5EA] bg-white px-[18px] py-2.5 text-[13.5px] font-bold text-[#374151] transition-colors hover:bg-[#F3F4F6] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                  >
                    View
                  </button>
                  {open && canCloseShift(s) && (
                    <button
                      type="button"
                      onClick={() => startClose(s)}
                      className="cursor-pointer rounded-[10px] border-none bg-[#DC2A2A] px-[18px] py-2.5 text-[13.5px] font-bold text-white shadow-[0_3px_8px_rgba(220,42,42,.24)] transition-colors hover:bg-[#C21F1F]"
                    >
                      Close Shift
                    </button>
                  )}
                  {open && hasShiftsClose && !canCloseShift(s) && (
                    <span
                      className="rounded-[10px] bg-[#F3F4F6] px-3 py-2 text-[12px] font-semibold text-[#8A92A0] dark:bg-slate-700 dark:text-slate-400"
                      title="Only the user who opened this shift can close it."
                    >
                      Closes by {s.user?.name ?? 'opener'}
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
      </FetchingOverlay>

      {/* ------------------------------------------------ Shift Detail modal */}
      {detailShiftId != null && (
        <div
          onClick={() => setDetailShiftId(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-[30px]"
          style={{ background: 'rgba(20,17,18,.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92vh] w-[660px] max-w-full flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_40px_90px_rgba(0,0,0,.5)] dark:bg-slate-800"
          >
            <div className="h-1.5 flex-none" style={{ background: 'linear-gradient(90deg,#EF4444,#DC2A2A 55%,#F43F5E)' }} />
            {!detail ? (
              <div className="p-10">
                {shiftDetailError ? (
                  <p className="text-center text-sm text-red-600">
                    Failed to load the shift. Close this dialog and try again.
                  </p>
                ) : (
                  <Loader text="Loading shift…" />
                )}
              </div>
            ) : (
              <>
                {/* Modal header */}
                <div className="flex flex-none items-center justify-between gap-[14px] border-b border-[#F1F2F5] px-[26px] pb-4 pt-5 dark:border-slate-700">
                  <div className="flex min-w-0 items-center gap-[13px]">
                    <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] bg-[#1A1D24] text-white">
                      {I.bigClock}
                    </span>
                    <div className="min-w-0">
                      <div className="flex items-center gap-2.5">
                        <span className="text-lg font-extrabold tabular-nums text-[#1A1D24] dark:text-slate-100">{detail.shift_number}</span>
                        <StatusPill open={detailOpen} />
                      </div>
                      <div className="mt-0.5 text-[12.5px] text-[#8A92A0]">
                        {detail.brand?.name ?? '—'} · {detail.branch?.name ?? '—'}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDetailShiftId(null)}
                    aria-label="Close"
                    className="flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-[10px] border-none bg-[#F3F4F6] text-[#6B7280] transition-colors hover:bg-[#E7E9ED] dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
                  >
                    {I.x}
                  </button>
                </div>

                {/* Modal body */}
                <div className="min-h-0 flex-1 overflow-y-auto px-[26px] pb-[26px] pt-[22px]">
                  <div className="mb-[22px] grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div className="rounded-xl border border-[#F1F2F5] bg-[#FBFBFC] px-[15px] py-[13px] dark:border-slate-700 dark:bg-slate-900/40">
                      <div className="text-[10.5px] font-bold uppercase tracking-[.05em] text-[#9AA1AD]">Opened by</div>
                      <div className="mt-1 text-sm font-bold text-[#20242C] dark:text-slate-100">{detail.user?.name ?? '—'}</div>
                      <div className="mt-px text-xs text-[#8A92A0]">{new Date(detail.opened_at).toLocaleString()}</div>
                    </div>
                    <div className="rounded-xl border border-[#F1F2F5] bg-[#FBFBFC] px-[15px] py-[13px] dark:border-slate-700 dark:bg-slate-900/40">
                      <div className="text-[10.5px] font-bold uppercase tracking-[.05em] text-[#9AA1AD]">Closed by</div>
                      <div
                        className={`mt-1 text-sm font-bold ${detail.closer ? 'text-[#20242C] dark:text-slate-100' : 'text-[#9AA1AD]'}`}
                      >
                        {/* Pre-migration closed shifts have no closer recorded. */}
                        {detail.closer?.name ?? (detail.closed_at ? '—' : 'Not closed yet')}
                      </div>
                      <div className="mt-px text-xs text-[#8A92A0]">
                        {detail.closed_at ? new Date(detail.closed_at).toLocaleString() : 'Shift in progress'}
                      </div>
                    </div>
                  </div>

                  <div className="mb-[11px] text-[11px] font-extrabold uppercase tracking-[.06em] text-[#9AA1AD]">Sales this shift</div>
                  <div className="mb-[22px] overflow-hidden rounded-[14px] border border-[#ECEDF0] dark:border-slate-700">
                    <div className="flex items-center justify-between gap-2.5 border-b border-[#F4F5F7] px-4 py-3 dark:border-slate-700">
                      <span className="inline-flex items-center gap-[9px] text-[13.5px] text-[#4B5563] dark:text-slate-300">
                        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[#E6F4F1] text-[#0F766E]">
                          {I.cash}
                        </span>
                        Cash sales
                      </span>
                      <span className="text-sm font-bold tabular-nums text-[#1A1D24] dark:text-slate-100">{fmtMoney(detail.cash_collected ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2.5 border-b border-[#F4F5F7] px-4 py-3 dark:border-slate-700">
                      <span className="inline-flex items-center gap-[9px] text-[13.5px] text-[#4B5563] dark:text-slate-300">
                        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[#EAF1FF] text-[#2563EB]">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}>
                            <rect x="2" y="4" width="12" height="8.5" rx="1.5" /><path d="M2 6.8h12" />
                          </svg>
                        </span>
                        Card sales
                      </span>
                      <span className="text-sm font-bold tabular-nums text-[#1A1D24] dark:text-slate-100">{fmtMoney(detail.card_collected ?? 0)}</span>
                    </div>
                    {/* Its own line: an online transfer is taxed like a card but
                        settles into a bank account, not the drawer or a terminal. */}
                    <div className="flex items-center justify-between gap-2.5 border-b border-[#F4F5F7] px-4 py-3 dark:border-slate-700">
                      <span className="inline-flex items-center gap-[9px] text-[13.5px] text-[#4B5563] dark:text-slate-300">
                        <span className="flex h-[26px] w-[26px] items-center justify-center rounded-[7px] bg-[#EDE9FE] text-[#7C3AED]">
                          <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.6}>
                            <path d="M3 6.5h10M3 9.5h10M6 3.5 3 6.5l3 3M10 12.5l3-3-3-3" />
                          </svg>
                        </span>
                        Online transfer
                      </span>
                      <span className="text-sm font-bold tabular-nums text-[#1A1D24] dark:text-slate-100">{fmtMoney(detail.online_transfer_collected ?? 0)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2.5 bg-[#FBFBFC] px-4 py-3.5 dark:bg-slate-900/40">
                      <span className="text-[13.5px] font-extrabold text-[#1A1D24] dark:text-slate-100">Expected total</span>
                      <span className="text-lg font-black tabular-nums text-[#1A1D24] dark:text-slate-100">{fmtMoney(expectedTotal(detail))}</span>
                    </div>
                  </div>

                  <div className="mb-[11px] text-[11px] font-extrabold uppercase tracking-[.06em] text-[#9AA1AD]">Cash drawer reconciliation</div>
                  <div className="overflow-hidden rounded-[14px] border border-[#ECEDF0] dark:border-slate-700">
                    <div className="flex items-center justify-between gap-2.5 border-b border-[#F4F5F7] px-4 py-[11px] dark:border-slate-700">
                      <span className="text-[13px] text-[#6B7280] dark:text-slate-400">Opening float</span>
                      <span className="text-[13.5px] font-semibold tabular-nums text-[#1A1D24] dark:text-slate-100">{fmtMoney(detail.opening_cash)}</span>
                    </div>
                    <div className="flex items-center justify-between gap-2.5 border-b border-[#F4F5F7] px-4 py-[11px] dark:border-slate-700">
                      <span className="text-[13px] text-[#6B7280] dark:text-slate-400">+ Cash sales</span>
                      <span className="text-[13.5px] font-semibold tabular-nums text-[#1A1D24] dark:text-slate-100">{fmtMoney(detail.cash_collected ?? 0)}</span>
                    </div>
                    {detailCashOutTotal > 0 && (
                      <div className="flex items-center justify-between gap-2.5 border-b border-[#F4F5F7] px-4 py-[11px] dark:border-slate-700">
                        <span className="text-[13px] text-[#6B7280] dark:text-slate-400">− Cash taken out</span>
                        <span className="text-[13.5px] font-semibold tabular-nums text-[#C21F1F]">
                          −{fmtMoney(detailCashOutTotal)}
                        </span>
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2.5 border-b border-[#F4F5F7] bg-[#FBFBFC] px-4 py-3 dark:border-slate-700 dark:bg-slate-900/40">
                      <span className="text-[13px] font-extrabold text-[#1A1D24] dark:text-slate-100">Expected in drawer</span>
                      <span className="text-sm font-extrabold tabular-nums text-[#1A1D24] dark:text-slate-100">
                        {fmtMoney(expectedInDrawer(detail))}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2.5 border-b border-[#F4F5F7] px-4 py-3 dark:border-slate-700">
                      <span className="text-[13px] text-[#6B7280] dark:text-slate-400">Counted cash</span>
                      <span
                        className={`text-[13.5px] font-bold tabular-nums ${
                          varianceUi?.countedTone === 'short'
                            ? 'text-[#C21F1F]'
                            : varianceUi?.countedTone === 'muted'
                              ? 'text-[#9AA1AD]'
                              : 'text-[#20242C] dark:text-slate-100'
                        }`}
                      >
                        {detail.actual_cash != null ? fmtMoney(detail.actual_cash) : 'Not counted'}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 px-4 py-[15px]" style={{ background: varianceUi?.panelBg }}>
                      <span className="inline-flex items-center gap-[9px] text-[13.5px] font-extrabold" style={{ color: varianceUi?.color }}>
                        {varianceUi?.icon}
                        {varianceUi?.headline}
                      </span>
                      <span className="text-[19px] font-black tabular-nums" style={{ color: varianceUi?.color }}>
                        {varianceUi?.amount}
                      </span>
                    </div>
                  </div>

                  {/* ---------------------------------------- cash-outs --- */}
                  <div className="mt-5">
                    <div className="mb-[11px] flex items-center justify-between">
                      <span className="text-[11px] font-extrabold uppercase tracking-[.06em] text-[#9AA1AD]">
                        Cash taken out
                      </span>
                      <span className="text-[12.5px] font-extrabold tabular-nums text-[#1A1D24] dark:text-slate-100">
                        {fmtMoney(detailCashOutTotal)}
                      </span>
                    </div>

                    {cashOutItems.length === 0 ? (
                      <p className="text-[12.5px] text-[#8A92A0]">
                        No cash has been taken out of this till.
                      </p>
                    ) : (
                      <div className="overflow-hidden rounded-[14px] border border-[#ECEDF0] dark:border-slate-700">
                        {cashOutItems.map((c) => (
                          <div
                            key={c.id}
                            className="flex items-center justify-between gap-3 border-b border-[#F4F5F7] px-4 py-[11px] last:border-b-0 dark:border-slate-700"
                          >
                            <div className="min-w-0">
                              <div
                                className={`text-[13.5px] font-bold tabular-nums ${
                                  c.voided
                                    ? 'text-[#9AA1AD] line-through'
                                    : 'text-[#1A1D24] dark:text-slate-100'
                                }`}
                              >
                                {fmtMoney(c.amount)}
                                {c.voided && (
                                  <span className="ml-2 rounded-full bg-[#F3F4F6] px-2 py-0.5 text-[10.5px] font-bold uppercase tracking-wide text-[#8A92A0] no-underline">
                                    Voided
                                  </span>
                                )}
                              </div>
                              <div className="truncate text-[11.5px] text-[#8A92A0]">
                                {c.created_at ? new Date(c.created_at).toLocaleString() : '—'}
                                {c.created_by_name ? ` · ${c.created_by_name}` : ''}
                                {c.note ? ` · ${c.note}` : ''}
                                {c.voided && c.voided_by_name ? ` · voided by ${c.voided_by_name}` : ''}
                              </div>
                            </div>
                            {canCashOut && detailOpen && !c.voided && (
                              <button
                                type="button"
                                onClick={() =>
                                  voidCashOutMutation.mutate({ id: detail.id, cashOutId: c.id })
                                }
                                disabled={voidCashOutMutation.isPending}
                                className="flex-none cursor-pointer rounded-[9px] border-[1.5px] border-[#E2E5EA] bg-white px-3 py-1.5 text-[12px] font-bold text-[#C21F1F] transition-colors hover:bg-[#FCEEEE] disabled:opacity-50 dark:border-slate-600 dark:bg-slate-700"
                              >
                                Void
                              </button>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {canCashOut && detailOpen && (
                      <div className="mt-3 flex flex-wrap items-end gap-2">
                        <div>
                          <label className="mb-1 block text-[11.5px] font-bold text-[#374151] dark:text-slate-200">
                            Amount
                          </label>
                          <input
                            type="number"
                            step="0.01"
                            min="0"
                            value={cashOutForm.amount}
                            onChange={(e) => setCashOutForm({ ...cashOutForm, amount: e.target.value })}
                            placeholder="0.00"
                            aria-label="Cash-out amount"
                            className="w-[130px] rounded-[10px] border-[1.5px] border-[#E2E5EA] px-[11px] py-2 text-sm tabular-nums outline-none focus:border-[#DC2A2A] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                          />
                        </div>
                        <div className="min-w-[160px] flex-1">
                          <label className="mb-1 block text-[11.5px] font-bold text-[#374151] dark:text-slate-200">
                            Note
                          </label>
                          <input
                            type="text"
                            value={cashOutForm.note}
                            onChange={(e) => setCashOutForm({ ...cashOutForm, note: e.target.value })}
                            placeholder="e.g. handed to owner"
                            aria-label="Cash-out note"
                            className="w-full rounded-[10px] border-[1.5px] border-[#E2E5EA] px-[11px] py-2 text-sm outline-none focus:border-[#DC2A2A] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                          />
                        </div>
                        <button
                          type="button"
                          disabled={
                            !(Number(cashOutForm.amount) > 0) || addCashOutMutation.isPending
                          }
                          onClick={() =>
                            addCashOutMutation.mutate({
                              id: detail.id,
                              amount: Number(cashOutForm.amount),
                              note: cashOutForm.note || undefined,
                            })
                          }
                          className="cursor-pointer rounded-[10px] border-none bg-[#1A1D24] px-4 py-2 text-[13px] font-bold text-white transition-colors hover:bg-black disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Record cash-out
                        </button>
                      </div>
                    )}
                    {canCashOut && !detailOpen && (
                      <p className="mt-2 text-[11.5px] text-[#8A92A0]">
                        This shift is closed — its cash-outs can no longer be changed.
                      </p>
                    )}
                  </div>

                  {detail.notes && (
                    <p className="mt-4 text-[12.5px] text-[#6B7280] dark:text-slate-400">
                      <span className="font-bold text-[#9AA1AD]">Notes</span> {detail.notes}
                    </p>
                  )}
                </div>

                {/* Modal footer */}
                <div
                  className="flex flex-none items-center gap-[11px] border-t border-[#EEEFF2] bg-[#FBFBFC] px-[26px] py-[15px] dark:border-slate-700 dark:bg-slate-900/40"
                  style={{ justifyContent: detailOpen ? 'space-between' : 'flex-end' }}
                >
                  {detailOpen ? (
                    <>
                      <button
                        type="button"
                        onClick={() => printReport(detail, 'X')}
                        className="cursor-pointer rounded-[11px] border-[1.5px] border-[#E2E5EA] bg-white px-5 py-[11px] text-sm font-semibold text-[#374151] transition-colors hover:bg-[#F3F4F6] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                      >
                        Print X-report
                      </button>
                      {canCloseShift(detail) && (
                        <button
                          type="button"
                          onClick={() => startClose(detail)}
                          className="cursor-pointer rounded-[11px] border-none bg-[#DC2A2A] px-6 py-[11px] text-sm font-bold text-white shadow-[0_4px_12px_rgba(220,42,42,.26)] transition-colors hover:bg-[#C21F1F]"
                        >
                          Close shift &amp; reconcile
                        </button>
                      )}
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => printReport(detail, 'Z')}
                      className="cursor-pointer rounded-[11px] border-[1.5px] border-[#E2E5EA] bg-white px-5 py-[11px] text-sm font-semibold text-[#374151] transition-colors hover:bg-[#F3F4F6] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
                    >
                      Print Z-report
                    </button>
                  )}
                  {/* Cash-outs, the close and its variance are all recorded. */}
                  <RecordHistoryLink
                        module="shifts"
                    entityType="shift"
                    entityId={detail.id}
                    label={`Shift #${detail.shift_number ?? detail.id}`}
                  />
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* -------------------------------------------- Open New Shift (kept) */}
      <Modal isOpen={showOpenForm} onClose={() => setShowOpenForm(false)} title="Open New Shift" size="medium">
        <form onSubmit={handleOpenShift} className="space-y-4">
          {singleBranch ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Branch *</label>
              <div className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-800">
                {singleBranch.name} ({singleBranch.code})
              </div>
            </div>
          ) : (
            <SearchableSelect
              label="Branch *"
              value={formData.branch_id}
              onChange={(v) => {
                // Drop a brand pick that the newly chosen branch doesn't serve.
                const next = (branches ?? []).find((b) => String(b.id) === v);
                setFormData((p) => ({
                  ...p,
                  branch_id: v,
                  brand_id:
                    p.brand_id && next && !(next.brand_ids ?? []).includes(parseInt(p.brand_id, 10))
                      ? ''
                      : p.brand_id,
                }));
              }}
              options={[
                { value: '', label: 'Select Branch' },
                ...(branches ?? []).map((branch) => ({
                  value: String(branch.id),
                  label: `${branch.name} (${branch.code})`,
                })),
              ]}
              placeholder="Select Branch"
              searchPlaceholder="Search branches..."
            />
          )}

          {singleBrand ? (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Brand *</label>
              <div className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-800">
                {singleBrand.name}
              </div>
            </div>
          ) : (
            <SearchableSelect
              label="Brand *"
              value={formData.brand_id}
              onChange={(v) => setFormData({ ...formData, brand_id: v })}
              options={[
                { value: '', label: 'Select Brand' },
                ...openFormBrands.map((brand) => ({
                  value: String(brand.id),
                  label: brand.name, inactive: isEntityInactive(brand),
                })),
              ]}
              placeholder="Select Brand"
              searchPlaceholder="Search brands..."
            />
          )}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Opened by</label>
            <div className="w-full px-4 py-2 border border-gray-200 rounded-lg bg-gray-50 text-gray-800">
              {user?.name ?? '—'}
              {user?.email ? ` (${user.email})` : ''}
            </div>
            <p className="text-xs text-gray-500 mt-1">The shift is opened under your account.</p>
          </div>

          {existingOpenShift ? (
            <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 space-y-2">
              <p>
                A shift (<strong>{existingOpenShift.shift_number}</strong>) is already open for this brand at this branch.
                Only one shift can be open per brand per branch — use the existing one.
              </p>
              <Button
                type="button"
                size="small"
                variant="view"
                onClick={() => {
                  setShowOpenForm(false);
                  setDetailShiftId(existingOpenShift.id);
                }}
              >
                View open shift
              </Button>
            </div>
          ) : (
            <>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Opening Cash *</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.opening_cash}
                  onChange={(e) => setFormData({ ...formData, opening_cash: e.target.value })}
                  required
                  placeholder="0.00"
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  value={formData.notes}
                  onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                  rows={3}
                  className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </>
          )}

          <div className="flex gap-2 justify-end">
            <Button type="button" variant="outline" onClick={() => setShowOpenForm(false)}>
              Cancel
            </Button>
            <Button
              type="submit"
              isLoading={createMutation.isPending}
              disabled={!!existingOpenShift || !formData.branch_id || !formData.brand_id}
            >
              Open Shift
            </Button>
          </div>
        </form>
      </Modal>

      {/* --------------------------------------------- Close Shift modal */}
      {showCloseForm && selectedShift && (
        <div
          onClick={() => setShowCloseForm(false)}
          className="fixed inset-0 z-[60] flex items-center justify-center p-[30px]"
          style={{ background: 'rgba(20,17,18,.55)', backdropFilter: 'blur(3px)', WebkitBackdropFilter: 'blur(3px)' }}
        >
          <form
            onSubmit={handleCloseShift}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[92vh] w-[720px] max-w-full flex-col overflow-hidden rounded-[18px] bg-white shadow-[0_40px_90px_rgba(0,0,0,.5)] dark:bg-slate-800"
          >
            <div className="h-1.5 flex-none" style={{ background: 'linear-gradient(90deg,#EF4444,#DC2A2A 55%,#F43F5E)' }} />
            {/* Header */}
            <div className="flex flex-none items-center justify-between gap-[14px] border-b border-[#F1F2F5] px-[26px] pb-4 pt-5 dark:border-slate-700">
              <div className="flex min-w-0 items-center gap-[13px]">
                <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] bg-[#FCEEEE] text-[#DC2A2A]">
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="7" width="18" height="13" rx="2" /><path d="M8 7V5a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><path d="M9 12h6" />
                  </svg>
                </span>
                <div className="min-w-0">
                  <div className="text-lg font-extrabold text-[#1A1D24] dark:text-slate-100">Close Shift</div>
                  <div className="mt-px text-[12.5px] text-[#8A92A0]">{selectedShift.shift_number}</div>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setShowCloseForm(false)}
                aria-label="Cancel closing"
                className="flex h-[38px] w-[38px] flex-none cursor-pointer items-center justify-center rounded-[10px] border-none bg-[#F3F4F6] text-[#6B7280] transition-colors hover:bg-[#E7E9ED] dark:bg-slate-700 dark:text-slate-300 dark:hover:bg-slate-600"
              >
                {I.x}
              </button>
            </div>

            {/* Body */}
            <div className="min-h-0 flex-1 overflow-y-auto px-[26px] pb-2 pt-[22px]">
              {/* Info strip */}
              <div className="mb-5 grid grid-cols-2 gap-2.5 rounded-xl border border-[#F1F2F5] bg-[#FBFBFC] px-4 py-[13px] sm:grid-cols-4 dark:border-slate-700 dark:bg-slate-900/40">
                {(
                  [
                    ['Opening cash', fmtMoney(selectedShift.opening_cash)],
                    ['Opened at', new Date(selectedShift.opened_at).toLocaleString()],
                    ['Staff', selectedShift.user?.name ?? '—'],
                    ['Closing as', user?.name ?? '—'],
                  ] as const
                ).map(([k, v]) => (
                  <div key={k}>
                    <div className="text-[10.5px] font-bold uppercase tracking-[.05em] text-[#9AA1AD]">{k}</div>
                    <div className="mt-[3px] text-[13.5px] font-bold text-[#20242C] dark:text-slate-100">{v}</div>
                  </div>
                ))}
              </div>

              {/* Open-orders gate: the shift cannot close while these exist */}
              {(pendingLoading || pendingCount > 0) && (
                <div className="mb-5 overflow-hidden rounded-xl border-[1.5px] border-[#F3C9C9] bg-[#FFF7F6] dark:border-red-900/70 dark:bg-red-900/10">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#F8DADA] px-4 py-3 dark:border-red-900/50">
                    <span className="flex items-center gap-2 text-[13px] font-extrabold text-[#B5121B] dark:text-red-300">
                      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round">
                        <path d="M8 1.8L15 14H1z" /><path d="M8 6.2v3.6" /><circle cx="8" cy="12" r="0.4" fill="currentColor" />
                      </svg>
                      {pendingLoading
                        ? 'Checking for open orders…'
                        : `${pendingCount} order${pendingCount === 1 ? '' : 's'} from this shift not completed`}
                    </span>
                    {!pendingLoading && pendingCount > 0 && (
                      <button
                        type="button"
                        disabled={completeAllMutation.isPending || completeOrderMutation.isPending}
                        onClick={() => completeAllMutation.mutate(pendingOrders!.orders.map((o) => o.id))}
                        className="rounded-[9px] bg-[#DC2A2A] px-3.5 py-[7px] text-[12.5px] font-bold text-white transition-colors hover:bg-[#C21F1F] disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {completeAllMutation.isPending ? 'Completing…' : 'Mark all completed'}
                      </button>
                    )}
                  </div>
                  {!pendingLoading && (
                    <div className="max-h-[220px] overflow-y-auto">
                      {pendingOrders!.orders.map((o) => {
                        const chip =
                          o.status === 'ready'
                            ? { bg: '#EAF7EE', c: '#16A34A' }
                            : o.status === 'preparing'
                              ? { bg: '#FFF6E6', c: '#B45309' }
                              : o.status === 'accepted'
                                ? { bg: '#EAF1FF', c: '#2563EB' }
                                : { bg: '#EEF0F3', c: '#5A6473' };
                        return (
                          <div
                            key={o.id}
                            className="grid grid-cols-[1fr_auto] items-center gap-2 border-b border-[#FBE9E9] px-4 py-2.5 last:border-b-0 sm:grid-cols-[.8fr_1fr_1fr_.9fr_auto] dark:border-red-900/30"
                          >
                            <span className="text-[13px] font-extrabold text-[#20242C] dark:text-slate-100">#{o.order_number}</span>
                            <span className="hidden min-w-0 truncate text-[12.5px] text-[#6B7280] sm:block dark:text-slate-400">
                              {o.customer_name ?? (o.table_number ? `Table ${o.table_number}` : 'Walk-in')}
                              {o.brand_name ? ` · ${o.brand_name}` : ''}
                            </span>
                            <span className="hidden sm:block">
                              <span className="rounded-[7px] px-2 py-[3px] text-xs font-bold" style={{ background: chip.bg, color: chip.c }}>
                                {o.status.charAt(0).toUpperCase() + o.status.slice(1)}
                              </span>
                            </span>
                            <span className="hidden text-[13px] font-bold tabular-nums text-[#1A1D24] sm:block dark:text-slate-100">
                              {fmtMoney(o.total_amount)}
                            </span>
                            <button
                              type="button"
                              disabled={completeAllMutation.isPending || completeOrderMutation.isPending}
                              onClick={() => completeOrderMutation.mutate(o.id)}
                              className="justify-self-end rounded-[9px] border-[1.5px] border-[#DC2A2A] bg-white px-3 py-[5px] text-[12px] font-bold text-[#DC2A2A] transition-colors hover:bg-[#FCEEEE] disabled:cursor-not-allowed disabled:opacity-60 dark:bg-transparent"
                            >
                              Complete
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="border-t border-[#F8DADA] px-4 py-2 text-[11.5px] font-semibold text-[#B5121B] dark:border-red-900/50 dark:text-red-300">
                    The shift can only be closed once every order above is completed (or cancelled).
                  </p>
                </div>
              )}

              {/* Completed orders header */}
              <div className="mb-[11px] flex flex-wrap items-center justify-between gap-3">
                <span className="text-[11px] font-extrabold uppercase tracking-[.06em] text-[#9AA1AD]">
                  Completed orders · {shiftOrders?.order_count ?? '…'}
                </span>
                {shiftOrders && (
                  <div className="flex items-center gap-3.5 text-[12.5px]">
                    <span className="text-[#6B7280] dark:text-slate-400">
                      Total <span className="font-extrabold text-[#20242C] dark:text-slate-100">{fmtMoney(shiftOrders.total_amount)}</span>
                    </span>
                    <span className="text-[#6B7280] dark:text-slate-400">
                      Cash <span className="font-extrabold text-[#0F766E]">{fmtMoney(shiftOrders.cash_collected)}</span>
                    </span>
                    <span className="text-[#6B7280] dark:text-slate-400">
                      Card <span className="font-extrabold text-[#2563EB]">{fmtMoney(shiftOrders.card_collected)}</span>
                    </span>
                  </div>
                )}
              </div>

              {/* Orders table */}
              <div className="mb-[22px] overflow-hidden rounded-xl border border-[#ECEDF0] dark:border-slate-700">
                <div className="grid grid-cols-[.7fr_1fr_1fr_1fr] gap-2.5 border-b border-[#F1F2F5] bg-[#FBFBFC] px-4 py-[9px] dark:border-slate-700 dark:bg-slate-900/40">
                  {['Order #', 'Time', 'Payment', 'Total'].map((h, i) => (
                    <span
                      key={h}
                      className={`text-[10px] font-bold uppercase tracking-[.05em] text-[#9AA1AD] ${i === 3 ? 'text-right' : ''}`}
                    >
                      {h}
                    </span>
                  ))}
                </div>
                <div className="max-h-[190px] overflow-y-auto">
                  {shiftOrdersLoading ? (
                    <div className="p-4"><Loader text="Loading orders…" /></div>
                  ) : shiftOrders && shiftOrders.orders.length > 0 ? (
                    shiftOrders.orders.map((o) => {
                      const pay = payChip(o.payment_method);
                      return (
                        <div
                          key={o.id}
                          className="grid grid-cols-[.7fr_1fr_1fr_1fr] items-center gap-2.5 border-b border-[#F6F7F9] px-4 py-[9px] dark:border-slate-700/60"
                        >
                          <span className="text-[13px] font-bold text-[#20242C] dark:text-slate-100">{o.order_number}</span>
                          <span className="text-[12.5px] text-[#6B7280] dark:text-slate-400">
                            {o.completed_at ? new Date(o.completed_at).toLocaleTimeString() : '—'}
                          </span>
                          <span
                            className="justify-self-start rounded-[7px] px-2 py-[3px] text-xs font-bold"
                            style={{ background: pay.bg, color: pay.c }}
                          >
                            {pay.label}
                          </span>
                          <span className="text-right text-[13px] font-bold tabular-nums text-[#1A1D24] dark:text-slate-100">
                            {fmtMoney(o.total_amount)}
                          </span>
                        </div>
                      );
                    })
                  ) : (
                    <p className="p-4 text-sm text-[#8A92A0]">No completed orders in this shift.</p>
                  )}
                </div>
              </div>

              {/* Expected vs actual */}
              <div className="mb-[18px] grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div className="rounded-xl border border-[#F1F2F5] bg-[#FBFBFC] px-4 py-3.5 dark:border-slate-700 dark:bg-slate-900/40">
                  <div className="text-[10.5px] font-bold uppercase tracking-[.05em] text-[#9AA1AD]">Expected cash</div>
                  <div className="mt-1.5 text-xl font-black tabular-nums text-[#20242C] dark:text-slate-100">
                    {closeExpectedCash != null ? fmtMoney(closeExpectedCash) : '—'}
                  </div>
                </div>
                <div>
                  <label className="mb-[7px] block text-[12.5px] font-bold text-[#374151] dark:text-slate-200">
                    Cash in drawer <span className="text-[#DC2A2A]">*</span>
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={closeFormData.actual_cash}
                    onChange={(e) => setCloseFormData({ ...closeFormData, actual_cash: e.target.value })}
                    placeholder="0.00"
                    className="w-full rounded-[10px] border-[1.5px] border-[#E2E5EA] px-[13px] py-[11px] text-sm tabular-nums text-[#1A1D24] outline-none focus:border-[#DC2A2A] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                  />
                  <p className="mt-1.5 text-[11.5px] text-[#8A92A0]">Everything counted in the till at close.</p>
                </div>
                <div>
                  {/* Read-only here for everyone: cash-outs are recorded on the
                      shift itself (detail modal), never during reconciliation. */}
                  <div className="text-[10.5px] font-bold uppercase tracking-[.05em] text-[#9AA1AD]">
                    Cash taken out
                  </div>
                  <div className="mt-1.5 text-xl font-black tabular-nums text-[#20242C] dark:text-slate-100">
                    {closeCashOutTotal > 0 ? `− ${fmtMoney(closeCashOutTotal)}` : fmtMoney(0)}
                  </div>
                  <p className="mt-1.5 text-[11.5px] text-[#8A92A0]">
                    {closeCashOutTotal > 0
                      ? 'Already deducted from expected cash.'
                      : 'Nothing was handed out during this shift.'}
                  </p>
                  {closeVariance && (
                    <div
                      className="mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12.5px] font-extrabold"
                      style={{ background: closeVariance.bg, color: closeVariance.color }}
                    >
                      {closeVariance.text}
                    </div>
                  )}
                </div>
              </div>

              {/* Notes */}
              <div className="mb-5">
                <label className="mb-[7px] block text-[12.5px] font-bold text-[#374151] dark:text-slate-200">Notes</label>
                <textarea
                  value={closeFormData.notes}
                  onChange={(e) => setCloseFormData({ ...closeFormData, notes: e.target.value })}
                  placeholder="Optional — explain a variance, handover notes…"
                  className="min-h-[70px] w-full resize-y rounded-[10px] border-[1.5px] border-[#E2E5EA] px-[13px] py-[11px] text-[13.5px] text-[#1A1D24] outline-none focus:border-[#DC2A2A] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-100"
                />
              </div>
            </div>

            {/* Footer */}
            <div className="flex flex-none items-center justify-end gap-[11px] border-t border-[#EEEFF2] bg-[#FBFBFC] px-[26px] py-[15px] dark:border-slate-700 dark:bg-slate-900/40">
              <button
                type="button"
                onClick={() => setShowCloseForm(false)}
                className="cursor-pointer rounded-[11px] border-[1.5px] border-[#E2E5EA] bg-white px-5 py-[11px] text-sm font-semibold text-[#374151] transition-colors hover:bg-[#F3F4F6] dark:border-slate-600 dark:bg-slate-700 dark:text-slate-200 dark:hover:bg-slate-600"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={closeFormData.actual_cash === '' || closeMutation.isPending || pendingLoading || pendingCount > 0}
                title={pendingCount > 0 ? 'Complete all open orders of this shift first' : undefined}
                className="rounded-[11px] border-none px-6 py-[11px] text-sm font-bold text-white transition-colors"
                style={
                  closeFormData.actual_cash === '' || closeMutation.isPending || pendingLoading || pendingCount > 0
                    ? { background: '#E5A9A9', boxShadow: 'none', cursor: 'not-allowed' }
                    : { background: '#DC2A2A', boxShadow: '0 4px 12px rgba(220,42,42,.26)', cursor: 'pointer' }
                }
              >
                {closeMutation.isPending
                  ? 'Closing…'
                  : pendingCount > 0
                    ? `${pendingCount} order${pendingCount === 1 ? '' : 's'} pending`
                    : 'Close Shift'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default Shifts;
