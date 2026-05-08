import React, { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Loader from '../../../components/Loader';
import Button from '../../../components/Button';
import Modal from '../../../components/Modal';
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

const Procurement: React.FC<{ initialTab?: ProcurementTabKey; showTabs?: boolean }> = ({
  initialTab = 'prs',
  showTabs = true,
}) => {
  const { user } = useAuth();
  const queryClient = useQueryClient();
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
  const [isAddGRNLineOpen, setIsAddGRNLineOpen] = useState(false);

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

  const [lineForm, setLineForm] = useState<any>({
    grn_id: '',
    inventory_item_id: '',
    received_qty: '',
    received_uom_id: '',
    lot_code: '',
    expiry_date: '',
  });
  const [editGrnLineForm, setEditGrnLineForm] = useState<any>({
    inventory_item_id: '',
    received_qty: '',
    received_uom_id: '',
    lot_code: '',
    expiry_date: '',
  });

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
  const grnsQ = useQuery({
    queryKey: ['procurement-grns'],
    queryFn: procurementService.listGRNs,
    enabled: tab === 'grns',
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
      toast.success('Draft GRN created');
      if (created?.id != null) {
        setLineForm((prev: any) => ({ ...prev, grn_id: String(created.id) }));
      }
      setIsCreateGRNOpen(false);
      setGrnForm({ grn_id: '', grn_number: '', purchase_order_id: '', notes: '', lines: [] });
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create GRN')),
  });

  const updateGRNM = useMutation({
    mutationFn: (data: {
      id: number;
      payload: {
        grn_number?: string;
        notes?: string | null;
        lines?: Array<{
          line_id?: number;
          purchase_order_line_id?: number | null;
          inventory_item_id: number;
          received_qty: number;
          received_uom_id: number;
          lot_code?: string | null;
          expiry_date?: string | null;
          location_id?: number | null;
          notes?: string | null;
        }>;
      };
    }) => procurementService.updateGRN(data.id, data.payload),
    onSuccess: async () => {
      toast.success('Draft GRN updated');
      setIsEditGRNOpen(false);
      setGrnForm({ grn_id: '', grn_number: '', purchase_order_id: '', notes: '', lines: [] });
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to update GRN')),
  });

  const addGRNLineM = useMutation({
    mutationFn: (data: { grnId: number; line: any }) => procurementService.addGRNLine(data.grnId, data.line),
    onSuccess: async () => {
      toast.success('Received line added');
      setIsAddGRNLineOpen(false);
      setLineForm((prev: any) => ({
        ...prev,
        inventory_item_id: '',
        received_qty: '',
        received_uom_id: '',
        lot_code: '',
        expiry_date: '',
      }));
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to add line')),
  });

  const postGRNM = useMutation({
    mutationFn: (id: number) => procurementService.postGRN(id),
    onSuccess: async () => {
      toast.success('GRN posted');
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand'] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to post GRN')),
  });

  const reverseGRNM = useMutation({
    mutationFn: (id: number) => procurementService.reverseGRN(id),
    onSuccess: async () => {
      toast.success('GRN reversed');
      await queryClient.invalidateQueries({ queryKey: ['procurement-grns'] });
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

  const draftGRNs = useMemo(
    () => (grnsQ.data ?? []).filter((g: any) => g.status === 'draft'),
    [grnsQ.data],
  );

  const selectedPOForCreateGRN = useMemo(
    () => poById.get(Number(grnForm.purchase_order_id)),
    [poById, grnForm.purchase_order_id],
  );
  const selectedPOForEditGRN = useMemo(
    () => poById.get(Number(grnForm.purchase_order_id)),
    [poById, grnForm.purchase_order_id],
  );

  const selectedItemForLine = useMemo(
    () => itemById.get(Number(lineForm.inventory_item_id)),
    [itemById, lineForm.inventory_item_id],
  );
  const selectedItemForEditGrnLine = useMemo(
    () => itemById.get(Number(editGrnLineForm.inventory_item_id)),
    [itemById, editGrnLineForm.inventory_item_id],
  );

  const selectedDraftGrn = useMemo(
    () => (grnsQ.data ?? []).find((g: any) => Number(g.id) === Number(lineForm.grn_id)),
    [grnsQ.data, lineForm.grn_id],
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
    const poLine =
      (po?.lines ?? []).find((l: any) => Number(l.id) === Number(line.purchase_order_line_id)) ??
      (po?.lines ?? []).find((l: any) => Number(l.inventoryItemId) === Number(line.inventory_item_id));
    if (poLine?.orderedQty != null && Number.isFinite(Number(poLine.orderedQty))) {
      return {
        qty: Number(poLine.orderedQty),
        uomId: poLine?.orderedUomId != null ? Number(poLine.orderedUomId) : null,
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
    const poLine =
      (selectedPOForEditGRN?.lines ?? []).find(
        (l: any) =>
          Number(l.inventoryItemId) === Number(editGrnLineForm.inventory_item_id) &&
          Number(l.orderedUomId) === Number(editGrnLineForm.received_uom_id),
      ) ??
      (selectedPOForEditGRN?.lines ?? []).find(
        (l: any) => Number(l.inventoryItemId) === Number(editGrnLineForm.inventory_item_id),
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
      const idx = existing.findIndex(
        (l: any) =>
          Number(l.inventory_item_id) === nextLine.inventory_item_id &&
          Number(l.received_uom_id) === nextLine.received_uom_id,
      );
      if (idx >= 0 && (existing[idx].line_id == null || Number(existing[idx].line_id) <= 0)) {
        existing[idx] = {
          ...existing[idx],
          received_qty: Number(existing[idx].received_qty ?? 0) + nextLine.received_qty,
          received_uom_id: nextLine.received_uom_id,
          lot_code: nextLine.lot_code,
          expiry_date: nextLine.expiry_date,
        };
      } else {
        existing.push(nextLine);
      }
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

  const openEditGRNModal = (grn: any) => {
    setGrnForm({
      grn_id: String(grn.id),
      grn_number: grn.grnNumber ?? '',
      purchase_order_id: String(grn.purchaseOrderId ?? ''),
      notes: grn.notes ?? '',
      lines: (grn.lines ?? []).map((l: any) => ({
        line_id: Number(l.id),
        purchase_order_line_id: l.purchaseOrderLineId != null ? Number(l.purchaseOrderLineId) : null,
        inventory_item_id: Number(l.inventoryItemId),
        received_qty: Number(l.receivedQty ?? 0),
        received_uom_id: Number(l.receivedUomId),
        lot_code: l.lotCode ?? '',
        expiry_date: l.expiryDate ?? '',
        location_id: l.locationId ?? null,
        notes: l.notes ?? '',
      })),
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">Procurement</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Request stock, track approved purchase orders, and receive deliveries into inventory.
        </p>
      </div>

      <Card>
        <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
          <div className="font-semibold text-slate-800 dark:text-slate-100">How branch managers should use this</div>
          <ol className="list-decimal pl-5 space-y-1 text-slate-600 dark:text-slate-300">
            <li>Create and submit a purchase requisition from your branch.</li>
            <li>Once approved, watch the purchase order status in Purchase orders.</li>
            <li>Create a draft GRN, review expected lines, add received quantities, then post.</li>
          </ol>
        </div>
      </Card>

      {showTabs && (
        <div className="flex flex-wrap gap-2">
          {[
            { k: 'prs', label: 'Purchase requisitions' },
            { k: 'grns', label: 'Goods receipt notes' },
            ...(canAccessPOModule
              ? [{ k: 'pos', label: 'Purchase orders' } as const]
              : []),
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k as ProcurementTabKey)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                tab === (t.k as ProcurementTabKey)
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'prs' && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Purchase requisitions</h2>
            <Button onClick={openCreatePRModal}>Create requisition</Button>
          </div>

          {prsQ.isLoading ? (
            <Loader />
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-2 pr-4">#</th>
                    <th className="py-2 pr-4">PR Number</th>
                    <th className="py-2 pr-4">Requesting branch</th>
                    <th className="py-2 pr-4">Requested from</th>
                    <th className="py-2 pr-4">Created by</th>
                    <th className="py-2 pr-4">Items</th>
                    <th className="py-2 pr-4">Qty total</th>
                    <th className="py-2 pr-4">Request date</th>
                    <th className="py-2 pr-4">Approve date</th>
                    <th className="py-2 pr-4">Notes</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 dark:text-slate-200">
                  {(prsQ.data ?? []).map((pr: any, idx: number) => (
                    <tr key={pr.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 pr-4">{idx + 1}</td>
                      <td className="py-2 pr-4 font-medium">{pr.prNumber ?? `PR-${pr.id}`}</td>
                      <td className="py-2 pr-4">{branchById.get(Number(pr.requestingBranchId))?.name ?? '—'}</td>
                      <td className="py-2 pr-4">{vendorById.get(Number(pr.requestedFromVendorId))?.name ?? '—'}</td>
                      <td className="py-2 pr-4">{pr.creator?.name ?? (pr.createdBy != null ? `User #${pr.createdBy}` : '—')}</td>
                      <td className="py-2 pr-4">{(pr.lines ?? []).length}</td>
                      <td className="py-2 pr-4">
                        {(pr.lines ?? []).reduce((sum: number, l: any) => {
                          const qty = Number(l.requestedQty ?? l.requested_qty ?? 0);
                          return sum + (Number.isFinite(qty) ? qty : 0);
                        }, 0)}
                      </td>
                      <td className="py-2 pr-4">{prettyDate(pr.createdAt)}</td>
                      <td className="py-2 pr-4">{prettyDate(pr.approvedAt)}</td>
                      <td className="py-2 pr-4 max-w-[200px] truncate" title={pr.notes ?? ''}>
                        {pr.notes?.trim() ? pr.notes : '—'}
                      </td>
                      <td className="py-2 pr-4">
                        <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${statusClass(pr.status)}`}>
                          <button
                            type="button"
                            className="cursor-pointer"
                            onClick={() => setSelectedPRForStatus(pr)}
                          >
                            {prettyStatus(pr.status)}
                          </button>
                        </span>
                      </td>
                      <td className="py-2 pr-4">
                        <div className="flex flex-wrap gap-1">
                        <Button size="small" variant="secondary" onClick={() => setSelectedPR(pr)}>View</Button>
                        {canEditPRRow(pr) && (
                          <Button
                            size="small"
                            variant="secondary"
                            onClick={() => openEditPRModal(pr)}
                          >
                            Edit
                          </Button>
                        )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'pos' && canAccessPOModule && (
        <Card>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Purchase orders</h2>
          {posQ.isLoading ? (
            <Loader />
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-2 pr-4">PO Number</th>
                    <th className="py-2 pr-4">PR Reference</th>
                    <th className="py-2 pr-4">Buyer branch</th>
                    <th className="py-2 pr-4">Vendor</th>
                    <th className="py-2 pr-4">Status</th>
                    <th className="py-2 pr-4">Action</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 dark:text-slate-200">
                  {(posQ.data ?? []).map((po: any) => (
                    <tr key={po.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 pr-4 font-medium">{po.poNumber}</td>
                      <td className="py-2 pr-4">{po.purchaseRequisition?.prNumber ?? '—'}</td>
                      <td className="py-2 pr-4">{branchById.get(Number(po.buyerBranchId))?.name ?? '—'}</td>
                      <td className="py-2 pr-4">{vendorById.get(Number(po.vendorId))?.name ?? '—'}</td>
                      <td className="py-2 pr-4">
                        <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${statusClass(po.status)}`}>
                          {po.status}
                        </span>
                      </td>
                      <td className="py-2 pr-4 flex gap-2">
                        <Button variant="secondary" onClick={() => setSelectedPO(po)}>View</Button>
                        <Button
                          variant="secondary"
                          disabled={po.status !== 'created'}
                          onClick={() => openEditPOModal(po)}
                        >
                          Edit
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      )}

      {tab === 'grns' && (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                onClick={() => {
                  setGrnForm({ grn_id: '', grn_number: '', purchase_order_id: '', notes: '', lines: [] });
                  setIsCreateGRNOpen(true);
                }}
              >
                Create draft GRN
              </Button>
              <select
                className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 min-w-[260px]"
                value={lineForm.grn_id ?? ''}
                onChange={(e) => setLineForm({ ...lineForm, grn_id: e.target.value })}
              >
                <option value="">Select draft GRN to add received line…</option>
                {draftGRNs.map((g: any) => (
                  <option key={g.id} value={g.id}>
                    {g.grnNumber ?? `GRN-${g.id}`} - {poById.get(Number(g.purchaseOrderId))?.poNumber ?? g.purchaseOrder?.poNumber ?? 'PO'}
                  </option>
                ))}
              </select>
              <Button disabled={!lineForm.grn_id} onClick={() => setIsAddGRNLineOpen(true)}>
                Add received line
              </Button>
            </div>
            {draftGRNs.length === 0 && (
              <div className="mt-2 text-xs text-amber-700 dark:text-amber-300">
                No draft GRN found. Create one from an open PO first.
              </div>
            )}
          </Card>

          {selectedDraftGrn?.lines?.length ? (
            <Card>
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100 mb-2">Expected vs received (selected draft GRN)</h3>
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 pr-4">Item</th>
                      <th className="py-2 pr-4">Expected</th>
                      <th className="py-2 pr-4">Received</th>
                      <th className="py-2 pr-4">Difference</th>
                      <th className="py-2 pr-4">UOM</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(selectedDraftGrn.lines ?? []).map((line: any) => {
                      const expected = getExpectedForGrnLine(selectedDraftGrn, line);
                      const received = getReceivedForGrnLine(line);
                      const canDiff =
                        expected.qty != null &&
                        (expected.uomId == null || received.uomId == null || expected.uomId === received.uomId);
                      const diff = canDiff ? Number(received.qty) - Number(expected.qty) : null;
                      return (
                        <tr key={line.id} className="border-t border-slate-100 dark:border-slate-700">
                          <td className="py-2 pr-4">{itemById.get(Number(line.inventoryItemId))?.name ?? '—'}</td>
                          <td className="py-2 pr-4">{formatQtyWithUom(expected.qty, expected.uomId)}</td>
                          <td className="py-2 pr-4">{formatQtyWithUom(received.qty, received.uomId)}</td>
                          <td className="py-2 pr-4">
                            {!canDiff ? (
                              <span className="text-xs text-slate-500">UOM differs</span>
                            ) : diff == null ? (
                              '—'
                            ) : diff === 0 ? (
                              <span className="font-medium text-emerald-700 dark:text-emerald-400">0</span>
                            ) : (
                              <span className={diff > 0 ? 'font-medium text-amber-700 dark:text-amber-300' : 'font-medium text-rose-700 dark:text-rose-300'}>
                                {diff > 0 ? `+${diff}` : diff}
                              </span>
                            )}
                          </td>
                          <td className="py-2 pr-4">{uomById.get(Number(received.uomId))?.code ?? '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </Card>
          ) : null}

          <Card>
            <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Goods receipt notes</h2>
            {grnsQ.isLoading ? (
              <Loader />
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 pr-4">GRN Number</th>
                      <th className="py-2 pr-4">PR Reference</th>
                      <th className="py-2 pr-4">PO Number</th>
                      <th className="py-2 pr-4">Receiving branch</th>
                      <th className="py-2 pr-4">Lines</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(grnsQ.data ?? []).map((g: any) => (
                      <tr key={g.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4 font-medium">{g.grnNumber ?? `GRN-${g.id}`}</td>
                        <td className="py-2 pr-4">{g.purchaseOrder?.purchaseRequisition?.prNumber ?? '—'}</td>
                        <td className="py-2 pr-4">{g.purchaseOrder?.poNumber ?? poById.get(Number(g.purchaseOrderId))?.poNumber ?? '—'}</td>
                        <td className="py-2 pr-4">{branchById.get(Number(g.branchId))?.name ?? '—'}</td>
                        <td className="py-2 pr-4">{(g.lines ?? []).length}</td>
                        <td className="py-2 pr-4">
                          <span className={`inline-flex px-2 py-1 rounded text-xs font-medium ${statusClass(g.status)}`}>
                            {g.status}
                          </span>
                        </td>
                        <td className="py-2 pr-4 flex gap-2">
                          <Button variant="secondary" onClick={() => setSelectedGRN(g)}>View</Button>
                          <Button
                            variant="secondary"
                            disabled={g.status !== 'draft'}
                            onClick={() => openEditGRNModal(g)}
                          >
                            Edit
                          </Button>
                          <Button disabled={g.status !== 'draft'} onClick={() => postGRNM.mutate(g.id)}>Post</Button>
                          <Button disabled={g.status !== 'posted'} onClick={() => reverseGRNM.mutate(g.id)}>Reverse</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      )}

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
                <select
                  className="w-full border rounded-lg p-2"
                  value={prForm.requesting_branch_id}
                  onChange={(e) =>
                    setPrForm({
                      ...prForm,
                      requesting_branch_id: e.target.value,
                      lines: [],
                    })
                  }
                >
                  <option value="">Select branch…</option>
                  {availablePrBranches.map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              )}
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Requested from</div>
              <select
                className="w-full border rounded-lg p-2"
                value={prForm.requested_from_vendor_id}
                onChange={(e) => setPrForm({ ...prForm, requested_from_vendor_id: e.target.value })}
              >
                <option value="">Select supplier/warehouse…</option>
                {(vendorsQ.data ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
            </label>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm md:col-span-2">
              <div className="text-xs font-medium text-slate-600 mb-1">Raw product select</div>
              <select
                className="w-full border rounded-lg p-2"
                value={prForm.inventory_item_id}
                onChange={(e) => {
                  const id = Number(e.target.value);
                  if (!id) {
                    setPrForm({ ...prForm, inventory_item_id: '' });
                    return;
                  }
                  setPrForm((prev: any) => ({ ...prev, inventory_item_id: String(id) }));
                  addSelectedPrItem(id);
                }}
                disabled={!prForm.requesting_branch_id}
              >
                <option value="">
                  {!prForm.requesting_branch_id ? 'Select branch first…' : 'Select product…'}
                </option>
                {(itemsQ.data ?? []).map((it: any) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
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
                                <select
                                  className="w-28 border rounded-lg p-1.5 bg-white"
                                  value={l.requested_uom_id ?? ''}
                                  onChange={(e) => {
                                    const nextUomId = Number(e.target.value);
                                    const prevUomId = Number(l.requested_uom_id);
                                    if (!nextUomId || !prevUomId || nextUomId === prevUomId) {
                                      setPrForm((prev: any) => ({
                                        ...prev,
                                        lines: (prev.lines ?? []).map((x: any, i: number) =>
                                          i === idx ? { ...x, requested_uom_id: e.target.value } : x,
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
                                >
                                  {allowedUoms.map((u: any) => (
                                    <option key={u.id} value={u.id}>
                                      {u.code}
                                    </option>
                                  ))}
                                </select>
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

      <Modal isOpen={isCreateGRNOpen} onClose={() => setIsCreateGRNOpen(false)} title="Create Draft GRN" size="medium">
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
          <label className="text-sm block">
            <div className="text-xs font-medium text-slate-600 mb-1">Open purchase order</div>
            <select
              className="w-full border rounded-lg p-2"
              value={grnForm.purchase_order_id}
              onChange={(e) => setGrnForm({ ...grnForm, purchase_order_id: e.target.value })}
            >
              <option value="">Select PO…</option>
              {openPOs.map((po: any) => (
                <option key={po.id} value={po.id}>
                  {po.poNumber} - {branchById.get(Number(po.buyerBranchId))?.name ?? 'Branch'}
                </option>
              ))}
            </select>
          </label>
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
              Create draft GRN
            </Button>
          </div>
        </div>
      </Modal>

      <Modal isOpen={isEditGRNOpen} onClose={() => setIsEditGRNOpen(false)} title="Edit Draft GRN" size="full">
        <div className="space-y-3 overflow-x-hidden">
          <label className="text-sm block">
            <div className="text-xs font-medium text-slate-600 mb-1">GRN Reference Number</div>
            <input
              className="w-full border rounded-lg p-2"
              value={grnForm.grn_number}
              onChange={(e) => setGrnForm({ ...grnForm, grn_number: e.target.value })}
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
            <div className="text-xs font-medium text-slate-600 mb-2">Add missing item line</div>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-2">
              <select
                className="border rounded-lg p-2 text-sm"
                value={editGrnLineForm.inventory_item_id}
                onChange={(e) => {
                  const itemId = Number(e.target.value);
                  const item = itemById.get(itemId);
                  setEditGrnLineForm((prev: any) => ({
                    ...prev,
                    inventory_item_id: e.target.value,
                    received_uom_id: getDefaultItemUomId(item),
                  }));
                }}
              >
                <option value="">Select item…</option>
                {(itemsQ.data ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
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
              <select
                className="border rounded-lg p-2 text-sm"
                value={editGrnLineForm.received_uom_id}
                onChange={(e) => setEditGrnLineForm((prev: any) => ({ ...prev, received_uom_id: e.target.value }))}
                disabled={!selectedItemForEditGrnLine}
              >
                <option value="">Unit…</option>
                {getItemAllowedUoms(
                  selectedItemForEditGrnLine,
                  editGrnLineForm.received_uom_id,
                ).map((u: any) => (
                  <option key={u.id} value={u.id}>{u.code}</option>
                ))}
              </select>
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
              GRN lines ({(grnForm.lines ?? []).length})
            </div>
            {(grnForm.lines ?? []).length === 0 ? (
              <div className="px-3 py-3 text-sm text-slate-500">No lines found on this GRN.</div>
            ) : (
              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600">
                    <tr>
                      <th className="py-2 px-3">Item</th>
                      <th className="py-2 px-3">Current</th>
                      <th className="py-2 px-3">Received qty</th>
                      <th className="py-2 px-3">Unit</th>
                      <th className="py-2 px-3">Lot / batch</th>
                      <th className="py-2 px-3">Expiry</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(grnForm.lines ?? []).map((l: any, idx: number) => {
                      const item = itemById.get(Number(l.inventory_item_id));
                      const lineTrackExpiry = !!item?.trackExpiry;
                      return (
                        <tr key={l.line_id ?? idx} className="border-t">
                          <td className="py-2 px-3">
                            <div>{item?.name ?? '—'}</div>
                            <div className="text-[10px] text-slate-500">
                              {(() => {
                                const expected = getExpectedForEditGrnLine(l);
                                return `Expected: ${formatQtyWithUom(expected.qty, expected.uomId)}`;
                              })()}
                            </div>
                          </td>
                          <td className="py-2 px-3 text-[11px] text-slate-600">
                            Received: {Number(l.received_qty ?? 0)}
                          </td>
                          <td className="py-2 px-3">
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
                            <select
                              className="w-28 border rounded-lg p-1.5"
                              value={l.received_uom_id ?? ''}
                              onChange={(e) =>
                                setGrnForm((prev: any) => ({
                                  ...prev,
                                  lines: (prev.lines ?? []).map((x: any, i: number) =>
                                    i === idx ? { ...x, received_uom_id: e.target.value } : x,
                                  ),
                                }))
                              }
                            >
                              {getItemAllowedUoms(item, l.received_uom_id).map((u: any) => (
                                <option key={u.id} value={u.id}>{u.code}</option>
                              ))}
                            </select>
                          </td>
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
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsEditGRNOpen(false)}>Cancel</Button>
            <Button
              isLoading={updateGRNM.isPending}
              onClick={() => {
                if (!grnForm.grn_id || !String(grnForm.grn_number ?? '').trim()) {
                  toast.error('GRN reference number is required');
                  return;
                }
                if (!(grnForm.lines ?? []).length) {
                  toast.error('GRN must have at least one line');
                  return;
                }
                for (const l of grnForm.lines ?? []) {
                  const qty = Number(l.received_qty ?? 0);
                  if (!Number.isFinite(qty) || qty < 0) {
                    toast.error('Received quantity must be a valid number >= 0');
                    return;
                  }
                  const item = itemById.get(Number(l.inventory_item_id));
                  if (item?.trackExpiry && qty > 0 && !String(l.expiry_date ?? '').trim()) {
                    toast.error(`Expiry date is required for ${item.name}`);
                    return;
                  }
                }
                updateGRNM.mutate({
                  id: Number(grnForm.grn_id),
                  payload: {
                    grn_number: String(grnForm.grn_number).trim(),
                    notes: grnForm.notes || null,
                    lines: (grnForm.lines ?? []).map((l: any) => ({
                      line_id:
                        l.line_id == null || Number.isNaN(Number(l.line_id))
                          ? undefined
                          : Number(l.line_id),
                      purchase_order_line_id:
                        l.purchase_order_line_id != null ? Number(l.purchase_order_line_id) : null,
                      inventory_item_id: Number(l.inventory_item_id),
                      received_qty: Number(l.received_qty ?? 0),
                      received_uom_id: Number(l.received_uom_id),
                      lot_code: l.lot_code || null,
                      expiry_date: l.expiry_date || null,
                      location_id: l.location_id != null ? Number(l.location_id) : null,
                      notes: l.notes || null,
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
              <select
                className="w-full border rounded-lg p-2"
                value={poForm.vendor_id ?? ''}
                onChange={(e) => setPoForm({ ...poForm, vendor_id: e.target.value })}
              >
                <option value="">Select supplier/warehouse…</option>
                {(vendorsQ.data ?? []).map((v: any) => <option key={v.id} value={v.id}>{v.name}</option>)}
              </select>
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
              <select
                className="w-full border rounded-lg p-2"
                value={poForm.line_item_id ?? ''}
                onChange={(e) => {
                  const itemId = Number(e.target.value);
                  const item = itemById.get(itemId);
                  setPoForm({
                    ...poForm,
                    line_item_id: e.target.value,
                    line_uom_id: getDefaultItemUomId(item),
                  });
                }}
              >
                <option value="">Select item…</option>
                {(itemsQ.data ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
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
              <select
                className="w-full border rounded-lg p-2"
                value={poForm.line_uom_id ?? ''}
                onChange={(e) => setPoForm({ ...poForm, line_uom_id: e.target.value })}
                disabled={!selectedItemForPOLine}
              >
                <option value="">Select unit…</option>
                {getItemAllowedUoms(selectedItemForPOLine, poForm.line_uom_id).map((u: any) => (
                  <option key={u.id} value={u.id}>{u.code}</option>
                ))}
              </select>
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

      <Modal isOpen={isAddGRNLineOpen} onClose={() => setIsAddGRNLineOpen(false)} title="Add Received Line" size="large">
        <div className="space-y-3">
          <label className="text-sm block">
            <div className="text-xs font-medium text-slate-600 mb-1">Draft GRN</div>
            <select
              className="w-full border rounded-lg p-2"
              value={lineForm.grn_id}
              onChange={(e) => setLineForm({ ...lineForm, grn_id: e.target.value })}
            >
              <option value="">Select draft GRN…</option>
              {draftGRNs.map((g: any) => (
                <option key={g.id} value={g.id}>
                  {g.grnNumber ?? `GRN-${g.id}`} - {poById.get(Number(g.purchaseOrderId))?.poNumber ?? g.purchaseOrder?.poNumber ?? 'PO'}
                </option>
              ))}
            </select>
          </label>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Item received</div>
              <select
                className="w-full border rounded-lg p-2"
                value={lineForm.inventory_item_id}
                onChange={(e) => {
                  const itemId = Number(e.target.value);
                  const item = itemById.get(itemId);
                  setLineForm({
                    ...lineForm,
                    inventory_item_id: e.target.value,
                    received_uom_id: getDefaultItemUomId(item),
                  });
                }}
              >
                <option value="">Select item…</option>
                {(itemsQ.data ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Received quantity</div>
              <input
                className="w-full border rounded-lg p-2"
                placeholder="e.g. 8"
                value={lineForm.received_qty}
                onChange={(e) => setLineForm({ ...lineForm, received_qty: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Unit</div>
              <select
                className="w-full border rounded-lg p-2"
                value={lineForm.received_uom_id}
                onChange={(e) => setLineForm({ ...lineForm, received_uom_id: e.target.value })}
                disabled={!selectedItemForLine}
              >
                <option value="">Select unit…</option>
                {getItemAllowedUoms(selectedItemForLine, lineForm.received_uom_id).map((u: any) => (
                  <option key={u.id} value={u.id}>{u.code}</option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Lot / batch code (optional)</div>
              <input
                className="w-full border rounded-lg p-2"
                value={lineForm.lot_code}
                onChange={(e) => setLineForm({ ...lineForm, lot_code: e.target.value })}
              />
            </label>
            <label className="text-sm md:col-span-2">
              <div className="text-xs font-medium text-slate-600 mb-1">
                Expiry date {selectedItemForLine?.trackExpiry ? '(required for this item)' : '(optional)'}
              </div>
              <input
                className="w-full border rounded-lg p-2"
                type="date"
                value={lineForm.expiry_date}
                onChange={(e) => setLineForm({ ...lineForm, expiry_date: e.target.value })}
              />
            </label>
          </div>

          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsAddGRNLineOpen(false)}>Cancel</Button>
            <Button
              isLoading={addGRNLineM.isPending}
              disabled={!lineForm.grn_id}
              onClick={() => {
                if (!lineForm.inventory_item_id || !lineForm.received_qty || !lineForm.received_uom_id) {
                  toast.error('Please select item, quantity, and unit');
                  return;
                }
                if (selectedItemForLine?.trackExpiry && !lineForm.expiry_date) {
                  toast.error('Expiry date is required for this item');
                  return;
                }
                addGRNLineM.mutate({
                  grnId: Number(lineForm.grn_id),
                  line: {
                    purchase_order_line_id:
                      selectedDraftGrn?.lines?.find(
                        (l: any) =>
                          Number(l.inventoryItemId) === Number(lineForm.inventory_item_id) &&
                          Number(l.receivedUomId) === Number(lineForm.received_uom_id),
                      )?.purchaseOrderLineId ??
                      selectedDraftGrn?.lines?.find(
                        (l: any) => Number(l.inventoryItemId) === Number(lineForm.inventory_item_id),
                      )?.purchaseOrderLineId ??
                      null,
                    inventory_item_id: Number(lineForm.inventory_item_id),
                    received_qty: Number(lineForm.received_qty),
                    received_uom_id: Number(lineForm.received_uom_id),
                    lot_code: lineForm.lot_code || null,
                    expiry_date: lineForm.expiry_date || null,
                    location_id: null,
                    notes: null,
                  },
                });
              }}
            >
              Add line
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

