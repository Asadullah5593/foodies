import React, { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Loader from '../../../components/Loader';
import Button from '../../../components/Button';
import Modal from '../../../components/Modal';
import SearchableSelect from '../../../components/SearchableSelect';
import {
  LuPlus,
  LuSearch,
  LuCheck,
  LuClipboardList,
  LuFileText,
  LuPackageCheck,
} from 'react-icons/lu';
import apiClient from '../../../utils/apiClient';
import { inventoryService } from '../../../services/api/inventoryService';
import { procurementService } from '../../../services/api/procurementService';
import { useAuth } from '../../../contexts/AuthContext';

export type ProcurementTabKey = 'prs' | 'pos' | 'grns';

const prettyDate = (d?: string | Date | null) => {
  if (!d) return '—';
  const value = new Date(d);
  if (Number.isNaN(value.getTime())) return '—';
  return value.toLocaleDateString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
};

const prettyStatus = (status?: string) => {
  const raw = String(status ?? '').trim();
  if (!raw) return '—';
  return raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase();
};

const statusClass = (status?: string) => {
  const s = String(status ?? '').toLowerCase();
  if (s.includes('approved') || s.includes('closed') || s.includes('posted')) {
    return 'bg-emerald-100 text-emerald-700';
  }
  if (s.includes('reject') || s.includes('revers')) return 'bg-rose-100 text-rose-700';
  if (s.includes('draft') || s.includes('created') || s.includes('submitted') || s.includes('partial')) {
    return 'bg-amber-100 text-amber-700';
  }
  return 'bg-slate-100 text-slate-700';
};

const readApiError = (error: any, fallback: string) => {
  const message = error?.response?.data?.message;
  const normalized = Array.isArray(message) ? String(message[0] ?? '') : String(message ?? '');
  if (normalized.trim()) return normalized;
  return error?.message ?? fallback;
};

const PAGE_SIZE = 10;
const card = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl';
const field =
  'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400';

type StatusMeta = { label: string; color: string; bg: string; dot: string; accent: string };
const FALLBACK_STATUS = (raw?: string): StatusMeta => ({
  label: prettyStatus(raw),
  color: '#475569',
  bg: '#F1F5F9',
  dot: '#94A3B8',
  accent: 'transparent',
});

const PR_STATUS: Record<string, StatusMeta> = {
  draft: { label: 'Draft', color: '#B45309', bg: '#FCF1DC', dot: '#D97706', accent: '#D97706' },
  submitted: { label: 'Submitted', color: '#1D4ED8', bg: '#E6EEFE', dot: '#2563EB', accent: '#2563EB' },
  approved: { label: 'Approved', color: '#0F8A4F', bg: '#E6F6EE', dot: '#16A34A', accent: 'transparent' },
  rejected: { label: 'Rejected', color: '#B91C1C', bg: '#FCE9E9', dot: '#DC2626', accent: '#DC2626' },
  cancelled: { label: 'Cancelled', color: '#64748B', bg: '#F1F5F9', dot: '#94A3B8', accent: 'transparent' },
};
const PO_STATUS: Record<string, StatusMeta> = {
  created: { label: 'Created', color: '#B45309', bg: '#FCF1DC', dot: '#D97706', accent: '#D97706' },
  sent: { label: 'Sent', color: '#1D4ED8', bg: '#E6EEFE', dot: '#2563EB', accent: '#2563EB' },
  partially_received: { label: 'Partially received', color: '#C2410C', bg: '#FDEBDD', dot: '#EA580C', accent: '#EA580C' },
  closed: { label: 'Closed', color: '#0F8A4F', bg: '#E6F6EE', dot: '#16A34A', accent: 'transparent' },
  cancelled: { label: 'Cancelled', color: '#64748B', bg: '#F1F5F9', dot: '#94A3B8', accent: 'transparent' },
};
const GRN_STATUS: Record<string, StatusMeta> = {
  draft: { label: 'Draft', color: '#B45309', bg: '#FCF1DC', dot: '#D97706', accent: '#D97706' },
  posted: { label: 'Posted', color: '#0F8A4F', bg: '#E6F6EE', dot: '#16A34A', accent: 'transparent' },
  reversed: { label: 'Reversed', color: '#B91C1C', bg: '#FCE9E9', dot: '#DC2626', accent: '#DC2626' },
};
const metaFor = (map: Record<string, StatusMeta>, status?: string): StatusMeta =>
  map[String(status ?? '').toLowerCase()] ?? FALLBACK_STATUS(status);

const StatusPill: React.FC<{ meta: StatusMeta }> = ({ meta }) => (
  <span
    className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[12px] font-semibold"
    style={{ color: meta.color, background: meta.bg }}
  >
    <span className="w-1.5 h-1.5 rounded-full flex-none" style={{ background: meta.dot }} />
    {meta.label}
  </span>
);

const FilterTabs: React.FC<{
  tabs: { key: string; label: string; count: number }[];
  value: string;
  onChange: (k: string) => void;
}> = ({ tabs, value, onChange }) => (
  <div className="flex gap-1.5 flex-wrap">
    {tabs.map((t) => {
      const on = value === t.key;
      return (
        <button
          key={t.key}
          onClick={() => onChange(t.key)}
          className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${
            on
              ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100'
              : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'
          }`}
        >
          {t.label}
          <span
            className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${
              on
                ? 'bg-white/20 text-white dark:bg-slate-900/15 dark:text-slate-900'
                : 'bg-slate-100 dark:bg-slate-700 text-slate-500 dark:text-slate-300'
            }`}
          >
            {t.count}
          </span>
        </button>
      );
    })}
  </div>
);

const FLOW_STEPS = [
  { n: 1 as const, label: 'Requisition', Icon: LuClipboardList },
  { n: 2 as const, label: 'Purchase order', Icon: LuFileText },
  { n: 3 as const, label: 'Goods receipt', Icon: LuPackageCheck },
];
const StepFlow: React.FC<{ current: 1 | 2 | 3 }> = ({ current }) => (
  <div className={`${card} flex items-center px-5 py-4 overflow-x-auto`}>
    {FLOW_STEPS.map((s, i) => {
      const done = s.n < current;
      const active = s.n === current;
      const iconColor = done ? '#16A34A' : active ? '#DC2A2A' : '#B6BCC6';
      const iconBg = done ? '#E6F6EE' : active ? '#FCEEEE' : '#F1F5F9';
      return (
        <React.Fragment key={s.n}>
          <div className="flex items-center gap-3 flex-none">
            <div
              className="w-9 h-9 rounded-lg flex items-center justify-center flex-none"
              style={{ color: iconColor, background: iconBg }}
            >
              {done ? <LuCheck className="w-[18px] h-[18px]" /> : <s.Icon className="w-[18px] h-[18px]" />}
            </div>
            <div>
              <div
                className="text-[11px] font-semibold uppercase tracking-wide"
                style={{ color: done ? '#16A34A' : active ? '#DC2A2A' : '#B6BCC6' }}
              >
                Step {s.n}
                {done ? ' · done' : ''}
              </div>
              <div
                className={`text-sm font-semibold ${
                  active || done ? 'text-slate-900 dark:text-slate-100' : 'text-slate-400'
                }`}
              >
                {s.label}
              </div>
            </div>
          </div>
          {i < FLOW_STEPS.length - 1 && (
            <div
              className="flex-1 h-0.5 min-w-[24px] mx-4"
              style={{ background: s.n < current ? '#16A34A' : '#E5E7EB' }}
            />
          )}
        </React.Fragment>
      );
    })}
  </div>
);

const PageHeader: React.FC<{ crumb: string; title: string; desc: string; action?: React.ReactNode }> = ({
  crumb,
  title,
  desc,
  action,
}) => (
  <div className="flex flex-wrap items-start justify-between gap-4">
    <div>
      <div className="flex items-center gap-2 text-[12.5px] text-slate-400 font-medium mb-1.5">
        <span>Procurement</span>
        <span className="text-slate-300">/</span>
        <span className="text-slate-600 dark:text-slate-300 font-semibold">{crumb}</span>
      </div>
      <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">{title}</h1>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-2xl leading-relaxed">{desc}</p>
    </div>
    {action}
  </div>
);

const KpiCard: React.FC<{ label: string; value: React.ReactNode; hint?: string; dot?: string; valueColor?: string; accent?: string }> = ({
  label,
  value,
  hint,
  dot,
  valueColor,
  accent,
}) => (
  <div className={`${card} p-4`} style={accent ? { borderColor: accent } : undefined}>
    <div className="flex items-center gap-1.5 text-[13px] font-semibold text-slate-500 dark:text-slate-400">
      {dot && <span className="w-2 h-2 rounded-full flex-none" style={{ background: dot }} />}
      {label}
    </div>
    <div className="text-2xl font-bold mt-2 text-slate-900 dark:text-slate-100" style={valueColor ? { color: valueColor } : undefined}>
      {value}
    </div>
    {hint && <div className="text-xs text-slate-400 dark:text-slate-500 mt-0.5">{hint}</div>}
  </div>
);

const Pagination: React.FC<{ shown: number; total: number; page: number; totalPages: number; onPage: (p: number) => void }> = ({
  shown,
  total,
  page,
  totalPages,
  onPage,
}) => (
  <div className="flex items-center justify-between px-4 py-3.5 text-[13px] text-slate-500 flex-wrap gap-3">
    <span>
      Showing <strong className="text-slate-700 dark:text-slate-200">{shown}</strong> of {total}
    </span>
    <div className="flex gap-1.5">
      <button
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
        className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700"
      >
        Prev
      </button>
      <span className="px-3.5 py-1.5 rounded-lg bg-red-600 text-white font-semibold">{page}</span>
      <button
        disabled={page >= totalPages}
        onClick={() => onPage(page + 1)}
        className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700"
      >
        Next
      </button>
    </div>
  </div>
);

const Procurement: React.FC<{ initialTab?: ProcurementTabKey; showTabs?: boolean }> = ({
  initialTab = 'prs',
}) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const [tab, setTab] = useState<ProcurementTabKey>(initialTab);
  const hasPoManagePermission = Boolean(
    user?.is_super_admin || user?.permissions?.includes('procurement:po:manage'),
  );
  const hasPrApprovePermission = Boolean(
    user?.is_super_admin || user?.permissions?.includes('procurement:pr:approve'),
  );
  const canApprovePR = hasPoManagePermission && hasPrApprovePermission;
  const canAccessPOModule = hasPoManagePermission;

  useEffect(() => {
    if (!canAccessPOModule && tab === 'pos') {
      setTab('prs');
    }
  }, [canAccessPOModule, tab]);

  const [isCreatePROpen, setIsCreatePROpen] = useState(false);
  const [isEditPOOpen, setIsEditPOOpen] = useState(false);
  const [isCreateGRNOpen, setIsCreateGRNOpen] = useState(false);
  const [isEditGRNOpen, setIsEditGRNOpen] = useState(false);
  const [grnFilterStatus, setGrnFilterStatus] = useState('');
  const [grnFilterFrom, setGrnFilterFrom] = useState('');
  const [grnFilterTo, setGrnFilterTo] = useState('');
  const [grnFilterBranch, setGrnFilterBranch] = useState('');
  const [grnSearchText, setGrnSearchText] = useState('');
  const [poFilterStatus, setPoFilterStatus] = useState('');
  const [poFilterBranch, setPoFilterBranch] = useState('');
  const [poSearchText, setPoSearchText] = useState('');
  const [prFilterStatus, setPrFilterStatus] = useState('');
  const [prFilterBranch, setPrFilterBranch] = useState('');
  const [prSearchText, setPrSearchText] = useState('');
  const [confirmPostGrnId, setConfirmPostGrnId] = useState<number | null>(null);
  const [confirmReverseGrnId, setConfirmReverseGrnId] = useState<number | null>(null);
  const [prPage, setPrPage] = useState(1);
  const [poPage, setPoPage] = useState(1);
  const [grnPage, setGrnPage] = useState(1);

  const [selectedPR, setSelectedPR] = useState<any | null>(null);
  const [selectedPRForStatus, setSelectedPRForStatus] = useState<any | null>(null);
  const [selectedPO, setSelectedPO] = useState<any | null>(null);
  const [selectedGRN, setSelectedGRN] = useState<any | null>(null);

  const [prForm, setPrForm] = useState<any>({
    pr_id: '',
    pr_number: '',
    requesting_branch_id: '',
    requested_from_vendor_id: '',
    inventory_item_id: '',
    requested_qty: '',
    requested_uom_id: '',
    lines: [],
    notes: '',
  });

  const [grnForm, setGrnForm] = useState<any>({
    grn_id: '',
    grn_number: '',
    purchase_order_id: '',
    notes: '',
    lines: [],
  });

  const [poForm, setPoForm] = useState<any>({
    id: '',
    po_number: '',
    vendor_id: '',
    notes: '',
    line_item_id: '',
    line_qty: '',
    line_uom_id: '',
    lines: [],
  });

  const [editGrnLineForm, setEditGrnLineForm] = useState<any>({
    inventory_item_id: '',
    received_qty: '',
    received_uom_id: '',
    lot_code: '',
    expiry_date: '',
  });

  const mapGrnLineFromApi = (l: any) => {
    const idRaw = l.id ?? l.line_id;
    const lineId = Number(idRaw);
    const polRaw = l.purchaseOrderLineId ?? l.purchase_order_line_id;
    const itemRaw = l.inventoryItemId ?? l.inventory_item_id;
    const recvQtyRaw = l.receivedQty ?? l.received_qty;
    const recvUomRaw = l.receivedUomId ?? l.received_uom_id;
    return {
      line_id: Number.isFinite(lineId) && lineId > 0 ? lineId : undefined,
      purchase_order_line_id:
        polRaw != null && polRaw !== '' ? Number(polRaw) : null,
      inventory_item_id: Number(itemRaw),
      received_qty: Number(recvQtyRaw ?? 0),
      received_uom_id: Number(recvUomRaw),
      lot_code: l.lotCode ?? l.lot_code ?? '',
      expiry_date: l.expiryDate ?? l.expiry_date ?? '',
      location_id: (l.locationId ?? l.location_id) != null ? Number(l.locationId ?? l.location_id) : null,
      notes: l.notes ?? '',
    };
  };

  const openEditGRNModal = (grn: any) => {
    setGrnForm({
      grn_id: String(grn.id),
      grn_number: grn.grnNumber ?? grn.grn_number ?? '',
      purchase_order_id: String(grn.purchaseOrderId ?? grn.purchase_order_id ?? ''),
      notes: grn.notes ?? '',
      lines: (grn.lines ?? []).map(mapGrnLineFromApi),
    });
    setEditGrnLineForm({
      inventory_item_id: '',
      received_qty: '',
      received_uom_id: '',
      lot_code: '',
      expiry_date: '',
    });
    setIsEditGRNOpen(true);
  };

  const branchesQ = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await apiClient.get('/admin/branches')).data ?? [],
  });
  const vendorsQ = useQuery({
    queryKey: ['inventory-vendors'],
    queryFn: inventoryService.listVendors,
  });
  const itemsQ = useQuery({
    queryKey: ['inventory-items'],
    queryFn: inventoryService.listItems,
  });
  const uomsQ = useQuery({
    queryKey: ['inventory-uoms'],
    queryFn: inventoryService.listUoms,
  });

  const prOnHandQ = useQuery({
    queryKey: ['inventory-onhand-for-pr', prForm.requesting_branch_id],
    queryFn: () => inventoryService.getOnHand(Number(prForm.requesting_branch_id)),
    enabled: Boolean(isCreatePROpen && prForm.requesting_branch_id),
  });

  const prsQ = useQuery({
    queryKey: ['procurement-prs'],
    queryFn: procurementService.listPRs,
    enabled: tab === 'prs',
  });
  const posQ = useQuery({
    queryKey: ['procurement-pos'],
    queryFn: procurementService.listPOs,
    enabled: tab === 'pos' || tab === 'grns',
  });
  const grnIdFromUrl = searchParams.get('grn_id');
  const grnsQ = useQuery({
    queryKey: ['procurement-grns', grnFilterFrom, grnFilterTo],
    queryFn: () =>
      procurementService.listGRNsFiltered({
        from: grnFilterFrom || undefined,
        to: grnFilterTo || undefined,
      }),
    enabled: tab === 'grns',
  });

  const grnFromLinkQ = useQuery({
    queryKey: ['procurement-grn-by-id', grnIdFromUrl],
    queryFn: () => procurementService.getGRN(Number(grnIdFromUrl)),
    enabled:
      tab === 'grns' &&
      !!grnIdFromUrl &&
      Number.isInteger(Number(grnIdFromUrl)) &&
      Number(grnIdFromUrl) > 0,
  });

  const createPRM = useMutation({
    mutationFn: procurementService.createPR,
    onSuccess: async () => {
      toast.success('Purchase requisition created');
      setIsCreatePROpen(false);
      setPrForm({
        pr_id: '',
        pr_number: '',
        requesting_branch_id: '',
        requested_from_vendor_id: '',
        inventory_item_id: '',
        requested_qty: '',
        requested_uom_id: '',
        lines: [],
        notes: '',
      });
      await queryClient.invalidateQueries({ queryKey: ['procurement-prs'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create PR')),
  });

  const updatePRM = useMutation({
    mutationFn: (data: {
      id: number;
      payload: {
        pr_number?: string;
        requesting_branch_id: number;
        requested_from_vendor_id: number;
        notes?: string | null;
        lines: Array<{
          inventory_item_id: number;
          requested_qty: number;
          requested_uom_id: number;
        }>;
      };
    }) => procurementService.updatePR(data.id, data.payload),
    onSuccess: async () => {
      toast.success('Purchase requisition updated');
      setIsCreatePROpen(false);
      setPrForm({
        pr_id: '',
        pr_number: '',
        requesting_branch_id: '',
        requested_from_vendor_id: '',
        inventory_item_id: '',
        requested_qty: '',
        requested_uom_id: '',
        lines: [],
        notes: '',
      });
      await queryClient.invalidateQueries({ queryKey: ['procurement-prs'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to update PR')),
  });

  const submitPRM = useMutation({
    mutationFn: (id: number) => procurementService.submitPR(id),
    onSuccess: async () => {
      toast.success('PR submitted');
      await queryClient.invalidateQueries({ queryKey: ['procurement-prs'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to submit PR')),
  });

  const approvePRM = useMutation({
    mutationFn: (id: number) => procurementService.approvePR(id, {}),
    onSuccess: async () => {
      toast.success('PR approved and PO created');
      await queryClient.invalidateQueries({ queryKey: ['procurement-prs'] });
      await queryClient.invalidateQueries({ queryKey: ['procurement-pos'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to approve PR')),
  });

  const updatePOM = useMutation({
    mutationFn: (data: {
      id: number;
      payload: {
        po_number?: string;
        vendor_id?: number;
        notes?: string | null;
        lines: Array<{ inventory_item_id: number; ordered_qty: number; ordered_uom_id: number }>;
      };
    }) => procurementService.updatePO(data.id, data.payload),
    onSuccess: async () => {
      toast.success('Purchase order updated');
      setIsEditPOOpen(false);
      setPoForm({
        id: '',
        po_number: '',
        vendor_id: '',
        notes: '',
        line_item_id: '',
        line_qty: '',
        line_uom_id: '',
        lines: [],
      });
      await queryClient.invalidateQueries({ queryKey: ['procurement-pos'] });
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to update PO')),
  });

  const createGRNM = useMutation({
    mutationFn: (data: { grn_number?: string; purchase_order_id: number; branch_id: number; notes?: string }) => procurementService.createGRN(data),
    onSuccess: async (created: any) => {
      toast.success('Draft receipt created — enter quantities below');
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
      setIsCreateGRNOpen(false);
      if (created?.id != null) {
        openEditGRNModal(created);
      } else {
        setGrnForm({ grn_id: '', grn_number: '', purchase_order_id: '', notes: '', lines: [] });
      }
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create GRN')),
  });

  const updateGRNM = useMutation({
    mutationFn: (vars: {
      id: number;
      payload: {
        grn_number?: string;
        notes?: string | null;
        lines?: Array<{
          line_id?: number;
          purchase_order_line_id?: number | null;
          inventory_item_id: number;
          received_qty: number;
          allow_mismatched_item?: boolean;
          received_uom_id: number;
          lot_code?: string | null;
          expiry_date?: string | null;
          location_id?: number | null;
          notes?: string | null;
        }>;
      };
      keepOpen?: boolean;
    }) => procurementService.updateGRN(vars.id, vars.payload),
    onSuccess: async (updated: any, vars) => {
      toast.success('Draft saved');
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
      if (vars.keepOpen && updated?.id != null) {
        openEditGRNModal(updated);
      } else {
        setIsEditGRNOpen(false);
        setGrnForm({ grn_id: '', grn_number: '', purchase_order_id: '', notes: '', lines: [] });
      }
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to update GRN')),
  });

  const postGRNM = useMutation({
    mutationFn: (id: number) => procurementService.postGRN(id),
    onSuccess: async () => {
      toast.success('GRN posted to inventory');
      setConfirmPostGrnId(null);
      setIsEditGRNOpen(false);
      setGrnForm({ grn_id: '', grn_number: '', purchase_order_id: '', notes: '', lines: [] });
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
      await queryClient.invalidateQueries({ queryKey: ['procurement-grn-by-id'] });
      await queryClient.invalidateQueries({ queryKey: ['procurement-pos'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to post GRN')),
  });

  const reverseGRNM = useMutation({
    mutationFn: (id: number) => procurementService.reverseGRN(id),
    onSuccess: async () => {
      toast.success('GRN reversed');
      setConfirmReverseGrnId(null);
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
      await queryClient.invalidateQueries({ queryKey: ['procurement-grn-by-id'] });
      await queryClient.invalidateQueries({ queryKey: ['procurement-pos'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to reverse GRN')),
  });

  const canEditPRRow = (pr: any) => (
    String(pr?.status) === 'draft' ||
    (canApprovePR && String(pr?.status) === 'submitted')
  );

  const canSubmitPRRow = (pr: any) => String(pr?.status) === 'draft';
  const canApprovePRRow = (pr: any) => canApprovePR && String(pr?.status) === 'submitted';

  const branchById = useMemo(() => {
    const m = new Map<number, any>();
    for (const b of branchesQ.data ?? []) m.set(Number(b.id), b);
    return m;
  }, [branchesQ.data]);

  const availablePrBranches = useMemo(
    () => (branchesQ.data ?? []).filter((b: any) => Number.isInteger(Number(b.id)) && Number(b.id) > 0),
    [branchesQ.data],
  );

  const singlePrBranchId = useMemo(
    () => (availablePrBranches.length === 1 ? String(availablePrBranches[0].id) : ''),
    [availablePrBranches],
  );

  const vendorById = useMemo(() => {
    const m = new Map<number, any>();
    for (const v of vendorsQ.data ?? []) m.set(Number(v.id), v);
    return m;
  }, [vendorsQ.data]);

  const itemById = useMemo(() => {
    const m = new Map<number, any>();
    for (const it of itemsQ.data ?? []) m.set(Number(it.id), it);
    return m;
  }, [itemsQ.data]);

  const uomById = useMemo(() => {
    const m = new Map<number, any>();
    for (const u of uomsQ.data ?? []) m.set(Number(u.id), u);
    return m;
  }, [uomsQ.data]);

  const grnBranchFilterOptions = useMemo(
    () => [
      { value: '', label: 'All branches' },
      ...((branchesQ.data ?? []) as any[]).map((b) => ({
        value: String(b.id),
        label: String(b.name ?? b.code ?? `Branch #${b.id}`),
      })),
    ],
    [branchesQ.data],
  );

  const prBranchSelectOptions = useMemo(
    () =>
      availablePrBranches.map((b: any) => ({
        value: String(b.id),
        label: String(b.name ?? `Branch #${b.id}`),
      })),
    [availablePrBranches],
  );

  const vendorSearchableOptions = useMemo(
    () =>
      (vendorsQ.data ?? []).map((v: any) => ({
        value: String(v.id),
        label: String(v.name ?? `Vendor #${v.id}`),
      })),
    [vendorsQ.data],
  );

  const itemsSearchableOptions = useMemo(
    () =>
      (itemsQ.data ?? []).map((it: any) => ({
        value: String(it.id),
        label: String(it.name ?? it.code ?? `Item #${it.id}`),
      })),
    [itemsQ.data],
  );

  const grnExtraItemSelectOptions = useMemo(
    () =>
      (itemsQ.data ?? [])
        .filter(
          (it: any) =>
            !(grnForm.lines ?? []).some(
              (l: any) => Number(l.inventory_item_id) === Number(it.id),
            ),
        )
        .map((it: any) => ({
          value: String(it.id),
          label: String(it.name ?? it.code ?? `Item #${it.id}`),
        })),
    [itemsQ.data, grnForm.lines],
  );

  const getUomToRootMultiplier = (uomIdRaw: number | string | null | undefined): number | null => {
    const startId = Number(uomIdRaw);
    if (!Number.isInteger(startId) || startId <= 0) return null;
    const seen = new Set<number>();
    let id: number | null = startId;
    let multiplier = 1;
    // Walk baseUomId chain, multiplying along the way.
    while (id != null) {
      if (seen.has(id)) return null; // cycle
      seen.add(id);
      const u = uomById.get(id);
      if (!u) return null;
      const baseIdRaw = u.baseUomId ?? u.base_uom_id ?? null;
      const baseId = baseIdRaw == null ? null : Number(baseIdRaw);
      if (baseId == null) break;
      const step = Number(u.multiplierToBase ?? u.multiplier_to_base ?? 1);
      if (!Number.isFinite(step) || step <= 0) return null;
      multiplier *= step;
      id = baseId;
    }
    return Number.isFinite(multiplier) && multiplier > 0 ? multiplier : null;
  };

  const getQtyInItemBasePerOne = (item: any, uomId: number): number | null => {
    const itemBaseUomId = Number(item?.baseUomId ?? item?.base_uom_id);
    if (!Number.isInteger(itemBaseUomId) || itemBaseUomId <= 0) return null;
    const multFrom = getUomToRootMultiplier(uomId);
    const multBase = getUomToRootMultiplier(itemBaseUomId);
    if (multFrom == null || multBase == null) return null;
    const kindFrom = String(uomById.get(Number(uomId))?.kind ?? '');
    const kindBase = String(uomById.get(itemBaseUomId)?.kind ?? '');
    if (kindFrom && kindBase && kindFrom !== kindBase) return null;
    return multFrom / multBase;
  };

  const convertQtyBetweenUoms = (args: {
    qty: number;
    item: any;
    fromUomId: number;
    toUomId: number;
  }): number | null => {
    if (!Number.isFinite(args.qty)) return null;
    const basePerOneFrom = getQtyInItemBasePerOne(args.item, args.fromUomId);
    const basePerOneTo = getQtyInItemBasePerOne(args.item, args.toUomId);
    if (basePerOneFrom == null || basePerOneTo == null) return null;
    const qtyBase = args.qty * basePerOneFrom;
    return qtyBase / basePerOneTo;
  };

  const onHandByItemId = useMemo(() => {
    const m = new Map<number, number>();
    for (const row of prOnHandQ.data ?? []) {
      const itemId = Number((row as any).inventoryItemId ?? (row as any).inventory_item_id);
      const qty = Number((row as any).qty ?? 0);
      if (Number.isInteger(itemId) && itemId > 0) {
        m.set(itemId, Number.isFinite(qty) ? qty : 0);
      }
    }
    return m;
  }, [prOnHandQ.data]);

  const poById = useMemo(() => {
    const m = new Map<number, any>();
    for (const po of posQ.data ?? []) m.set(Number(po.id), po);
    return m;
  }, [posQ.data]);

  const openPOs = useMemo(
    () => (posQ.data ?? []).filter((po: any) => po.status !== 'closed'),
    [posQ.data],
  );

  const grnPoSearchableOptions = useMemo(
    () =>
      openPOs.map((po: any) => {
        const branchName = branchById.get(Number(po.buyerBranchId))?.name ?? 'Branch';
        const pr = po.purchaseRequisition?.prNumber;
        const vendorName = vendorById.get(Number(po.vendorId))?.name;
        const parts = [String(po.poNumber ?? ''), branchName];
        if (pr) parts.push(`PR ${pr}`);
        if (vendorName) parts.push(vendorName);
        return { value: String(po.id), label: parts.join(' — ') };
      }),
    [openPOs, branchById, vendorById],
  );

  const displayedGrns = useMemo(() => {
    let rows = [...(grnsQ.data ?? [])];
    if (grnFilterStatus) rows = rows.filter((g: any) => String(g.status) === grnFilterStatus);
    const bid = Number(grnFilterBranch);
    if (Number.isInteger(bid) && bid > 0) {
      rows = rows.filter((g: any) => Number(g.branchId) === bid);
    }
    const q = grnSearchText.trim().toLowerCase();
    if (q) {
      rows = rows.filter((g: any) => {
        const gn = String(g.grnNumber ?? g.id ?? '').toLowerCase();
        const pn = String(
          g.purchaseOrder?.poNumber ?? poById.get(Number(g.purchaseOrderId))?.poNumber ?? '',
        ).toLowerCase();
        const prn = String(g.purchaseOrder?.purchaseRequisition?.prNumber ?? '').toLowerCase();
        return gn.includes(q) || pn.includes(q) || prn.includes(q);
      });
    }
    return rows;
  }, [grnsQ.data, grnFilterStatus, grnFilterBranch, grnSearchText, poById]);

  const branchFilterOptions = grnBranchFilterOptions;

  const displayedPos = useMemo(() => {
    let rows = [...(posQ.data ?? [])];
    if (poFilterStatus === 'open') {
      rows = rows.filter((p: any) => ['created', 'sent', 'partially_received'].includes(String(p.status)));
    } else if (poFilterStatus) {
      rows = rows.filter((p: any) => String(p.status) === poFilterStatus);
    }
    const bid = Number(poFilterBranch);
    if (Number.isInteger(bid) && bid > 0) {
      rows = rows.filter((p: any) => Number(p.buyerBranchId) === bid);
    }
    const q = poSearchText.trim().toLowerCase();
    if (q) {
      rows = rows.filter((p: any) => {
        const pn = String(p.poNumber ?? '').toLowerCase();
        const prn = String(p.purchaseRequisition?.prNumber ?? '').toLowerCase();
        const vn = String(vendorById.get(Number(p.vendorId))?.name ?? '').toLowerCase();
        return pn.includes(q) || prn.includes(q) || vn.includes(q);
      });
    }
    return rows;
  }, [posQ.data, poFilterStatus, poFilterBranch, poSearchText, vendorById]);

  const displayedPrs = useMemo(() => {
    let rows = [...(prsQ.data ?? [])];
    if (prFilterStatus) rows = rows.filter((p: any) => String(p.status) === prFilterStatus);
    const bid = Number(prFilterBranch);
    if (Number.isInteger(bid) && bid > 0) {
      rows = rows.filter((p: any) => Number(p.requestingBranchId) === bid);
    }
    const q = prSearchText.trim().toLowerCase();
    if (q) {
      rows = rows.filter((p: any) => {
        const pn = String(p.prNumber ?? '').toLowerCase();
        const vn = String(vendorById.get(Number(p.requestedFromVendorId))?.name ?? '').toLowerCase();
        const bn = String(branchById.get(Number(p.requestingBranchId))?.name ?? '').toLowerCase();
        return pn.includes(q) || vn.includes(q) || bn.includes(q);
      });
    }
    return rows;
  }, [prsQ.data, prFilterStatus, prFilterBranch, prSearchText, vendorById, branchById]);

  const selectedPOForCreateGRN = useMemo(
    () => poById.get(Number(grnForm.purchase_order_id)),
    [poById, grnForm.purchase_order_id],
  );
  const selectedPOForEditGRN = useMemo(
    () => poById.get(Number(grnForm.purchase_order_id)),
    [poById, grnForm.purchase_order_id],
  );

  const selectedItemForEditGrnLine = useMemo(
    () => itemById.get(Number(editGrnLineForm.inventory_item_id)),
    [itemById, editGrnLineForm.inventory_item_id],
  );

  const selectedItemForPOLine = useMemo(
    () => itemById.get(Number(poForm.line_item_id)),
    [itemById, poForm.line_item_id],
  );

  const getItemAllowedUomIds = (item: any): number[] => {
    if (!item) return [];
    const configured = Array.isArray(item.baseUomIds) && item.baseUomIds.length > 0
      ? item.baseUomIds
      : [item.baseUomId];
    const normalized = configured
      .map((id: any) => Number(id))
      .filter((id: number) => Number.isInteger(id) && id > 0);
    const unique: number[] = [];
    const seen = new Set<number>();
    for (const id of normalized) {
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(id);
      }
    }
    const primary = Number(item.baseUomId);
    if (Number.isInteger(primary) && primary > 0 && !seen.has(primary)) {
      unique.unshift(primary);
    }
    return unique;
  };

  const getItemAllowedUoms = (item: any, currentUomId?: number | string | null) => {
    const ids = getItemAllowedUomIds(item);
    const current = Number(currentUomId);
    if (Number.isInteger(current) && current > 0 && !ids.includes(current)) {
      ids.push(current);
    }
    const options = ids
      .map((id) => uomById.get(Number(id)))
      .filter(Boolean);
    return options.length > 0 ? options : (uomsQ.data ?? []);
  };

  const getDefaultItemUomId = (item: any): string => {
    const allowed = getItemAllowedUomIds(item);
    return allowed.length > 0 ? String(allowed[0]) : '';
  };

  const formatQtyWithUom = (qty: number | null, uomId?: number | null) => {
    if (qty == null || !Number.isFinite(Number(qty))) return '—';
    const code = uomId != null ? uomById.get(Number(uomId))?.code : null;
    return code ? `${Number(qty)} ${code}` : String(Number(qty));
  };

  const getExpectedForGrnLine = (
    grn: any,
    line: any,
  ): { qty: number | null; uomId: number | null } => {
    const po = grn?.purchaseOrder ?? poById.get(Number(grn?.purchaseOrderId));
    const poLine =
      (po?.lines ?? []).find((l: any) => Number(l.id) === Number(line.purchaseOrderLineId)) ??
      (po?.lines ?? []).find((l: any) => Number(l.inventoryItemId) === Number(line.inventoryItemId));
    const poExpected = poLine?.orderedQty;
    if (poExpected != null && Number.isFinite(Number(poExpected))) {
      return { qty: Number(poExpected), uomId: poLine?.orderedUomId != null ? Number(poLine.orderedUomId) : null };
    }
    const note = String(line?.notes ?? '');
    const match = note.match(/Expected from PO:\s*([0-9.]+)/i);
    if (match?.[1] != null && Number.isFinite(Number(match[1]))) {
      return { qty: Number(match[1]), uomId: null };
    }
    return { qty: null, uomId: null };
  };

  const getReceivedForGrnLine = (line: any): { qty: number; uomId: number | null } => {
    const qty = Number(line?.receivedQty ?? 0);
    const uomIdRaw = line?.receivedUomId ?? line?.received_uom_id;
    const uomId = uomIdRaw != null && Number.isFinite(Number(uomIdRaw)) ? Number(uomIdRaw) : null;
    return { qty, uomId };
  };

  const addSelectedPrItem = (inventoryItemId: number) => {
    const itemId = Number(inventoryItemId);
    if (!Number.isInteger(itemId) || itemId <= 0) {
      toast.error('Please select a product');
      return;
    }
    const item = itemById.get(itemId);
    const uomId = Number(item?.baseUomId);
    if (!Number.isInteger(uomId) || uomId <= 0) {
      toast.error('Missing unit for selected item');
      return;
    }
    setPrForm((prev: any) => {
      const existing = [...(prev.lines ?? [])];
      const idx = existing.findIndex(
        (l: any) =>
          Number(l.inventory_item_id) === itemId &&
          Number(l.requested_uom_id) === uomId,
      );
      if (idx >= 0) {
        return { ...prev, inventory_item_id: '' };
      }
      return {
        ...prev,
        lines: [
          ...existing,
          { inventory_item_id: itemId, requested_qty: 0, requested_uom_id: uomId },
        ],
        inventory_item_id: '',
      };
    });
  };

  const addCurrentPoLine = () => {
    if (!poForm.line_item_id || !poForm.line_qty || !poForm.line_uom_id) {
      toast.error('Please select item, quantity, and unit');
      return;
    }
    const qty = Number(poForm.line_qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      toast.error('Quantity must be a valid number greater than 0');
      return;
    }
    const nextLine = {
      inventory_item_id: Number(poForm.line_item_id),
      ordered_qty: qty,
      ordered_uom_id: Number(poForm.line_uom_id),
    };
    setPoForm((prev: any) => {
      const existing = [...(prev.lines ?? [])];
      const idx = existing.findIndex(
        (l: any) =>
          Number(l.inventory_item_id) === nextLine.inventory_item_id &&
          Number(l.ordered_uom_id) === nextLine.ordered_uom_id,
      );
      if (idx >= 0) {
        existing[idx] = {
          ...existing[idx],
          ordered_qty: Number(existing[idx].ordered_qty ?? 0) + nextLine.ordered_qty,
        };
      } else {
        existing.push(nextLine);
      }
      return { ...prev, lines: existing, line_item_id: '', line_qty: '', line_uom_id: '' };
    });
  };

  const getExpectedForEditGrnLine = (
    line: any,
  ): { qty: number | null; uomId: number | null } => {
    const po = selectedPOForEditGRN;
    const poLines = po?.lines ?? [];
    const poLine =
      poLines.find((l: any) => Number(l.id) === Number(line.purchase_order_line_id)) ??
      poLines.find(
        (l: any) =>
          Number(l.inventoryItemId ?? l.inventory_item_id) === Number(line.inventory_item_id),
      );
    const ordered =
      poLine?.orderedQty ?? poLine?.ordered_qty;
    const orderedUom = poLine?.orderedUomId ?? poLine?.ordered_uom_id;
    if (ordered != null && Number.isFinite(Number(ordered))) {
      return {
        qty: Number(ordered),
        uomId: orderedUom != null ? Number(orderedUom) : null,
      };
    }
    const note = String(line?.notes ?? '');
    const match = note.match(/Expected from PO:\s*([0-9.]+)/i);
    if (match?.[1] != null && Number.isFinite(Number(match[1]))) {
      return { qty: Number(match[1]), uomId: null };
    }
    return { qty: null, uomId: null };
  };

  const addCurrentEditGrnLine = () => {
    if (!editGrnLineForm.inventory_item_id || !editGrnLineForm.received_uom_id) {
      toast.error('Please select item and unit');
      return;
    }
    const receivedQty = Number(editGrnLineForm.received_qty ?? 0);
    if (!Number.isFinite(receivedQty) || receivedQty < 0) {
      toast.error('Received quantity must be a valid number >= 0');
      return;
    }
    if (selectedItemForEditGrnLine?.trackExpiry && receivedQty > 0 && !editGrnLineForm.expiry_date) {
      toast.error('Expiry date is required for this item');
      return;
    }
    if (
      selectedItemForEditGrnLine?.trackLot &&
      receivedQty > 0 &&
      !String(editGrnLineForm.lot_code ?? '').trim()
    ) {
      toast.error('Lot / batch code is required for this item');
      return;
    }
    const poLines = selectedPOForEditGRN?.lines ?? [];
    const poLine =
      poLines.find(
        (l: any) =>
          Number(l.inventoryItemId ?? l.inventory_item_id) ===
            Number(editGrnLineForm.inventory_item_id) &&
          Number(l.orderedUomId ?? l.ordered_uom_id) === Number(editGrnLineForm.received_uom_id),
      ) ??
      poLines.find(
        (l: any) =>
          Number(l.inventoryItemId ?? l.inventory_item_id) ===
          Number(editGrnLineForm.inventory_item_id),
      );
    const nextLine = {
      line_id: undefined,
      purchase_order_line_id: poLine?.id != null ? Number(poLine.id) : null,
      inventory_item_id: Number(editGrnLineForm.inventory_item_id),
      received_qty: receivedQty,
      received_uom_id: Number(editGrnLineForm.received_uom_id),
      lot_code: editGrnLineForm.lot_code || '',
      expiry_date: editGrnLineForm.expiry_date || '',
      location_id: null,
      notes: null,
    };
    setGrnForm((prev: any) => {
      const existing = [...(prev.lines ?? [])];
      const dupIdx = existing.findIndex(
        (l: any) => Number(l.inventory_item_id) === nextLine.inventory_item_id,
      );
      if (dupIdx >= 0) {
        toast.error('This item is already on the receipt — change the quantity on that row.');
        return prev;
      }
      existing.push(nextLine);
      return { ...prev, lines: existing };
    });
    setEditGrnLineForm({
      inventory_item_id: '',
      received_qty: '',
      received_uom_id: '',
      lot_code: '',
      expiry_date: '',
    });
  };

  useEffect(() => {
    if (tab !== 'grns' || !grnIdFromUrl || !grnFromLinkQ.data) return;
    const g = grnFromLinkQ.data as any;
    if (String(g?.status) === 'draft') {
      openEditGRNModal(g);
    } else {
      setSelectedGRN(g);
    }
    setSearchParams((prev) => {
      const n = new URLSearchParams(prev);
      n.delete('grn_id');
      return n;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- open once when linked GRN loads
  }, [tab, grnIdFromUrl, grnFromLinkQ.data, setSearchParams]);

  const openEditPOModal = (po: any) => {
    setPoForm({
      id: String(po.id),
      po_number: po.poNumber ?? '',
      vendor_id: String(po.vendorId ?? ''),
      notes: po.notes ?? '',
      line_item_id: '',
      line_qty: '',
      line_uom_id: '',
      lines: (po.lines ?? []).map((l: any) => ({
        inventory_item_id: Number(l.inventoryItemId),
        ordered_qty: Number(l.orderedQty),
        ordered_uom_id: Number(l.orderedUomId),
      })),
    });
    setIsEditPOOpen(true);
  };

  const openCreatePRModal = () => {
    setPrForm({
      pr_id: '',
      pr_number: '',
      requesting_branch_id: singlePrBranchId,
      requested_from_vendor_id: '',
      inventory_item_id: '',
      requested_qty: '',
      requested_uom_id: '',
      lines: [],
      notes: '',
    });
    setIsCreatePROpen(true);
  };

  useEffect(() => {
    if (!isCreatePROpen) return;
    if (!singlePrBranchId) return;
    setPrForm((prev: any) => {
      if (String(prev.requesting_branch_id ?? '') === String(singlePrBranchId)) {
        return prev;
      }
      return {
        ...prev,
        requesting_branch_id: singlePrBranchId,
        lines: [],
      };
    });
  }, [isCreatePROpen, singlePrBranchId]);

  const openEditPRModal = (pr: any) => {
    setPrForm({
      pr_id: String(pr.id),
      pr_number: pr.prNumber ?? '',
      requesting_branch_id: String(pr.requestingBranchId ?? ''),
      requested_from_vendor_id: String(pr.requestedFromVendorId ?? ''),
      inventory_item_id: '',
      requested_qty: '',
      requested_uom_id: '',
      lines: (pr.lines ?? []).map((l: any) => ({
        inventory_item_id: Number(l.inventoryItemId),
        requested_qty: Number(l.requestedQty),
        requested_uom_id: Number(l.requestedUomId),
      })),
      notes: pr.notes ?? '',
    });
    setIsCreatePROpen(true);
  };

  const validateGrnLinesForDraft = (): boolean => {
    if (!grnForm.grn_id) {
      toast.error('Missing draft receipt');
      return false;
    }
    if (!(grnForm.lines ?? []).length) {
      toast.error('This receipt has no lines');
      return false;
    }
    for (const l of grnForm.lines ?? []) {
      const qty = Number(l.received_qty ?? 0);
      if (!Number.isFinite(qty) || qty < 0) {
        toast.error('Received quantity must be a valid number ≥ 0');
        return false;
      }
      const item = itemById.get(Number(l.inventory_item_id));
      if (item?.trackExpiry && qty > 0 && !String(l.expiry_date ?? '').trim()) {
        toast.error(`Expiry date is required for ${item.name}`);
        return false;
      }
      if (item?.trackLot && qty > 0 && !String(l.lot_code ?? '').trim()) {
        toast.error(`Lot / batch code is required for ${item.name}`);
        return false;
      }
    }
    return true;
  };

  const canPostGrnFromForm = (): boolean => {
    if (!validateGrnLinesForDraft()) return false;
    const anyPositive = (grnForm.lines ?? []).some((l: any) => Number(l.received_qty ?? 0) > 0);
    if (!anyPositive) {
      toast.error('Enter at least one received quantity before posting.');
      return false;
    }
    return true;
  };

  const buildGrnUpdatePayload = () => {
    const trimmedRef = String(grnForm.grn_number ?? '').trim();
    const poItemIds = new Set(
      (selectedPOForEditGRN?.lines ?? []).map((pl: any) =>
        Number(pl.inventoryItemId ?? pl.inventory_item_id),
      ),
    );
    const payload: any = {
      notes: grnForm.notes || null,
      lines: (grnForm.lines ?? []).map((l: any) => ({
        line_id:
          l.line_id == null || Number.isNaN(Number(l.line_id)) ? undefined : Number(l.line_id),
        purchase_order_line_id:
          l.purchase_order_line_id != null ? Number(l.purchase_order_line_id) : null,
        inventory_item_id: Number(l.inventory_item_id),
        received_qty: Number(l.received_qty ?? 0),
        received_uom_id: Number(l.received_uom_id),
        allow_mismatched_item: !poItemIds.has(Number(l.inventory_item_id)),
        lot_code: l.lot_code || null,
        expiry_date: l.expiry_date || null,
        location_id: l.location_id != null ? Number(l.location_id) : null,
        notes: l.notes || null,
      })),
    };
    if (trimmedRef) payload.grn_number = trimmedRef;
    return payload;
  };

  const runConfirmedGrnPost = () => {
    if (confirmPostGrnId == null) return;
    const id = confirmPostGrnId;
    const editingThis = isEditGRNOpen && Number(grnForm.grn_id) === id;
    if (editingThis) {
      if (!canPostGrnFromForm()) return;
      if (!validateGrnLinesForDraft()) return;
      updateGRNM.mutate(
        { id, payload: buildGrnUpdatePayload(), keepOpen: false },
        {
          onSuccess: () => {
            postGRNM.mutate(id);
          },
        },
      );
    } else {
      postGRNM.mutate(id);
    }
  };

  return (
    <div className="space-y-5">
      {tab === 'prs' && (() => {
        const all = (prsQ.data ?? []) as any[];
        const kTotal = all.length;
        const kApproved = all.filter((p) => String(p.status) === 'approved').length;
        const kDrafts = all.filter((p) => String(p.status) === 'draft').length;
        const kQty = all.reduce(
          (s, p) => s + (p.lines ?? []).reduce((a: number, l: any) => a + (Number(l.requestedQty ?? l.requested_qty ?? 0) || 0), 0),
          0,
        );
        const statusTabs = [
          { key: '', label: 'All', count: kTotal },
          { key: 'approved', label: 'Approved', count: kApproved },
          { key: 'draft', label: 'Drafts', count: kDrafts },
        ];
        const totalRows = displayedPrs.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
        const safePage = Math.min(prPage, totalPages);
        const pageRows = displayedPrs.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
        const gridCols = '44px minmax(160px,1.2fr) 150px 140px 64px 80px 150px minmax(120px,1fr) 130px 130px';
        return (
          <>
            <PageHeader
              crumb="Purchase requisitions"
              title="Purchase Requisitions"
              desc="Request stock from a vendor. Once approved, a requisition becomes a purchase order."
              action={
                <button
                  onClick={openCreatePRModal}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 text-sm font-semibold shadow-sm"
                >
                  <LuPlus className="w-4 h-4" /> Create requisition
                </button>
              }
            />
            <StepFlow current={1} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Total requisitions" value={kTotal} hint="All branches" />
              <KpiCard label="Approved" value={kApproved} hint="Ready for PO" dot="#16A34A" />
              <KpiCard label="Drafts" value={kDrafts} hint="Not yet submitted" dot="#D97706" valueColor="#B45309" accent="#F2E2C4" />
              <KpiCard label="Qty requested" value={Number(kQty.toFixed(2))} hint="Units across all PRs" />
            </div>

            <div className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
                <FilterTabs tabs={statusTabs} value={prFilterStatus} onChange={(k) => { setPrFilterStatus(k); setPrPage(1); }} />
                <div className="flex items-center gap-2 flex-wrap">
                  <SearchableSelect value={prFilterBranch} onChange={(v) => { setPrFilterBranch(v); setPrPage(1); }} options={branchFilterOptions} placeholder="All branches" searchPlaceholder="Search branches…" minWidth="w-44" className="w-44" />
                  <div className="relative w-56">
                    <LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input aria-label="Search purchase requisitions" value={prSearchText} onChange={(e) => { setPrSearchText(e.target.value); setPrPage(1); }} placeholder="Search PR, vendor or branch…" className={`${field} pl-9`} />
                  </div>
                  {(prFilterStatus || prFilterBranch || prSearchText) && (
                    <button onClick={() => { setPrFilterStatus(''); setPrFilterBranch(''); setPrSearchText(''); setPrPage(1); }} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Clear filters</button>
                  )}
                </div>
              </div>

              {prsQ.isLoading ? (
                <div className="p-10"><Loader /></div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="grid items-center px-4 py-3 bg-slate-50/70 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700 text-[11.5px] font-bold uppercase tracking-wide text-slate-400 min-w-[1100px]" style={{ gridTemplateColumns: gridCols }}>
                    <div>#</div><div>PR number</div><div>Vendor</div><div>Created by</div><div className="text-right">Items</div><div className="text-right">Qty</div><div>Dates</div><div>Notes</div><div>Status</div><div className="text-right">Actions</div>
                  </div>
                  {pageRows.length === 0 ? (
                    <div className="px-4 py-12 text-center text-slate-400">No purchase requisitions match your filters.</div>
                  ) : pageRows.map((pr: any, idx: number) => {
                    const meta = metaFor(PR_STATUS, pr.status);
                    const qty = (pr.lines ?? []).reduce((sum: number, l: any) => { const q = Number(l.requestedQty ?? l.requested_qty ?? 0); return sum + (Number.isFinite(q) ? q : 0); }, 0);
                    const by = pr.creator?.name ?? (pr.createdBy != null ? `User #${pr.createdBy}` : '—');
                    return (
                      <div key={pr.id} className="grid items-center px-4 py-3 border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-700/30 min-w-[1100px]" style={{ gridTemplateColumns: gridCols, borderLeft: `3px solid ${meta.accent}` }}>
                        <div className="text-[13px] text-slate-400 font-semibold">{(safePage - 1) * PAGE_SIZE + idx + 1}</div>
                        <div className="min-w-0 pr-2">
                          <button onClick={() => setSelectedPR(pr)} className="text-[13px] font-bold font-mono text-red-600 hover:underline truncate block text-left">{pr.prNumber ?? `PR-${pr.id}`}</button>
                          <div className="text-[11.5px] text-slate-400 truncate">{branchById.get(Number(pr.requestingBranchId))?.name ?? '—'}</div>
                        </div>
                        <div className="text-[13.5px] text-slate-700 dark:text-slate-200 truncate pr-2">{vendorById.get(Number(pr.requestedFromVendorId))?.name ?? '—'}</div>
                        <div className="flex items-center gap-2 min-w-0 pr-2">
                          <span className="w-6 h-6 rounded-full bg-slate-800 dark:bg-slate-600 text-white flex items-center justify-center text-[11px] font-bold flex-none uppercase">{by[0] ?? '?'}</span>
                          <span className="text-[12.5px] text-slate-500 dark:text-slate-400 truncate">{by}</span>
                        </div>
                        <div className="text-right text-[13.5px] font-semibold text-slate-900 dark:text-slate-100">{(pr.lines ?? []).length}</div>
                        <div className="text-right text-[13.5px] font-bold text-slate-900 dark:text-slate-100">{Number(qty.toFixed(2))}</div>
                        <div className="text-[12px] text-slate-500 leading-snug">
                          <div>Req {prettyDate(pr.createdAt)}</div>
                          <div style={{ color: pr.approvedAt ? '#0F8A4F' : '#B45309' }}>{pr.approvedAt ? `Approved ${prettyDate(pr.approvedAt)}` : 'Awaiting approval'}</div>
                        </div>
                        <div className={`text-[12.5px] truncate pr-2 ${pr.notes?.trim() ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500 italic'}`} title={pr.notes ?? ''}>{pr.notes?.trim() ? pr.notes : 'No notes'}</div>
                        <div><button type="button" onClick={() => setSelectedPRForStatus(pr)} title="Update status"><StatusPill meta={meta} /></button></div>
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => setSelectedPR(pr)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">View</button>
                          {canEditPRRow(pr) && (
                            <button onClick={() => openEditPRModal(pr)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Edit</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <Pagination shown={pageRows.length} total={totalRows} page={safePage} totalPages={totalPages} onPage={setPrPage} />
                </div>
              )}
            </div>
          </>
        );
      })()}

      {tab === 'pos' && canAccessPOModule && (() => {
        const all = (posQ.data ?? []) as any[];
        const kTotal = all.length;
        const isOpenStatus = (s: string) => ['created', 'sent', 'partially_received'].includes(s);
        const kOpen = all.filter((p) => isOpenStatus(String(p.status))).length;
        const kPartial = all.filter((p) => String(p.status) === 'partially_received').length;
        const kClosed = all.filter((p) => String(p.status) === 'closed').length;
        const statusTabs = [
          { key: '', label: 'All', count: kTotal },
          { key: 'open', label: 'Open', count: kOpen },
          { key: 'partially_received', label: 'Partial', count: kPartial },
          { key: 'closed', label: 'Closed', count: kClosed },
        ];
        const totalRows = displayedPos.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
        const safePage = Math.min(poPage, totalPages);
        const pageRows = displayedPos.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
        const gridCols = 'minmax(190px,1.3fr) 160px 150px minmax(170px,1.2fr) 170px 130px';
        return (
          <>
            <PageHeader
              crumb="Purchase orders"
              title="Purchase Orders"
              desc="Approved requisitions become purchase orders. Track each PO until its goods are received and it closes."
            />
            <StepFlow current={2} />
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
              <KpiCard label="Total POs" value={kTotal} hint="All branches" />
              <KpiCard label="Awaiting delivery" value={kOpen} hint="Created / partial" dot="#D97706" valueColor="#B45309" accent="#F2E2C4" />
              <KpiCard label="Partially received" value={kPartial} hint="Some lines pending" dot="#EA580C" />
              <KpiCard label="Closed" value={kClosed} hint="Fully received" dot="#16A34A" />
            </div>

            <div className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
                <FilterTabs tabs={statusTabs} value={poFilterStatus} onChange={(k) => { setPoFilterStatus(k); setPoPage(1); }} />
                <div className="flex items-center gap-2 flex-wrap">
                  <SearchableSelect value={poFilterBranch} onChange={(v) => { setPoFilterBranch(v); setPoPage(1); }} options={branchFilterOptions} placeholder="All branches" searchPlaceholder="Search branches…" minWidth="w-44" className="w-44" />
                  <div className="relative w-56">
                    <LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input aria-label="Search purchase orders" value={poSearchText} onChange={(e) => { setPoSearchText(e.target.value); setPoPage(1); }} placeholder="Search PO, PR or vendor…" className={`${field} pl-9`} />
                  </div>
                  {(poFilterStatus || poFilterBranch || poSearchText) && (
                    <button onClick={() => { setPoFilterStatus(''); setPoFilterBranch(''); setPoSearchText(''); setPoPage(1); }} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Clear filters</button>
                  )}
                </div>
              </div>

              {posQ.isLoading ? (
                <div className="p-10"><Loader /></div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="grid items-center px-4 py-3 bg-slate-50/70 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700 text-[11.5px] font-bold uppercase tracking-wide text-slate-400 min-w-[1000px]" style={{ gridTemplateColumns: gridCols }}>
                    <div>PO number</div><div>PR reference</div><div>Buyer branch</div><div>Vendor</div><div>Status</div><div className="text-right">Action</div>
                  </div>
                  {pageRows.length === 0 ? (
                    <div className="px-4 py-12 text-center text-slate-400">No purchase orders match your filters.</div>
                  ) : pageRows.map((po: any) => {
                    const meta = metaFor(PO_STATUS, po.status);
                    const editable = String(po.status) === 'created';
                    return (
                      <div key={po.id} className="grid items-center px-4 py-3.5 border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-700/30 min-w-[1000px]" style={{ gridTemplateColumns: gridCols, borderLeft: `3px solid ${meta.accent}` }}>
                        <div className="flex items-center gap-2.5 min-w-0 pr-2">
                          <span className="w-8 h-8 rounded-lg flex items-center justify-center flex-none" style={{ color: meta.color, background: meta.bg }}><LuFileText className="w-4 h-4" /></span>
                          <button onClick={() => setSelectedPO(po)} className="text-[13px] font-bold font-mono text-slate-900 dark:text-slate-100 hover:underline truncate text-left">{po.poNumber}</button>
                        </div>
                        <div className="text-[12.5px] font-semibold font-mono text-red-600 truncate pr-2">{po.purchaseRequisition?.prNumber ?? '—'}</div>
                        <div className="text-[13.5px] text-slate-700 dark:text-slate-200 truncate pr-2">{branchById.get(Number(po.buyerBranchId))?.name ?? '—'}</div>
                        <div className="text-[13.5px] text-slate-700 dark:text-slate-200 truncate pr-2">{vendorById.get(Number(po.vendorId))?.name ?? '—'}</div>
                        <div><StatusPill meta={meta} /></div>
                        <div className="flex gap-1.5 justify-end">
                          <button onClick={() => setSelectedPO(po)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">View</button>
                          <button onClick={() => editable && openEditPOModal(po)} disabled={!editable} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed">Edit</button>
                        </div>
                      </div>
                    );
                  })}
                  <Pagination shown={pageRows.length} total={totalRows} page={safePage} totalPages={totalPages} onPage={setPoPage} />
                </div>
              )}
            </div>
          </>
        );
      })()}

      {tab === 'grns' && (() => {
        const all = (grnsQ.data ?? []) as any[];
        const kTotal = all.length;
        const kDraft = all.filter((g) => String(g.status) === 'draft').length;
        const kPosted = all.filter((g) => String(g.status) === 'posted').length;
        const statusTabs = [
          { key: '', label: 'All', count: kTotal },
          { key: 'draft', label: 'Drafts', count: kDraft },
          { key: 'posted', label: 'Posted', count: kPosted },
        ];
        const totalRows = displayedGrns.length;
        const totalPages = Math.max(1, Math.ceil(totalRows / PAGE_SIZE));
        const safePage = Math.min(grnPage, totalPages);
        const pageRows = displayedGrns.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);
        const gridCols = 'minmax(160px,1.1fr) 150px 160px 150px 70px 120px 230px';
        const steps: [string, string, string][] = [
          ['1', 'Start', 'pick an open PO; we open a draft with every line from that order.'],
          ['2', 'Record', 'type received qty per line; add lot & expiry when the product requires it.'],
          ['3', 'Finish', 'save the draft anytime, then Post to add stock. Use Reverse only if you made a mistake.'],
        ];
        return (
          <>
            <PageHeader
              crumb="Goods receipt notes"
              title="Goods Receipt Notes"
              desc="Record what physically arrives against a PO. Posting a GRN adds the received stock to inventory."
              action={
                <button
                  onClick={() => {
                    setGrnForm({ grn_id: '', grn_number: '', purchase_order_id: '', notes: '', lines: [] });
                    setIsCreateGRNOpen(true);
                  }}
                  className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 text-sm font-semibold shadow-sm"
                >
                  <LuPlus className="w-4 h-4" /> Receive delivery
                </button>
              }
            />
            <StepFlow current={3} />
            <div className="grid grid-cols-1 lg:grid-cols-[1.4fr_1fr] gap-4">
              <div className={`${card} p-5`}>
                <div className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3.5">Receiving in 3 steps</div>
                <div className="space-y-3">
                  {steps.map(([n, t, d]) => (
                    <div key={n} className="flex items-start gap-3">
                      <span className="w-[22px] h-[22px] rounded-full bg-red-50 text-red-600 text-[12px] font-bold flex items-center justify-center flex-none">{n}</span>
                      <div className="text-[13px] text-slate-600 dark:text-slate-300 leading-snug">
                        <strong className="text-slate-900 dark:text-slate-100">{t}</strong> — {d}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              <div className="grid grid-rows-2 gap-4">
                <div className={`${card} p-4 flex items-center justify-between`} style={{ borderColor: '#F2E2C4' }}>
                  <div>
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: '#B45309' }}><span className="w-2 h-2 rounded-full" style={{ background: '#D97706' }} />Draft GRNs</div>
                    <div className="text-xs mt-1" style={{ color: '#C99A55' }}>Not yet posted to stock</div>
                  </div>
                  <div className="text-3xl font-bold" style={{ color: '#B45309' }}>{kDraft}</div>
                </div>
                <div className={`${card} p-4 flex items-center justify-between`}>
                  <div>
                    <div className="flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: '#16A34A' }}><span className="w-2 h-2 rounded-full" style={{ background: '#16A34A' }} />Posted GRNs</div>
                    <div className="text-xs text-slate-400 mt-1">Stock added to inventory</div>
                  </div>
                  <div className="text-3xl font-bold text-slate-900 dark:text-slate-100">{kPosted}</div>
                </div>
              </div>
            </div>

            <div className={`${card} overflow-hidden`}>
              <div className="flex flex-wrap items-center gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
                <FilterTabs tabs={statusTabs} value={grnFilterStatus} onChange={(k) => { setGrnFilterStatus(k); setGrnPage(1); }} />
                <div className="flex items-center gap-2 flex-wrap ml-auto">
                  <input type="date" value={grnFilterFrom} onChange={(e) => { setGrnFilterFrom(e.target.value); setGrnPage(1); }} className={`${field} w-36`} title="From date" />
                  <input type="date" value={grnFilterTo} onChange={(e) => { setGrnFilterTo(e.target.value); setGrnPage(1); }} className={`${field} w-36`} title="To date" />
                  <SearchableSelect value={grnFilterBranch} onChange={(v) => { setGrnFilterBranch(v); setGrnPage(1); }} options={grnBranchFilterOptions} placeholder="All branches" searchPlaceholder="Search branches…" minWidth="w-40" className="w-40" />
                  <div className="relative w-52">
                    <LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input aria-label="Search goods receipt notes" value={grnSearchText} onChange={(e) => { setGrnSearchText(e.target.value); setGrnPage(1); }} placeholder="Search GRN, PO or PR…" className={`${field} pl-9`} />
                  </div>
                  {(grnFilterStatus || grnFilterBranch || grnSearchText || grnFilterFrom || grnFilterTo) && (
                    <button onClick={() => { setGrnFilterStatus(''); setGrnFilterBranch(''); setGrnSearchText(''); setGrnFilterFrom(''); setGrnFilterTo(''); setGrnPage(1); }} className="px-3 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Clear filters</button>
                  )}
                </div>
              </div>

              {grnsQ.isLoading ? (
                <div className="p-10"><Loader /></div>
              ) : (
                <div className="overflow-x-auto">
                  <div className="grid items-center px-4 py-3 bg-slate-50/70 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700 text-[11.5px] font-bold uppercase tracking-wide text-slate-400 min-w-[1000px]" style={{ gridTemplateColumns: gridCols }}>
                    <div>GRN number</div><div>PR reference</div><div>PO number</div><div>Branch</div><div className="text-right">Lines</div><div>Status</div><div className="text-right">Actions</div>
                  </div>
                  {pageRows.length === 0 ? (
                    <div className="px-4 py-12 text-center text-slate-400">No goods receipt notes match your filters.</div>
                  ) : pageRows.map((g: any) => {
                    const meta = metaFor(GRN_STATUS, g.status);
                    const isDraft = String(g.status) === 'draft';
                    const isPosted = String(g.status) === 'posted';
                    return (
                      <div key={g.id} className="grid items-center px-4 py-3.5 border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-700/30 min-w-[1000px]" style={{ gridTemplateColumns: gridCols, borderLeft: `3px solid ${meta.accent}` }}>
                        <button onClick={() => setSelectedGRN(g)} className="text-[13px] font-bold font-mono text-slate-900 dark:text-slate-100 hover:underline truncate text-left pr-2">{g.grnNumber ?? `GRN-${g.id}`}</button>
                        <div className="text-[12.5px] font-semibold font-mono text-red-600 truncate pr-2">{g.purchaseOrder?.purchaseRequisition?.prNumber ?? '—'}</div>
                        <div className="text-[12.5px] font-mono text-slate-600 dark:text-slate-300 truncate pr-2">{g.purchaseOrder?.poNumber ?? poById.get(Number(g.purchaseOrderId))?.poNumber ?? '—'}</div>
                        <div className="text-[13.5px] text-slate-700 dark:text-slate-200 truncate pr-2">{branchById.get(Number(g.branchId))?.name ?? '—'}</div>
                        <div className="text-right text-[13.5px] font-semibold text-slate-900 dark:text-slate-100">{(g.lines ?? []).length}</div>
                        <div><StatusPill meta={meta} /></div>
                        <div className="flex gap-1.5 justify-end flex-wrap">
                          <button onClick={() => setSelectedGRN(g)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">View</button>
                          {isDraft && (
                            <>
                              <button onClick={() => openEditGRNModal(g)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[12px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">Edit</button>
                              <button onClick={() => setConfirmPostGrnId(Number(g.id))} className="px-3 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[12px] font-bold">Post</button>
                            </>
                          )}
                          {isPosted && (
                            <button onClick={() => setConfirmReverseGrnId(Number(g.id))} className="px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50 text-[12px] font-bold">Reverse</button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <Pagination shown={pageRows.length} total={totalRows} page={safePage} totalPages={totalPages} onPage={setGrnPage} />
                </div>
              )}
            </div>
          </>
        );
      })()}

      <Modal
        isOpen={isCreatePROpen}
        onClose={() => setIsCreatePROpen(false)}
        title={prForm.pr_id ? 'Edit Purchase Requisition' : 'Create Purchase Requisition'}
        size="large"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm md:col-span-2">
              <div className="text-xs font-medium text-slate-600 mb-1">PR Reference Number (optional)</div>
              <input
                className="w-full border rounded-lg p-2"
                value={prForm.pr_number}
                onChange={(e) => setPrForm({ ...prForm, pr_number: e.target.value })}
                placeholder="Auto-generated if blank"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Requesting branch</div>
              {availablePrBranches.length === 1 ? (
                <input
                  className="w-full border rounded-lg p-2 bg-slate-50 text-slate-700"
                  value={availablePrBranches[0]?.name ?? '—'}
                  readOnly
                />
              ) : (
                <SearchableSelect
                  value={String(prForm.requesting_branch_id ?? '')}
                  onChange={(v) =>
                    setPrForm({
                      ...prForm,
                      requesting_branch_id: v,
                      lines: [],
                    })
                  }
                  options={prBranchSelectOptions}
                  placeholder="Select branch…"
                  searchPlaceholder="Search branches…"
                  minWidth="w-full"
                  className="w-full"
                />
              )}
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Requested from</div>
              <SearchableSelect
                value={String(prForm.requested_from_vendor_id ?? '')}
                onChange={(v) => setPrForm({ ...prForm, requested_from_vendor_id: v })}
                options={vendorSearchableOptions}
                placeholder="Select supplier/warehouse…"
                searchPlaceholder="Search suppliers…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm md:col-span-2">
              <div className="text-xs font-medium text-slate-600 mb-1">Raw product select</div>
              <SearchableSelect
                value={String(prForm.inventory_item_id ?? '')}
                onChange={(v) => {
                  if (!v) {
                    setPrForm({ ...prForm, inventory_item_id: '' });
                    return;
                  }
                  const id = Number(v);
                  setPrForm((prev: any) => ({ ...prev, inventory_item_id: String(id) }));
                  addSelectedPrItem(id);
                }}
                options={itemsSearchableOptions}
                placeholder={
                  !prForm.requesting_branch_id ? 'Select branch first…' : 'Select product…'
                }
                searchPlaceholder="Search products…"
                minWidth="w-full"
                className="w-full"
                disabled={!prForm.requesting_branch_id}
              />
            </label>
          </div>

          <div className="border rounded-lg">
            <div className="px-3 py-2 text-xs font-medium text-slate-600 border-b">
              Requested products ({(prForm.lines ?? []).length})
            </div>
            {(prForm.lines ?? []).length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500">
                Select a product to add it to the request.
              </div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600">
                    <tr>
                      <th className="py-2 px-3">#</th>
                      <th className="py-2 px-3">Product name</th>
                      <th className="py-2 px-3">Buying price</th>
                      <th className="py-2 px-3">Qty in stock</th>
                      <th className="py-2 px-3">Purchase quantity</th>
                      <th className="py-2 px-3">Unit</th>
                      <th className="py-2 px-3">Remove</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(prForm.lines ?? []).map((l: any, idx: number) => {
                      const item = itemById.get(Number(l.inventory_item_id));
                      const buyPrice = item?.defaultBuyPrice ?? item?.default_buy_price ?? null;
                      const stock = onHandByItemId.get(Number(l.inventory_item_id)) ?? 0;
                      return (
                        <tr key={`${l.inventory_item_id}-${idx}`} className="border-t">
                          <td className="py-2 px-3 text-slate-500">{idx + 1}</td>
                          <td className="py-2 px-3">{item?.name ?? '—'}</td>
                          <td className="py-2 px-3">
                            {(() => {
                              const basePrice = buyPrice == null ? null : Number(buyPrice);
                              if (basePrice == null || !Number.isFinite(basePrice)) return '—';
                              const perOne = getQtyInItemBasePerOne(item, Number(l.requested_uom_id));
                              if (perOne == null || !Number.isFinite(perOne)) return basePrice.toFixed(2);
                              return (basePrice * perOne).toFixed(2);
                            })()}
                          </td>
                          <td className="py-2 px-3">
                            {(() => {
                              const stockBase = Number(stock ?? 0);
                              const perOne = getQtyInItemBasePerOne(item, Number(l.requested_uom_id));
                              if (perOne == null || !Number.isFinite(perOne) || perOne <= 0) {
                                return stockBase.toFixed(2);
                              }
                              return (stockBase / perOne).toFixed(2);
                            })()}
                          </td>
                          <td className="py-2 px-3">
                            <input
                              className="w-28 border rounded-lg p-1.5"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="any"
                              value={l.requested_qty ?? ''}
                              onChange={(e) =>
                                setPrForm((prev: any) => ({
                                  ...prev,
                                  lines: (prev.lines ?? []).map((x: any, i: number) =>
                                    i === idx ? { ...x, requested_qty: e.target.value } : x,
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="py-2 px-3">
                            {(() => {
                              const allowedUoms = getItemAllowedUoms(item, l.requested_uom_id);
                              if ((allowedUoms ?? []).length <= 1) {
                                return (
                                  <span className="inline-flex h-9 items-center">
                                    {uomById.get(Number(l.requested_uom_id))?.code ?? allowedUoms?.[0]?.code ?? '—'}
                                  </span>
                                );
                              }
                              return (
                                <SearchableSelect
                                  value={String(l.requested_uom_id ?? '')}
                                  onChange={(v) => {
                                    const nextUomId = Number(v);
                                    const prevUomId = Number(l.requested_uom_id);
                                    if (!nextUomId || !prevUomId || nextUomId === prevUomId) {
                                      setPrForm((prev: any) => ({
                                        ...prev,
                                        lines: (prev.lines ?? []).map((x: any, i: number) =>
                                          i === idx ? { ...x, requested_uom_id: v } : x,
                                        ),
                                      }));
                                      return;
                                    }
                                    const currentQty = Number(l.requested_qty ?? 0);
                                    const converted = convertQtyBetweenUoms({
                                      qty: Number.isFinite(currentQty) ? currentQty : 0,
                                      item,
                                      fromUomId: prevUomId,
                                      toUomId: nextUomId,
                                    });
                                    setPrForm((prev: any) => ({
                                      ...prev,
                                      lines: (prev.lines ?? []).map((x: any, i: number) =>
                                        i === idx
                                          ? {
                                              ...x,
                                              requested_uom_id: String(nextUomId),
                                              requested_qty:
                                                converted == null || !Number.isFinite(converted)
                                                  ? x.requested_qty
                                                  : converted.toFixed(6).replace(/\.?0+$/, ''),
                                            }
                                          : x,
                                      ),
                                    }));
                                  }}
                                  options={allowedUoms.map((u: any) => ({
                                    value: String(u.id),
                                    label: u.code,
                                  }))}
                                  placeholder="Unit"
                                  searchPlaceholder="Search units…"
                                  minWidth="min-w-[7rem]"
                                  className="w-28"
                                />
                              );
                            })()}
                          </td>
                          <td className="py-2 px-3">
                            <Button
                              variant="secondary"
                              onClick={() =>
                                setPrForm((prev: any) => ({
                                  ...prev,
                                  lines: (prev.lines ?? []).filter((_: any, i: number) => i !== idx),
                                }))
                              }
                            >
                              Remove
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="border-t bg-slate-50">
                      <td className="py-2 px-3 text-right font-medium text-slate-700" colSpan={4}>
                        Total quantity
                      </td>
                      <td className="py-2 px-3 font-medium text-slate-800">
                        {(() => {
                          const sum = (prForm.lines ?? []).reduce((acc: number, x: any) => {
                            const v = Number(x?.requested_qty ?? 0);
                            return acc + (Number.isFinite(v) ? v : 0);
                          }, 0);
                          return sum.toFixed(2);
                        })()}
                      </td>
                      <td className="py-2 px-3" colSpan={2} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          <label className="text-sm block">
            <div className="text-xs font-medium text-slate-600 mb-1">Notes (optional)</div>
            <textarea
              className="w-full border rounded-lg p-2"
              rows={3}
              value={prForm.notes}
              onChange={(e) => setPrForm({ ...prForm, notes: e.target.value })}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsCreatePROpen(false)}>Cancel</Button>
            <Button
              isLoading={createPRM.isPending || updatePRM.isPending}
              onClick={() => {
                let lines = [...(prForm.lines ?? [])]
                  .map((l: any) => ({
                    ...l,
                    requested_qty: Number(l.requested_qty ?? 0),
                    requested_uom_id: Number(l.requested_uom_id),
                    inventory_item_id: Number(l.inventory_item_id),
                  }))
                  .filter((l: any) => Number.isFinite(l.requested_qty) && l.requested_qty > 0);
                if (!prForm.requesting_branch_id || !prForm.requested_from_vendor_id || lines.length === 0) {
                  toast.error('Select branch, vendor, and add at least one item');
                  return;
                }
                const payload = {
                  pr_number: prForm.pr_number?.trim() || undefined,
                  requesting_branch_id: Number(prForm.requesting_branch_id),
                  requested_from_vendor_id: Number(prForm.requested_from_vendor_id),
                  notes: prForm.notes || undefined,
                  lines,
                };
                if (prForm.pr_id) {
                  updatePRM.mutate({ id: Number(prForm.pr_id), payload });
                } else {
                  createPRM.mutate(payload);
                }
              }}
            >
              {prForm.pr_id ? 'Save changes' : 'Create requisition'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isCreateGRNOpen}
        onClose={() => setIsCreateGRNOpen(false)}
        title="Receive delivery"
        size="medium"
      >
        <div className="space-y-3">
          <label className="text-sm block">
            <div className="text-xs font-medium text-slate-600 mb-1">GRN Reference Number (optional)</div>
            <input
              className="w-full border rounded-lg p-2"
              value={grnForm.grn_number}
              onChange={(e) => setGrnForm({ ...grnForm, grn_number: e.target.value })}
              placeholder="Auto-generated if blank"
            />
          </label>
          <SearchableSelect
            label="Open purchase order"
            placeholder="Select PO…"
            searchPlaceholder="Search POs…"
            value={String(grnForm.purchase_order_id ?? '')}
            onChange={(v) => setGrnForm({ ...grnForm, purchase_order_id: v })}
            options={grnPoSearchableOptions}
            minWidth="w-full"
            className="w-full"
            disabled={grnPoSearchableOptions.length === 0}
          />
          {grnPoSearchableOptions.length === 0 ? (
            <div className="text-xs text-slate-500">No open purchase orders. Approve a PR and ensure the PO is not closed.</div>
          ) : null}
          <label className="text-sm block">
            <div className="text-xs font-medium text-slate-600 mb-1">Receiving branch</div>
            <input
              className="w-full border rounded-lg p-2 bg-slate-50"
              value={selectedPOForCreateGRN ? (branchById.get(Number(selectedPOForCreateGRN.buyerBranchId))?.name ?? '') : ''}
              readOnly
            />
          </label>
          <label className="text-sm block">
            <div className="text-xs font-medium text-slate-600 mb-1">Notes (optional)</div>
            <textarea
              className="w-full border rounded-lg p-2"
              rows={2}
              value={grnForm.notes}
              onChange={(e) => setGrnForm({ ...grnForm, notes: e.target.value })}
            />
          </label>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsCreateGRNOpen(false)}>Cancel</Button>
            <Button
              isLoading={createGRNM.isPending}
              disabled={!selectedPOForCreateGRN}
              onClick={() =>
                createGRNM.mutate({
                  grn_number: grnForm.grn_number?.trim() || undefined,
                  purchase_order_id: Number(grnForm.purchase_order_id),
                  branch_id: Number(selectedPOForCreateGRN.buyerBranchId),
                  notes: grnForm.notes || undefined,
                })
              }
            >
              Create draft & continue
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isEditGRNOpen} onClose={() => setIsEditGRNOpen(false)} title="Receive delivery (draft)" size="full">
        <div className="space-y-3 overflow-x-hidden">
          <div className="rounded-lg border border-slate-200 dark:border-slate-600 p-3 bg-slate-50/60 dark:bg-slate-900/30 text-sm">
            <div className="font-semibold text-slate-800 dark:text-slate-100 mb-2">
              1 · Purchase order — 2 · Record what arrived — 3 · Save draft or Post
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-slate-700 dark:text-slate-200">
              <div>
                <span className="text-slate-500">PO:</span>{' '}
                {selectedPOForEditGRN?.poNumber ?? poById.get(Number(grnForm.purchase_order_id))?.poNumber ?? '—'}
              </div>
              <div>
                <span className="text-slate-500">Branch:</span>{' '}
                {selectedPOForEditGRN
                  ? (branchById.get(Number(selectedPOForEditGRN.buyerBranchId))?.name ?? '—')
                  : '—'}
              </div>
              <div>
                <span className="text-slate-500">Vendor:</span>{' '}
                {selectedPOForEditGRN
                  ? (vendorById.get(Number(selectedPOForEditGRN.vendorId))?.name ?? '—')
                  : '—'}
              </div>
            </div>
          </div>
          <label className="text-sm block">
            <div className="text-xs font-medium text-slate-600 mb-1">GRN reference (optional override)</div>
            <input
              className="w-full border rounded-lg p-2"
              value={grnForm.grn_number}
              onChange={(e) => setGrnForm({ ...grnForm, grn_number: e.target.value })}
              placeholder="Leave blank to keep the auto-generated number"
            />
          </label>
          <label className="text-sm block">
            <div className="text-xs font-medium text-slate-600 mb-1">Notes (optional)</div>
            <textarea
              className="w-full border rounded-lg p-2"
              rows={3}
              value={grnForm.notes}
              onChange={(e) => setGrnForm({ ...grnForm, notes: e.target.value })}
            />
          </label>
          <div className="border rounded-lg p-3 bg-slate-50/60 dark:bg-slate-900/30">
            <div className="text-xs font-medium text-slate-600 mb-2">
              Add extra item <span className="font-normal text-slate-500">(not on this PO — only when supplier sent something extra)</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <SearchableSelect
                value={String(editGrnLineForm.inventory_item_id ?? '')}
                onChange={(v) => {
                  const itemId = Number(v);
                  const item = itemById.get(itemId);
                  setEditGrnLineForm((prev: any) => ({
                    ...prev,
                    inventory_item_id: v,
                    received_uom_id: getDefaultItemUomId(item),
                  }));
                }}
                options={grnExtraItemSelectOptions}
                placeholder="Select item…"
                searchPlaceholder="Search items…"
                minWidth="w-full"
                className="w-full"
                disabled={grnExtraItemSelectOptions.length === 0}
              />
              <input
                className="border rounded-lg p-2 text-sm"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                placeholder="Received"
                value={editGrnLineForm.received_qty}
                onChange={(e) => setEditGrnLineForm((prev: any) => ({ ...prev, received_qty: e.target.value }))}
              />
              <SearchableSelect
                value={String(editGrnLineForm.received_uom_id ?? '')}
                onChange={(v) => setEditGrnLineForm((prev: any) => ({ ...prev, received_uom_id: v }))}
                options={getItemAllowedUoms(
                  selectedItemForEditGrnLine,
                  editGrnLineForm.received_uom_id,
                ).map((u: any) => ({ value: String(u.id), label: u.code }))}
                placeholder="Unit…"
                searchPlaceholder="Search units…"
                minWidth="min-w-[7rem]"
                className="w-full"
                disabled={!selectedItemForEditGrnLine}
              />
              <input
                className="border rounded-lg p-2 text-sm"
                placeholder="Lot / batch"
                value={editGrnLineForm.lot_code}
                onChange={(e) => setEditGrnLineForm((prev: any) => ({ ...prev, lot_code: e.target.value }))}
              />
              <div className="flex gap-2">
                <input
                  className="border rounded-lg p-2 text-sm flex-1"
                  type="date"
                  value={editGrnLineForm.expiry_date}
                  onChange={(e) => setEditGrnLineForm((prev: any) => ({ ...prev, expiry_date: e.target.value }))}
                />
                <Button variant="secondary" onClick={addCurrentEditGrnLine}>Add</Button>
              </div>
            </div>
          </div>
          <div className="border rounded-lg">
            <div className="px-3 py-2 text-xs font-medium text-slate-600 border-b">
              Lines from purchase order — enter received quantities
            </div>
            {(grnForm.lines ?? []).length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500">No lines found on this GRN.</div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Item</th>
                      <th className="py-2 px-3">Received qty</th>
                      <th className="py-2 px-3">Unit</th>
                      <th className="py-2 px-3">vs expected</th>
                      <th className="py-2 px-3">Lot / batch</th>
                      <th className="py-2 px-3">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(grnForm.lines ?? []).map((l: any, idx: number) => {
                      const item = itemById.get(Number(l.inventory_item_id));
                      const lineTrackExpiry = !!item?.trackExpiry;
                      const lineTrackLot = !!item?.trackLot;
                      const expected = getExpectedForEditGrnLine(l);
                      const qty = Number(l.received_qty ?? 0);
                      const recvUom = Number(l.received_uom_id);
                      let diffNode: React.ReactNode = '—';
                      if (
                        expected.qty != null &&
                        Number.isFinite(qty) &&
                        expected.uomId != null &&
                        Number.isInteger(recvUom) &&
                        recvUom > 0
                      ) {
                        if (expected.uomId === recvUom) {
                          const d = qty - Number(expected.qty);
                          diffNode =
                            d === 0 ? (
                              <span className="text-emerald-700 dark:text-emerald-400 font-medium">0</span>
                            ) : (
                              <span className={d > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}>
                                {d > 0 ? `+${d}` : d}
                              </span>
                            );
                        } else if (item) {
                          const conv = convertQtyBetweenUoms({
                            qty: Number(expected.qty),
                            item,
                            fromUomId: expected.uomId,
                            toUomId: recvUom,
                          });
                          if (conv != null) {
                            const d = qty - conv;
                            diffNode =
                              d === 0 ? (
                                <span className="text-emerald-700 dark:text-emerald-400 font-medium">0</span>
                              ) : (
                                <span className={d > 0 ? 'text-amber-700 dark:text-amber-300' : 'text-rose-700 dark:text-rose-300'}>
                                  {d > 0 ? `+${d}` : d}
                                </span>
                              );
                          } else {
                            diffNode = <span className="text-xs text-slate-500">UOM</span>;
                          }
                        }
                      }
                      return (
                        <tr key={l.line_id ?? idx} className="border-t">
                          <td className="py-2 px-3">
                            <div>{item?.name ?? '—'}</div>
                          </td>
                          <td className="py-2 px-3">
                            <div className="text-[10px] text-slate-500 mb-1">
                              PO expected: {formatQtyWithUom(expected.qty, expected.uomId)}
                            </div>
                            <input
                              className="w-28 border rounded-lg p-1.5"
                              type="number"
                              inputMode="decimal"
                              min="0"
                              step="any"
                              value={l.received_qty ?? ''}
                              onChange={(e) =>
                                setGrnForm((prev: any) => ({
                                  ...prev,
                                  lines: (prev.lines ?? []).map((x: any, i: number) =>
                                    i === idx ? { ...x, received_qty: e.target.value } : x,
                                  ),
                                }))
                              }
                            />
                          </td>
                          <td className="py-2 px-3">
                            <SearchableSelect
                              value={String(l.received_uom_id ?? '')}
                              onChange={(v) =>
                                setGrnForm((prev: any) => ({
                                  ...prev,
                                  lines: (prev.lines ?? []).map((x: any, i: number) =>
                                    i === idx ? { ...x, received_uom_id: v } : x,
                                  ),
                                }))
                              }
                              options={getItemAllowedUoms(item, l.received_uom_id).map((u: any) => ({
                                value: String(u.id),
                                label: u.code,
                              }))}
                              placeholder="Unit"
                              searchPlaceholder="Search units…"
                              minWidth="min-w-[7rem]"
                              className="w-28"
                            />
                          </td>
                          <td className="py-2 px-3 text-sm">{diffNode}</td>
                          <td className="py-2 px-3">
                            <input
                              className="w-32 border rounded-lg p-1.5"
                              value={l.lot_code ?? ''}
                              onChange={(e) =>
                                setGrnForm((prev: any) => ({
                                  ...prev,
                                  lines: (prev.lines ?? []).map((x: any, i: number) =>
                                    i === idx ? { ...x, lot_code: e.target.value } : x,
                                  ),
                                }))
                              }
                            />
                            {lineTrackLot && (
                              <div className="text-[10px] text-amber-700 mt-1">Required when qty &gt; 0</div>
                            )}
                          </td>
                          <td className="py-2 px-3">
                            <input
                              className="w-40 border rounded-lg p-1.5"
                              type="date"
                              value={l.expiry_date ?? ''}
                              onChange={(e) =>
                                setGrnForm((prev: any) => ({
                                  ...prev,
                                  lines: (prev.lines ?? []).map((x: any, i: number) =>
                                    i === idx ? { ...x, expiry_date: e.target.value } : x,
                                  ),
                                }))
                              }
                            />
                            {lineTrackExpiry && (
                              <div className="text-[10px] text-amber-700 mt-1">Required when qty &gt; 0</div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsEditGRNOpen(false)}>Close</Button>
            <Button
              variant="secondary"
              isLoading={updateGRNM.isPending}
              disabled={updateGRNM.isPending || postGRNM.isPending}
              onClick={() => {
                const id = Number(grnForm.grn_id);
                if (!Number.isInteger(id) || id <= 0) {
                  toast.error('No draft to save');
                  return;
                }
                if (updateGRNM.isPending) return;
                if (!validateGrnLinesForDraft()) return;
                // Close the modal on save so a slow save can't be clicked
                // repeatedly (which previously created duplicate GRN data).
                updateGRNM.mutate({
                  id,
                  payload: buildGrnUpdatePayload(),
                  keepOpen: false,
                });
              }}
            >
              Save draft
            </Button>
            <Button
              isLoading={updateGRNM.isPending || postGRNM.isPending}
              disabled={updateGRNM.isPending || postGRNM.isPending}
              onClick={() => {
                if (!canPostGrnFromForm()) return;
                setConfirmPostGrnId(Number(grnForm.grn_id));
              }}
            >
              Post GRN…
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isEditPOOpen} onClose={() => setIsEditPOOpen(false)} title="Edit Purchase Order" size="xlarge">
        <div className="space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">PO Number</div>
              <input
                className="w-full border rounded-lg p-2"
                value={poForm.po_number ?? ''}
                onChange={(e) => setPoForm({ ...poForm, po_number: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Vendor</div>
              <SearchableSelect
                value={String(poForm.vendor_id ?? '')}
                onChange={(v) => setPoForm({ ...poForm, vendor_id: v })}
                options={vendorSearchableOptions}
                placeholder="Select supplier/warehouse…"
                searchPlaceholder="Search suppliers…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
            <label className="text-sm md:col-span-2">
              <div className="text-xs font-medium text-slate-600 mb-1">Notes (optional)</div>
              <textarea
                className="w-full border rounded-lg p-2"
                rows={2}
                value={poForm.notes ?? ''}
                onChange={(e) => setPoForm({ ...poForm, notes: e.target.value })}
              />
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Item to add</div>
              <SearchableSelect
                value={String(poForm.line_item_id ?? '')}
                onChange={(v) => {
                  const itemId = Number(v);
                  const item = itemById.get(itemId);
                  setPoForm({
                    ...poForm,
                    line_item_id: v,
                    line_uom_id: getDefaultItemUomId(item),
                  });
                }}
                options={itemsSearchableOptions}
                placeholder="Select item…"
                searchPlaceholder="Search items…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Quantity to add</div>
              <input
                className="w-full border rounded-lg p-2"
                type="number"
                inputMode="decimal"
                min="0"
                step="any"
                value={poForm.line_qty ?? ''}
                onChange={(e) => setPoForm({ ...poForm, line_qty: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Unit for item</div>
              <SearchableSelect
                value={String(poForm.line_uom_id ?? '')}
                onChange={(v) => setPoForm({ ...poForm, line_uom_id: v })}
                options={getItemAllowedUoms(selectedItemForPOLine, poForm.line_uom_id).map((u: any) => ({
                  value: String(u.id),
                  label: u.code,
                }))}
                placeholder="Select unit…"
                searchPlaceholder="Search units…"
                minWidth="w-full"
                className="w-full"
                disabled={!selectedItemForPOLine}
              />
            </label>
            <div className="flex items-end">
              <Button variant="secondary" onClick={addCurrentPoLine}>Add item</Button>
            </div>
          </div>

          <div className="border rounded-lg">
            <div className="px-3 py-2 text-xs font-medium text-slate-600 border-b">
              PO lines ({(poForm.lines ?? []).length})
            </div>
            {(poForm.lines ?? []).length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500">No items added yet.</div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Item</th>
                      <th className="py-2 px-3">Qty</th>
                      <th className="py-2 px-3">Unit</th>
                      <th className="py-2 px-3">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(poForm.lines ?? []).map((l: any, idx: number) => (
                      <tr key={`${l.inventory_item_id}-${idx}`} className="border-t">
                        <td className="py-2 px-3">{itemById.get(Number(l.inventory_item_id))?.name ?? '—'}</td>
                        <td className="py-2 px-3">{Number(l.ordered_qty)}</td>
                        <td className="py-2 px-3">{uomById.get(Number(l.ordered_uom_id))?.code ?? '—'}</td>
                        <td className="py-2 px-3">
                          <Button
                            variant="secondary"
                            onClick={() =>
                              setPoForm((prev: any) => ({
                                ...prev,
                                lines: (prev.lines ?? []).filter((_: any, i: number) => i !== idx),
                              }))
                            }
                          >
                            Remove
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
          <div className="text-xs text-slate-500">
            PO is editable only in created status and before any GRN is created.
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsEditPOOpen(false)}>Cancel</Button>
            <Button
              isLoading={updatePOM.isPending}
              onClick={() => {
                if (!poForm.id || !poForm.po_number || !poForm.vendor_id || !(poForm.lines ?? []).length) {
                  toast.error('Fill PO number, vendor, and at least one line');
                  return;
                }
                updatePOM.mutate({
                  id: Number(poForm.id),
                  payload: {
                    po_number: String(poForm.po_number),
                    vendor_id: Number(poForm.vendor_id),
                    notes: poForm.notes || undefined,
                    lines: (poForm.lines ?? []).map((l: any) => ({
                      inventory_item_id: Number(l.inventory_item_id),
                      ordered_qty: Number(l.ordered_qty),
                      ordered_uom_id: Number(l.ordered_uom_id),
                    })),
                  },
                });
              }}
            >
              Save changes
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={!!selectedPR} onClose={() => setSelectedPR(null)} title="Purchase Requisition Details" size="xlarge">
        {!selectedPR ? null : (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div><span className="text-slate-500">PR Number:</span> {selectedPR.prNumber ?? `PR-${selectedPR.id}`}</div>
              <div><span className="text-slate-500">Requesting branch:</span> {branchById.get(Number(selectedPR.requestingBranchId))?.name ?? '—'}</div>
              <div><span className="text-slate-500">Requested from:</span> {vendorById.get(Number(selectedPR.requestedFromVendorId))?.name ?? '—'}</div>
              <div><span className="text-slate-500">Created by:</span> {selectedPR.creator?.name ?? (selectedPR.createdBy != null ? `User #${selectedPR.createdBy}` : '—')}</div>
              <div>
                <span className="text-slate-500">Status:</span>{' '}
                <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${statusClass(selectedPR.status)}`}>
                  {prettyStatus(selectedPR.status)}
                </span>
              </div>
              <div><span className="text-slate-500">Request date:</span> {prettyDate(selectedPR.createdAt)}</div>
              <div><span className="text-slate-500">Approve date:</span> {prettyDate(selectedPR.approvedAt)}</div>
              <div><span className="text-slate-500">Items:</span> {(selectedPR.lines ?? []).length}</div>
              <div>
                <span className="text-slate-500">Total quantity:</span>{' '}
                {(selectedPR.lines ?? []).reduce((sum: number, l: any) => {
                  const qty = Number(l.requestedQty ?? l.requested_qty ?? 0);
                  return sum + (Number.isFinite(qty) ? qty : 0);
                }, 0)}
              </div>
            </div>
            <div className="border rounded-lg p-3 bg-slate-50/60 dark:bg-slate-900/30">
              <div className="text-xs font-medium text-slate-600 mb-1">Notes</div>
              <div className="text-sm text-slate-700 dark:text-slate-200 whitespace-pre-wrap">
                {selectedPR.notes?.trim() ? selectedPR.notes : '—'}
              </div>
            </div>
            <div className="overflow-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Item</th>
                    <th className="py-2 px-3">Requested qty</th>
                    <th className="py-2 px-3">UOM</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedPR.lines ?? []).map((l: any, idx: number) => (
                    <tr key={l.id} className="border-t">
                      <td className="py-2 px-3 text-slate-500">{idx + 1}</td>
                      <td className="py-2 px-3">{itemById.get(Number(l.inventoryItemId))?.name ?? '—'}</td>
                      <td className="py-2 px-3">{Number(l.requestedQty)}</td>
                      <td className="py-2 px-3">{uomById.get(Number(l.requestedUomId))?.code ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={!!selectedPRForStatus}
        onClose={() => setSelectedPRForStatus(null)}
        title="Update Requisition Status"
        size="medium"
      >
        {!selectedPRForStatus ? null : (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div><span className="text-slate-500">PR Number:</span> {selectedPRForStatus.prNumber ?? `PR-${selectedPRForStatus.id}`}</div>
              <div><span className="text-slate-500">Current status:</span> {prettyStatus(selectedPRForStatus.status)}</div>
            </div>

            <div className="rounded-lg border p-3 bg-slate-50/60 dark:bg-slate-900/30">
              <div className="text-xs font-medium text-slate-600 mb-2">Available actions</div>
              <div className="flex flex-wrap gap-2">
                {canSubmitPRRow(selectedPRForStatus) && (
                  <Button
                    isLoading={submitPRM.isPending}
                    onClick={() =>
                      submitPRM.mutate(selectedPRForStatus.id, {
                        onSuccess: () => {
                          setSelectedPRForStatus(null);
                        },
                      })
                    }
                  >
                    Submit
                  </Button>
                )}
                {canApprovePRRow(selectedPRForStatus) && (
                  <Button
                    isLoading={approvePRM.isPending}
                    onClick={() =>
                      approvePRM.mutate(selectedPRForStatus.id, {
                        onSuccess: () => {
                          setSelectedPRForStatus(null);
                        },
                      })
                    }
                  >
                    Approve
                  </Button>
                )}
                {!canSubmitPRRow(selectedPRForStatus) && !canApprovePRRow(selectedPRForStatus) && (
                  <div className="text-xs text-slate-500">
                    No status update action available for your role or this status.
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <Button variant="secondary" onClick={() => setSelectedPRForStatus(null)}>
                Close
              </Button>
            </div>
          </div>
        )}
      </Modal>

      <Modal isOpen={!!selectedPO} onClose={() => setSelectedPO(null)} title="Purchase Order Details" size="xlarge">
        {!selectedPO ? null : (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
              <div><span className="text-slate-500">PO Number:</span> {selectedPO.poNumber}</div>
              <div><span className="text-slate-500">PR Reference:</span> {selectedPO.purchaseRequisition?.prNumber ?? '—'}</div>
              <div><span className="text-slate-500">Buyer branch:</span> {branchById.get(Number(selectedPO.buyerBranchId))?.name ?? '—'}</div>
              <div><span className="text-slate-500">Vendor:</span> {vendorById.get(Number(selectedPO.vendorId))?.name ?? '—'}</div>
              <div><span className="text-slate-500">Status:</span> <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${statusClass(selectedPO.status)}`}>{selectedPO.status}</span></div>
            </div>
            <div className="overflow-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Item</th>
                    <th className="py-2 px-3">Ordered qty</th>
                    <th className="py-2 px-3">UOM</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedPO.lines ?? []).map((l: any) => (
                    <tr key={l.id} className="border-t">
                      <td className="py-2 px-3">{itemById.get(Number(l.inventoryItemId))?.name ?? '—'}</td>
                      <td className="py-2 px-3">{Number(l.orderedQty)}</td>
                      <td className="py-2 px-3">{uomById.get(Number(l.orderedUomId))?.code ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={confirmPostGrnId != null}
        onClose={() => setConfirmPostGrnId(null)}
        title="Post this receipt to inventory?"
        size="medium"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          On-hand stock will increase from this goods receipt. If this screen is open in the editor for this GRN, your
          current line entries are saved first. Otherwise make sure the draft was saved before posting from the list.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setConfirmPostGrnId(null)}>Cancel</Button>
          <Button
            isLoading={updateGRNM.isPending || postGRNM.isPending}
            onClick={runConfirmedGrnPost}
          >
            Post to inventory
          </Button>
        </div>
      </Modal>

      <Modal
        isOpen={confirmReverseGrnId != null}
        onClose={() => setConfirmReverseGrnId(null)}
        title="Reverse this receipt?"
        size="medium"
      >
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Inventory will be reduced and this GRN marked reversed. This fails if stock from these batches was already
          moved or consumed.
        </p>
        <div className="flex justify-end gap-2 mt-4">
          <Button variant="secondary" onClick={() => setConfirmReverseGrnId(null)}>Cancel</Button>
          <Button
            isLoading={reverseGRNM.isPending}
            onClick={() => {
              if (confirmReverseGrnId != null) reverseGRNM.mutate(confirmReverseGrnId);
            }}
          >
            Reverse receipt
          </Button>
        </div>
      </Modal>

      <Modal isOpen={!!selectedGRN} onClose={() => setSelectedGRN(null)} title="Goods Receipt Details" size="xlarge">
        {!selectedGRN ? null : (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3">
              <div><span className="text-slate-500">GRN Number:</span> {selectedGRN.grnNumber ?? `GRN-${selectedGRN.id}`}</div>
              <div><span className="text-slate-500">PR Reference:</span> {selectedGRN.purchaseOrder?.purchaseRequisition?.prNumber ?? '—'}</div>
              <div><span className="text-slate-500">PO Number:</span> {selectedGRN.purchaseOrder?.poNumber ?? poById.get(Number(selectedGRN.purchaseOrderId))?.poNumber ?? '—'}</div>
              <div><span className="text-slate-500">Receiving branch:</span> {branchById.get(Number(selectedGRN.branchId))?.name ?? '—'}</div>
              <div><span className="text-slate-500">Created:</span> {prettyDate(selectedGRN.createdAt)}</div>
              <div><span className="text-slate-500">Status:</span> <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${statusClass(selectedGRN.status)}`}>{selectedGRN.status}</span></div>
            </div>
            <div className="overflow-auto border rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600">
                  <tr>
                    <th className="py-2 px-3">Item</th>
                    <th className="py-2 px-3">Expected</th>
                    <th className="py-2 px-3">Received</th>
                    <th className="py-2 px-3">Difference</th>
                    <th className="py-2 px-3">UOM</th>
                    <th className="py-2 px-3">Expiry</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedGRN.lines ?? []).map((l: any) => {
                    const expected = getExpectedForGrnLine(selectedGRN, l);
                    const received = getReceivedForGrnLine(l);
                    const canDiff =
                      expected.qty != null &&
                      (expected.uomId == null || received.uomId == null || expected.uomId === received.uomId);
                    const diff = canDiff ? Number(received.qty) - Number(expected.qty) : null;
                    return (
                      <tr key={l.id} className="border-t">
                        <td className="py-2 px-3">{itemById.get(Number(l.inventoryItemId))?.name ?? '—'}</td>
                        <td className="py-2 px-3">{formatQtyWithUom(expected.qty, expected.uomId)}</td>
                        <td className="py-2 px-3">{formatQtyWithUom(received.qty, received.uomId)}</td>
                        <td className="py-2 px-3">
                          {!canDiff ? (
                            <span className="text-xs text-slate-500">UOM differs</span>
                          ) : diff == null ? (
                            '—'
                          ) : diff === 0 ? (
                            <span className="font-medium text-emerald-700">0</span>
                          ) : (
                            <span className={diff > 0 ? 'font-medium text-amber-700' : 'font-medium text-rose-700'}>
                              {diff > 0 ? `+${diff}` : diff}
                            </span>
                          )}
                        </td>
                        <td className="py-2 px-3">{uomById.get(Number(received.uomId))?.code ?? '—'}</td>
                        <td className="py-2 px-3">{l.expiryDate ?? '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Procurement;

