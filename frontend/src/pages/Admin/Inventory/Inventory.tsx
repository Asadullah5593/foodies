import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { useNavigate } from 'react-router-dom';
import Card from '../../../components/Card';
import Loader from '../../../components/Loader';
import Button from '../../../components/Button';
import Modal from '../../../components/Modal';
import apiClient from '../../../utils/apiClient';
import SearchableSelect from '../../../components/SearchableSelect';
import { inventoryService } from '../../../services/api/inventoryService';
import { confirmDialog } from '../../../utils/sweetAlert';

const BRANCH_ID_KEY = 'foodies-inventory-branch-id';

function useSelectedBranchId(branches: Array<{ id: number; name: string; code?: string }> | undefined) {
  const [branchId, setBranchId] = useState<number | null>(() => {
    const raw = localStorage.getItem(BRANCH_ID_KEY);
    const n = raw ? Number(raw) : NaN;
    return Number.isFinite(n) ? n : null;
  });

  const options = useMemo(
    () =>
      (branches ?? []).map((b) => ({
        value: String(b.id),
        label: `${b.name}${b.code ? ` (${b.code})` : ''}`,
      })),
    [branches],
  );

  const selected = branchId != null ? String(branchId) : '';

  const setSelected = (v: string) => {
    const next = v ? Number(v) : null;
    setBranchId(next);
    if (next != null) localStorage.setItem(BRANCH_ID_KEY, String(next));
  };

  return { branchId, options, selected, setSelected };
}

export type InventoryTabKey =
  | 'onhand'
  | 'ledger'
  | 'alerts'
  | 'transfers'
  | 'adjustments'
  | 'uoms'
  | 'vendors'
  | 'items'
  | 'wastage'
  | 'stocktake'
  | 'weekly';

const normalizeSku = (value: string) => String(value ?? '').trim().toLowerCase();

const buildSkuBase = (value: string) => {
  const normalized = String(value ?? '')
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-{2,}/g, '-')
    .slice(0, 24);
  return normalized || 'ITEM';
};

const generateUniqueSku = (args: { name: string; items: any[]; excludeItemId?: number }) => {
  const { name, items, excludeItemId } = args;
  const existing = new Set(
    items
      .filter((it) => Number(it?.id) !== Number(excludeItemId))
      .map((it) => normalizeSku(String(it?.code ?? '')))
      .filter(Boolean),
  );
  const base = buildSkuBase(name);
  if (!existing.has(normalizeSku(base))) return base;
  for (let index = 2; index < 10000; index += 1) {
    const candidate = `${base}-${index}`;
    if (!existing.has(normalizeSku(candidate))) return candidate;
  }
  return `${base}-${Date.now().toString().slice(-6)}`;
};

const readApiError = (error: any, fallback: string) => {
  const message = error?.response?.data?.message;
  if (Array.isArray(message)) return String(message[0] ?? fallback);
  if (typeof message === 'string' && message.trim()) return message;
  return error?.message ?? fallback;
};

const Inventory: React.FC<{ initialTab?: InventoryTabKey; showTabs?: boolean }> = ({
  initialTab = 'onhand',
  showTabs = true,
}) => {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<InventoryTabKey>(initialTab);
  const [uomModalOpen, setUomModalOpen] = useState(false);
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);
  const [itemBaseUnitDropdownOpen, setItemBaseUnitDropdownOpen] = useState(false);
  const [itemBaseUnitSearch, setItemBaseUnitSearch] = useState('');
  const [transferRequestModalOpen, setTransferRequestModalOpen] = useState(false);
  const [transferActionModalOpen, setTransferActionModalOpen] = useState(false);
  const [adjustmentModalOpen, setAdjustmentModalOpen] = useState(false);
  const [wastageModalOpen, setWastageModalOpen] = useState(false);
  const [stocktakeCreateModalOpen, setStocktakeCreateModalOpen] = useState(false);
  const [stocktakeLineModalOpen, setStocktakeLineModalOpen] = useState(false);
  const [selectedTransferRequest, setSelectedTransferRequest] = useState<any | null>(null);
  const [selectedTransferOrder, setSelectedTransferOrder] = useState<any | null>(null);
  const [selectedAdjustment, setSelectedAdjustment] = useState<any | null>(null);
  const [editingAdjustmentGroup, setEditingAdjustmentGroup] = useState<any | null>(null);
  const [selectedOnHandItemId, setSelectedOnHandItemId] = useState<number | null>(null);
  const [transferActionType, setTransferActionType] = useState<'dispatch' | 'receive'>('dispatch');

  const toDateInput = (d: Date) => {
    if (Number.isNaN(d.getTime())) return '';
    return d.toISOString().slice(0, 10);
  };

  const [ledgerFrom, setLedgerFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 6);
    return toDateInput(d);
  });
  const [ledgerTo, setLedgerTo] = useState(() => toDateInput(new Date()));
  const [ledgerEventType, setLedgerEventType] = useState<string>('');
  const [ledgerItemId, setLedgerItemId] = useState<string>('');
  const [ledgerPage, setLedgerPage] = useState<number>(1);
  const [ledgerPageSize, setLedgerPageSize] = useState<number>(50);

  const [wastageFrom, setWastageFrom] = useState<string>('');
  const [wastageTo, setWastageTo] = useState<string>('');
  const [wastageItemId, setWastageItemId] = useState<string>('');
  const [wastageReason, setWastageReason] = useState<string>('');
  const [wastagePage, setWastagePage] = useState<number>(1);
  const [wastagePageSize, setWastagePageSize] = useState<number>(50);

  const { data: branches } = useQuery({
    queryKey: ['branches'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/branches');
      return res.data ?? [];
    },
  });

  const { branchId, options: branchOptions, selected: selectedBranch, setSelected: setSelectedBranch } = useSelectedBranchId(branches);

  const uomsQ = useQuery({
    queryKey: ['inventory-uoms'],
    queryFn: inventoryService.listUoms,
    enabled:
      tab === 'uoms' ||
      tab === 'onhand' ||
      tab === 'ledger' ||
      tab === 'transfers' ||
      tab === 'adjustments' ||
      tab === 'wastage' ||
      tab === 'stocktake' ||
      tab === 'weekly' ||
      tab === 'items',
  });

  const vendorsQ = useQuery({
    queryKey: ['inventory-vendors'],
    queryFn: inventoryService.listVendors,
    enabled: tab === 'vendors',
  });

  const itemsQ = useQuery({
    queryKey: ['inventory-items'],
    queryFn: inventoryService.listItems,
    enabled:
      tab === 'items' ||
      tab === 'transfers' ||
      tab === 'adjustments' ||
      tab === 'wastage' ||
      tab === 'onhand' ||
      tab === 'ledger' ||
      tab === 'alerts' ||
      tab === 'stocktake' ||
      tab === 'weekly',
  });

  const locationsQ = useQuery({
    queryKey: ['inventory-locations', branchId],
    queryFn: () => inventoryService.listLocations(branchId!),
    enabled:
      branchId != null &&
      (tab === 'onhand' || tab === 'ledger' || tab === 'wastage' || tab === 'stocktake'),
  });

  const onHandQ = useQuery({
    queryKey: ['inventory-onhand', branchId],
    queryFn: () => inventoryService.getOnHand(branchId!),
    enabled: tab === 'onhand' && branchId != null,
  });

  const ledgerQ = useQuery({
    queryKey: [
      'inventory-ledger',
      branchId,
      ledgerFrom,
      ledgerTo,
      ledgerEventType,
      ledgerItemId,
      ledgerPage,
      ledgerPageSize,
    ],
    queryFn: () =>
      inventoryService.getLedger(branchId!, {
        from: ledgerFrom || undefined,
        to: ledgerTo || undefined,
        event_type: ledgerEventType || undefined,
        inventory_item_id: ledgerItemId ? Number(ledgerItemId) : undefined,
        page: ledgerPage,
        page_size: ledgerPageSize,
      }),
    enabled: tab === 'ledger' && branchId != null,
  });

  const productHistoryQ = useQuery({
    queryKey: ['inventory-item-history', branchId, selectedOnHandItemId],
    queryFn: () =>
      inventoryService.getLedger(branchId!, {
        inventory_item_id: Number(selectedOnHandItemId),
        page_size: 500,
      }),
    enabled: branchId != null && selectedOnHandItemId != null,
  });

  const transferRequestsQ = useQuery({
    queryKey: ['inventory-transfer-requests', branchId],
    queryFn: () => inventoryService.listTransferRequests(branchId!),
    enabled: tab === 'transfers' && branchId != null,
  });

  const transferOrdersQ = useQuery({
    queryKey: ['inventory-transfer-orders', branchId],
    queryFn: () => inventoryService.listTransferOrders(branchId!),
    enabled: tab === 'transfers' && branchId != null,
  });

  const adjustmentsQ = useQuery({
    queryKey: ['inventory-adjustments', branchId],
    queryFn: () => inventoryService.listAdjustments(branchId!),
    enabled: tab === 'adjustments' && branchId != null,
  });

  const lowStockQ = useQuery({
    queryKey: ['inventory-lowstock', branchId],
    queryFn: () => inventoryService.getLowStock(branchId!),
    enabled: tab === 'alerts' && branchId != null,
  });

  const nearExpiryQ = useQuery({
    queryKey: ['inventory-nearexpiry', branchId],
    queryFn: () => inventoryService.getNearExpiry(branchId!),
    enabled: tab === 'alerts' && branchId != null,
  });

  const expiryCoverageWarningsQ = useQuery({
    queryKey: ['inventory-expiry-coverage-warnings', branchId],
    queryFn: () => inventoryService.getExpiryCoverageWarnings(branchId!),
    enabled: tab === 'alerts' && branchId != null,
  });

  const createUomM = useMutation({
    mutationFn: inventoryService.createUom,
    onSuccess: async () => {
      toast.success('Unit of measure created');
      await queryClient.invalidateQueries({ queryKey: ['inventory-uoms'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create unit of measure')),
  });

  const updateUomM = useMutation({
    mutationFn: (data: {
      id: number;
      name: string;
      code: string;
      kind?: string;
      base_uom_id?: number | null;
      multiplier_to_base?: number | null;
    }) =>
      inventoryService.updateUom(data.id, {
        name: data.name,
        code: data.code,
        kind: data.kind,
        base_uom_id: data.base_uom_id,
        multiplier_to_base: data.multiplier_to_base,
      }),
    onSuccess: async () => {
      toast.success('Unit of measure updated');
      await queryClient.invalidateQueries({ queryKey: ['inventory-uoms'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to update unit of measure')),
  });

  const deleteUomM = useMutation({
    mutationFn: (id: number) => inventoryService.deleteUom(id),
    onSuccess: async () => {
      toast.success('Unit of measure deleted');
      await queryClient.invalidateQueries({ queryKey: ['inventory-uoms'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to delete unit of measure')),
  });

  const createVendorM = useMutation({
    mutationFn: inventoryService.createVendor,
    onSuccess: async () => {
      toast.success('Vendor created');
      await queryClient.invalidateQueries({ queryKey: ['inventory-vendors'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create vendor')),
  });

  const updateVendorM = useMutation({
    mutationFn: (data: { id: number; payload: any }) => inventoryService.updateVendor(data.id, data.payload),
    onSuccess: async () => {
      toast.success('Vendor updated');
      await queryClient.invalidateQueries({ queryKey: ['inventory-vendors'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to update vendor')),
  });

  const deleteVendorM = useMutation({
    mutationFn: (id: number) => inventoryService.deleteVendor(id),
    onSuccess: async () => {
      toast.success('Vendor deleted');
      await queryClient.invalidateQueries({ queryKey: ['inventory-vendors'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to delete vendor')),
  });

  const createItemM = useMutation({
    mutationFn: inventoryService.createItem,
    onSuccess: async () => {
      toast.success('Item created');
      await queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create item')),
  });

  const updateItemM = useMutation({
    mutationFn: (data: { id: number; payload: any }) => inventoryService.updateItem(data.id, data.payload),
    onSuccess: async () => {
      toast.success('Item updated');
      await queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to update item')),
  });

  const deleteItemM = useMutation({
    mutationFn: (id: number) => inventoryService.deleteItem(id),
    onSuccess: async () => {
      toast.success('Item deleted');
      await queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to delete item')),
  });

  const createWastageM = useMutation({
    mutationFn: (data: any) => inventoryService.createWastage(branchId!, data),
    onSuccess: async (_created, variables: any) => {
      toast.success('Wastage recorded');
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-wastage', branchId] });
      setWastageModalOpen(false);
      const wastedItemId = Number(variables?.inventory_item_id ?? NaN);
      if (Number.isInteger(wastedItemId) && wastedItemId > 0) {
        setSelectedOnHandItemId(wastedItemId);
      }
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to record wastage')),
  });

  const wastageQ = useQuery({
    queryKey: [
      'inventory-wastage',
      branchId,
      wastageFrom,
      wastageTo,
      wastageItemId,
      wastageReason,
      wastagePage,
      wastagePageSize,
    ],
    queryFn: () =>
      inventoryService.listWastage(branchId!, {
        from: wastageFrom || undefined,
        to: wastageTo || undefined,
        inventory_item_id: wastageItemId ? Number(wastageItemId) : undefined,
        reason: wastageReason || undefined,
        page: wastagePage,
        page_size: wastagePageSize,
      }),
    enabled: tab === 'wastage' && branchId != null,
  });

  const createTransferRequestM = useMutation({
    mutationFn: inventoryService.createTransferRequest,
    onSuccess: async () => {
      toast.success('Transfer request created');
      await queryClient.invalidateQueries({ queryKey: ['inventory-transfer-requests', branchId] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create transfer request')),
  });

  const approveTransferRequestM = useMutation({
    mutationFn: (id: number) => inventoryService.approveTransferRequest(id),
    onSuccess: async () => {
      toast.success('Transfer approved');
      await queryClient.invalidateQueries({ queryKey: ['inventory-transfer-requests', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-transfer-orders', branchId] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to approve transfer')),
  });

  const dispatchTransferOrderM = useMutation({
    mutationFn: (data: {
      orderId: number;
      lines: Array<{ inventory_item_id: number; qty: number; qty_uom_id: number; location_id?: number | null; notes?: string | null }>;
    }) => inventoryService.dispatchTransferOrder(data.orderId, { lines: data.lines }),
    onSuccess: async () => {
      toast.success('Transfer dispatched');
      await queryClient.invalidateQueries({ queryKey: ['inventory-transfer-orders', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to dispatch transfer')),
  });

  const receiveTransferOrderM = useMutation({
    mutationFn: (data: {
      orderId: number;
      lines: Array<{
        inventory_item_id: number;
        received_qty: number;
        received_uom_id: number;
        location_id?: number | null;
        lot_code?: string | null;
        expiry_date?: string | null;
        notes?: string | null;
      }>;
    }) => inventoryService.receiveTransferOrder(data.orderId, { lines: data.lines }),
    onSuccess: async () => {
      toast.success('Transfer received');
      await queryClient.invalidateQueries({ queryKey: ['inventory-transfer-orders', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to receive transfer')),
  });

  const createAdjustmentM = useMutation({
    mutationFn: async (payloads: Array<{
      branch_id: number;
      adjustment_type: 'in' | 'out';
      reason_code: string;
      notes?: string;
      lines: Array<{
        inventory_item_id: number;
        qty: number;
        qty_uom_id: number;
        lot_code?: string | null;
        expiry_date?: string | null;
      }>;
    }>) => {
      const created: any[] = [];
      for (const payload of payloads) {
        created.push(await inventoryService.createAdjustment(payload));
      }
      return created;
    },
    onSuccess: async () => {
      toast.success('Adjustment saved as draft');
      await queryClient.invalidateQueries({ queryKey: ['inventory-adjustments', branchId] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create adjustment')),
  });

  const createAndPostAdjustmentM = useMutation({
    mutationFn: async (payloads: Array<{
      branch_id: number;
      adjustment_type: 'in' | 'out';
      reason_code: string;
      notes?: string;
      lines: Array<{
        inventory_item_id: number;
        qty: number;
        qty_uom_id: number;
        lot_code?: string | null;
        expiry_date?: string | null;
      }>;
    }>) => {
      const created: any[] = [];
      for (const payload of payloads) {
        const one = await inventoryService.createAdjustment(payload);
        if (!one?.id) throw new Error('Adjustment created but missing id');
        await inventoryService.postAdjustment(Number(one.id));
        created.push(one);
      }
      return created;
    },
    onSuccess: async () => {
      toast.success('Adjustment posted and stock updated');
      await queryClient.invalidateQueries({ queryKey: ['inventory-adjustments', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create and post adjustment')),
  });

  const createStocktakeM = useMutation({
    mutationFn: (data: { week_start: string; week_end: string; finance_day: string }) =>
      inventoryService.createStocktake(branchId!, data),
    onSuccess: async (st) => {
      toast.success('Stocktake created');
      setForm((f: any) => ({ ...f, stocktake_id: st?.id ?? f.stocktake_id }));
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create stocktake')),
  });

  const upsertStocktakeLineM = useMutation({
    mutationFn: (data: { stocktakeId: number; line: any }) =>
      inventoryService.upsertStocktakeLine(branchId!, data.stocktakeId, data.line),
    onSuccess: () => toast.success('Count saved'),
    onError: (e: any) => toast.error(readApiError(e, 'Failed to save line')),
  });

  const submitStocktakeM = useMutation({
    mutationFn: (stocktakeId: number) => inventoryService.submitStocktake(branchId!, stocktakeId),
    onSuccess: () => toast.success('Stocktake submitted'),
    onError: (e: any) => toast.error(readApiError(e, 'Failed to submit stocktake')),
  });

  const closeStocktakeM = useMutation({
    mutationFn: (stocktakeId: number) => inventoryService.closeStocktake(branchId!, stocktakeId),
    onSuccess: async () => {
      toast.success('Stocktake closed (variance posted)');
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to close stocktake')),
  });

  const weeklyUsageM = useMutation({
    mutationFn: (data: { from: string; to: string }) => inventoryService.weeklyUsage(branchId!, data),
    onError: (e: any) => toast.error(readApiError(e, 'Failed to generate report')),
  });

  const [form, setForm] = useState<any>({});

  const itemById = useMemo(() => {
    const m = new Map<number, any>();
    for (const it of itemsQ.data ?? []) m.set(Number(it.id), it);
    return m;
  }, [itemsQ.data]);

  const ledgerItemOptions = useMemo(
    () =>
      (itemsQ.data ?? []).map((it: any) => ({
        value: String(it.id),
        label: `${it.name}${it.code ? ` (${it.code})` : ''}`,
      })),
    [itemsQ.data],
  );

  const uomById = useMemo(() => {
    const m = new Map<number, any>();
    for (const u of uomsQ.data ?? []) m.set(Number(u.id), u);
    return m;
  }, [uomsQ.data]);

  const branchById = useMemo(() => {
    const m = new Map<number, any>();
    for (const b of branches ?? []) m.set(Number(b.id), b);
    return m;
  }, [branches]);

  const groupedOnHandRows = useMemo(() => {
    const grouped = new Map<number, { inventoryItemId: number; qty: number }>();
    for (const row of onHandQ.data ?? []) {
      const inventoryItemId = Number((row as any).inventoryItemId ?? (row as any).inventory_item_id);
      if (!Number.isInteger(inventoryItemId) || inventoryItemId <= 0) continue;
      const qty = Number((row as any).qty ?? 0);
      const existing = grouped.get(inventoryItemId);
      if (existing) {
        existing.qty += Number.isFinite(qty) ? qty : 0;
      } else {
        grouped.set(inventoryItemId, {
          inventoryItemId,
          qty: Number.isFinite(qty) ? qty : 0,
        });
      }
    }
    return Array.from(grouped.values()).sort((a, b) => a.inventoryItemId - b.inventoryItemId);
  }, [onHandQ.data]);

  const selectedOnHandItem = useMemo(
    () => (selectedOnHandItemId != null ? itemById.get(Number(selectedOnHandItemId)) : null),
    [itemById, selectedOnHandItemId],
  );

  const groupedAdjustments = useMemo(() => {
    const groups = new Map<
      string,
      {
        reference: string;
        adjustments: any[];
        lines: any[];
        createdAt: string | null;
        status: string;
        reason: string;
        types: Set<string>;
        itemIds: Set<number>;
        totalQtyBase: number;
      }
    >();
    for (const adj of adjustmentsQ.data ?? []) {
      const ref = extractAdjustmentGroupRef(adj?.notes) ?? `ADJ-${adj.id}`;
      const key = ref;
      if (!groups.has(key)) {
        groups.set(key, {
          reference: ref,
          adjustments: [],
          lines: [],
          createdAt: adj?.createdAt ?? null,
          status: String(adj?.status ?? 'draft'),
          reason: String(adj?.reasonCode ?? '—'),
          types: new Set<string>(),
          itemIds: new Set<number>(),
          totalQtyBase: 0,
        });
      }
      const g = groups.get(key)!;
      g.adjustments.push(adj);
      g.types.add(String(adj?.adjustmentType ?? ''));
      if (!g.createdAt || (adj?.createdAt && new Date(adj.createdAt).getTime() > new Date(g.createdAt).getTime())) {
        g.createdAt = adj.createdAt;
      }
      if (String(adj?.status ?? '') !== 'posted') g.status = 'draft';
      if (String(g.reason) !== String(adj?.reasonCode ?? '')) g.reason = 'multiple';
      for (const line of adj?.lines ?? []) {
        const itemId = Number(line?.inventoryItemId);
        const item = itemById.get(itemId);
        if (Number.isInteger(itemId) && itemId > 0) g.itemIds.add(itemId);
        const converted = convertQtyToItemBase(line, item);
        const normalizedQty = converted != null ? Math.abs(Number(converted)) : Math.abs(Number(line?.qty ?? 0));
        g.totalQtyBase += Number.isFinite(normalizedQty) ? normalizedQty : 0;
        g.lines.push({
          ...line,
          adjustmentType: String(adj?.adjustmentType ?? ''),
          parentAdjustmentId: Number(adj?.id),
        });
      }
    }
    return Array.from(groups.values())
      .sort((a, b) => {
        const ta = a.createdAt ? new Date(a.createdAt).getTime() : 0;
        const tb = b.createdAt ? new Date(b.createdAt).getTime() : 0;
        return tb - ta;
      })
      .map((g) => ({
        ...g,
        typeLabel:
          g.types.size > 1
            ? 'in + out'
            : String(Array.from(g.types)[0] ?? '—'),
        itemCount: g.itemIds.size,
      }));
  }, [adjustmentsQ.data, extractAdjustmentGroupRef, itemById]);

  const selectedTransferRequestItem = useMemo(
    () => itemById.get(Number(form.tr_item_id)),
    [itemById, form.tr_item_id],
  );
  const selectedTransferOrderItem = useMemo(
    () => itemById.get(Number(form.tr_order_item_id)),
    [itemById, form.tr_order_item_id],
  );
  const selectedAdjustmentItem = useMemo(
    () => itemById.get(Number(form.adj_item_id)),
    [itemById, form.adj_item_id],
  );
  const selectedWastageItem = useMemo(
    () => itemById.get(Number(form.w_item_id)),
    [itemById, form.w_item_id],
  );
  const selectedStocktakeItem = useMemo(
    () => itemById.get(Number(form.st_item_id)),
    [itemById, form.st_item_id],
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
    const options = ids.map((id) => uomById.get(id)).filter(Boolean);
    return options.length > 0 ? options : (uomsQ.data ?? []);
  };

  const getDefaultItemUomId = (item: any): string => {
    const ids = getItemAllowedUomIds(item);
    return ids.length > 0 ? String(ids[0]) : '';
  };

  const transferRequestById = useMemo(() => {
    const m = new Map<number, any>();
    for (const r of transferRequestsQ.data ?? []) m.set(Number(r.id), r);
    return m;
  }, [transferRequestsQ.data]);

  const transferRequestsForBranch = useMemo(() => {
    if (branchId == null) return [];
    return (transferRequestsQ.data ?? []).filter(
      (r: any) =>
        Number(r.sourceBranchId) === branchId || Number(r.destinationBranchId) === branchId,
    );
  }, [transferRequestsQ.data, branchId]);

  const transferOrdersForBranch = useMemo(() => {
    if (branchId == null) return [];
    return (transferOrdersQ.data ?? []).filter(
      (o: any) =>
        Number(o.sourceBranchId) === branchId || Number(o.destinationBranchId) === branchId,
    );
  }, [transferOrdersQ.data, branchId]);

  const formatDateTime = (value?: string | Date | null) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  };

  const formatNumeric = (value: number, minFraction = 2, maxFraction = 6) =>
    Number(value).toLocaleString(undefined, {
      minimumFractionDigits: minFraction,
      maximumFractionDigits: maxFraction,
    });

  const prettyLedgerEventType = (raw?: string | null) => {
    const v = String(raw ?? '').trim().toLowerCase();
    if (!v) return '—';
    const map: Record<string, string> = {
      receive: 'Received (GRN)',
      consume: 'Consumed (Order)',
      consume_reversal: 'Consumption reversal',
      adjustment_in: 'Adjustment IN',
      adjustment_out: 'Adjustment OUT',
      transfer_order: 'Transfer OUT (Dispatch)',
      transfer_receipt: 'Transfer IN (Receipt)',
      transfer_out: 'Transfer OUT (Dispatch)',
      transfer_in: 'Transfer IN (Receipt)',
      waste: 'Wastage',
      stocktake_variance: 'Stocktake variance',
    };
    return map[v] ?? v;
  };

  const ledgerMovementTypeOptions = useMemo(
    () => [
      { value: '', label: 'All movements…' },
      { value: 'receive', label: 'Received (GRN)' },
      { value: 'consume', label: 'Consumed (Order)' },
      { value: 'consume_reversal', label: 'Consumption reversal' },
      { value: 'adjustment_in', label: 'Adjustment IN' },
      { value: 'adjustment_out', label: 'Adjustment OUT' },
      { value: 'transfer_order', label: 'Transfer OUT (Dispatch)' },
      { value: 'transfer_receipt', label: 'Transfer IN (Receipt)' },
      { value: 'waste', label: 'Wastage' },
      { value: 'stocktake_variance', label: 'Stocktake variance' },
    ],
    [],
  );

  const tablePageSizeOptions = useMemo(
    () => [50, 100, 200].map((n) => ({ value: String(n), label: String(n) })),
    [],
  );

  const vendorTypeOptions = useMemo(
    () => [
      { value: 'supplier', label: 'Supplier' },
      { value: 'warehouse', label: 'Warehouse' },
      { value: 'branch', label: 'Branch (inter-branch)' },
    ],
    [],
  );

  const branchSearchableOptions = useMemo(
    () =>
      (branches ?? []).map((b: any) => ({
        value: String(b.id),
        label: `${b.name}${b.code ? ` (${b.code})` : ''}`,
      })),
    [branches],
  );

  const itemNameSelectOptions = useMemo(
    () => (itemsQ.data ?? []).map((it: any) => ({ value: String(it.id), label: it.name })),
    [itemsQ.data],
  );

  const transferDestinationBranchOptions = useMemo(
    () =>
      (branches ?? [])
        .filter((b: any) => Number(b.id) !== Number(branchId))
        .map((b: any) => ({ value: String(b.id), label: b.name })),
    [branches, branchId],
  );

  const transferOrderSelectOptions = useMemo(
    () =>
      (branchId != null ? transferOrdersForBranch : []).map((o: any) => ({
        value: String(o.id),
        label: `TO-${o.id}: ${branchById.get(Number(o.sourceBranchId))?.name ?? '—'} → ${branchById.get(Number(o.destinationBranchId))?.name ?? '—'} (${o.status})`,
      })),
    [transferOrdersForBranch, branchById, branchId],
  );

  const adjustmentHeaderTypeOptions = useMemo(
    () => [
      { value: 'out', label: 'OUT (decrease)' },
      { value: 'in', label: 'IN (increase)' },
    ],
    [],
  );

  const adjustmentRowLineTypeOptions = useMemo(
    () => [
      { value: 'out', label: 'OUT' },
      { value: 'in', label: 'IN' },
    ],
    [],
  );

  const itemExpiryRequiredOptions = useMemo(
    () => [
      { value: 'yes', label: 'Required (enter an expiry date)' },
      { value: 'no', label: 'Not required' },
    ],
    [],
  );

  const uomKindSelectOptions = useMemo(
    () =>
      [
        'count',
        'mass',
        'volume',
        'length',
        'area',
        'time',
        'energy',
        'pressure',
        'power',
        'frequency',
        'speed',
        'flow',
      ].map((k) => ({ value: k, label: k })),
    [],
  );

  const uomBaseUomSelectOptions = useMemo(() => {
    const kind = String(form.uom_kind ?? 'count');
    const editId = Number(form.uom_edit_id ?? 0);
    return [
      { value: '', label: 'None (this is a base unit)' },
      ...(uomsQ.data ?? [])
        .filter((u: any) => String(u.kind ?? '') === kind)
        .filter((u: any) => Number(u.id) !== editId)
        .map((u: any) => ({ value: String(u.id), label: `${u.code} - ${u.name}` })),
    ];
  }, [uomsQ.data, form.uom_kind, form.uom_edit_id]);

  const stocktakeLocationOptions = useMemo(
    () => [
      { value: '', label: 'Unassigned' },
      ...(locationsQ.data ?? []).map((l: any) => ({
        value: String(l.id),
        label: l.name,
      })),
    ],
    [locationsQ.data],
  );

  const downloadLedgerCsv = (rows: any[], filename: string) => {
    const headers = [
      'time',
      'movement_type',
      'item',
      'item_code',
      'location',
      'batch_id',
      'lot_code',
      'expiry_date',
      'qty_delta',
      'uom',
      'reference',
      'created_by',
      'notes',
    ];
    const esc = (value: any) => {
      const s = String(value ?? '');
      if (s.includes('"') || s.includes(',') || s.includes('\n')) {
        return `"${s.replace(/"/g, '""')}"`;
      }
      return s;
    };
    const lines = [
      headers.join(','),
      ...(rows ?? []).map((r: any) => {
        const item = itemById.get(Number(r.inventoryItemId));
        const uomCode = item?.baseUomId ? uomById.get(Number(item.baseUomId))?.code ?? '' : '';
        const locationLabel = r?.location?.code
          ? `${r.location.code}${r.location.name ? ` - ${r.location.name}` : ''}`
          : (r?.location?.name ?? '');
        const batch = r?.inventoryBatch ?? null;
        const ref = r?.eventRefType ? `${r.eventRefType}:${r.eventRefId}` : '';
        const createdBy = r?.creator?.name ?? (r?.createdBy != null ? `User #${r.createdBy}` : '');
        return [
          formatDateTime(r.createdAt),
          String(r.eventType ?? ''),
          String(item?.name ?? `Item #${r.inventoryItemId}`),
          String(item?.code ?? ''),
          locationLabel || 'Unassigned',
          r.inventoryBatchId ?? '',
          batch?.lotCode ?? '',
          batch?.expiryDate ?? '',
          Number(r.qtyDelta ?? 0),
          uomCode,
          ref,
          createdBy,
          String(r.notes ?? ''),
        ].map(esc).join(',');
      }),
    ].join('\n');
    const blob = new Blob([lines], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  function createAdjustmentGroupRef() {
    return `ADJGRP-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.random()
      .toString(36)
      .slice(2, 8)
      .toUpperCase()}`;
  }

  function extractAdjustmentGroupRef(notesRaw: unknown): string | null {
    const notes = String(notesRaw ?? '');
    const match = notes.match(/\[GROUP_REF:([A-Z0-9-]+)\]/i);
    return match?.[1] ? String(match[1]).toUpperCase() : null;
  }

  function getUomToRootMultiplier(uomIdRaw: number | string | null | undefined): number | null {
    const start = Number(uomIdRaw);
    if (!Number.isInteger(start) || start <= 0) return null;
    let current = start;
    let multiplier = 1;
    for (let hop = 0; hop < 8; hop += 1) {
      const u = uomById.get(current);
      if (!u) return null;
      const baseId = u.baseUomId != null ? Number(u.baseUomId) : null;
      const step = u.multiplierToBase != null ? Number(u.multiplierToBase) : null;
      if (
        baseId == null ||
        step == null ||
        !Number.isInteger(baseId) ||
        baseId <= 0 ||
        !Number.isFinite(step) ||
        step <= 0
      ) {
        return multiplier;
      }
      const resolvedStep = Number(step);
      const resolvedBaseId = Number(baseId);
      multiplier *= resolvedStep;
      current = resolvedBaseId;
    }
    return null;
  }

  function convertQtyToItemBase(line: any, item: any): number | null {
    const qty = Number(line?.qty ?? 0);
    const fromUomId = Number(line?.qtyUomId);
    const toUomId = Number(item?.baseUomId);
    if (!Number.isFinite(qty) || !Number.isInteger(fromUomId) || !Number.isInteger(toUomId)) return null;
    if (fromUomId === toUomId) return qty;
    const fromToRoot = getUomToRootMultiplier(fromUomId);
    const toToRoot = getUomToRootMultiplier(toUomId);
    if (fromToRoot == null || toToRoot == null || toToRoot === 0) return null;
    return qty * (fromToRoot / toToRoot);
  }

  const getHistoryReferenceMeta = (entry: any): { label: string; path: string | null } => {
    const refType = String(entry?.eventRefType ?? '').trim().toLowerCase();
    const refId = Number(entry?.eventRefId ?? NaN);
    if (!refType || !Number.isFinite(refId) || refId <= 0) {
      return { label: '—', path: null };
    }
    if (refType === 'grn') return { label: `GRN-${refId}`, path: `/admin/procurement/grns?grn_id=${refId}` };
    if (refType === 'inventory_adjustment') return { label: `ADJ-${refId}`, path: '/admin/inventory/adjustments' };
    if (refType === 'transfer_order') return { label: `TO-${refId}`, path: '/admin/inventory/transfers' };
    if (refType === 'transfer_receipt') return { label: `TR-${refId}`, path: '/admin/inventory/transfers' };
    if (refType === 'stocktake') return { label: `ST-${refId}`, path: '/admin/inventory/stocktake' };
    if (refType === 'wastage_event') return { label: `WST-${refId}`, path: '/admin/inventory/wastage' };
    if (refType === 'order') return { label: `ORD-${refId}`, path: '/admin/orders' };
    return { label: `${refType}:${refId}`, path: null };
  };

  const productHistorySummary = useMemo(() => {
    const summary = {
      received: 0,
      utilized: 0,
      adjustmentIn: 0,
      adjustmentOut: 0,
      transferIn: 0,
      transferOut: 0,
      wastage: 0,
    };
    for (const entry of productHistoryQ.data?.items ?? []) {
      const qtyDelta = Number(entry?.qtyDelta ?? 0);
      const eventType = String(entry?.eventType ?? '').toLowerCase();
      if (!Number.isFinite(qtyDelta) || qtyDelta === 0) continue;
      if (eventType === 'receive') summary.received += qtyDelta;
      if (eventType === 'consume') summary.utilized += Math.abs(qtyDelta);
      if (eventType === 'adjustment_in') summary.adjustmentIn += Math.abs(qtyDelta);
      if (eventType === 'adjustment_out') summary.adjustmentOut += Math.abs(qtyDelta);
      if (eventType === 'transfer_receipt' || eventType === 'transfer_in') summary.transferIn += Math.abs(qtyDelta);
      if (eventType === 'transfer_order' || eventType === 'transfer_out') summary.transferOut += Math.abs(qtyDelta);
      if (eventType === 'waste' || eventType === 'wastage') summary.wastage += Math.abs(qtyDelta);
    }
    return summary;
  }, [productHistoryQ.data]);

  const openCreateUom = () => {
    setForm((f: any) => ({
      ...f,
      uom_edit_id: null,
      uom_name: '',
      uom_code: '',
      uom_kind: 'count',
      uom_base_uom_id: '',
      uom_multiplier_to_base: '',
    }));
    setUomModalOpen(true);
  };

  const openEditUom = (u: any) => {
    setForm((f: any) => ({
      ...f,
      uom_edit_id: u.id,
      uom_name: u.name,
      uom_code: u.code,
      uom_kind: u.kind ?? 'count',
      uom_base_uom_id: u.baseUomId != null ? String(u.baseUomId) : '',
      uom_multiplier_to_base:
        u.multiplierToBase != null ? String(u.multiplierToBase) : '',
    }));
    setUomModalOpen(true);
  };

  const closeUomModal = () => {
    setUomModalOpen(false);
    setForm((f: any) => ({
      ...f,
      uom_edit_id: null,
      uom_name: '',
      uom_code: '',
      uom_kind: 'count',
      uom_base_uom_id: '',
      uom_multiplier_to_base: '',
    }));
  };

  const openCreateAdjustment = () => {
    setEditingAdjustmentGroup(null);
    setForm((f: any) => ({
      ...f,
      adj_type: 'out',
      adj_reason: 'manual_correction',
      adj_item_id: '',
      adj_qty: '',
      adj_uom_id: '',
      adj_lot_code: '',
      adj_expiry_date: '',
      adj_lines: [],
    }));
    setAdjustmentModalOpen(true);
  };

  const openEditAdjustmentGroup = (group: any) => {
    const editable = (group?.adjustments ?? []).every((a: any) => String(a?.status ?? '') === 'draft');
    if (!editable) {
      toast.error('Only draft adjustments can be edited');
      return;
    }
    setEditingAdjustmentGroup(group);
    const firstType = String(group?.lines?.[0]?.adjustmentType ?? 'out').toLowerCase() === 'in' ? 'in' : 'out';
    setForm((f: any) => ({
      ...f,
      adj_type: firstType,
      adj_reason: String(group?.reason ?? group?.reasonCode ?? 'manual_correction'),
      adj_item_id: '',
      adj_qty: '',
      adj_uom_id: '',
      adj_lot_code: '',
      adj_expiry_date: '',
      adj_lines: (group?.lines ?? []).map((line: any) => ({
        line_type: String(line.adjustmentType ?? 'out').toLowerCase() === 'in' ? 'in' : 'out',
        inventory_item_id: Number(line.inventoryItemId),
        qty: Number(line.qty),
        qty_uom_id: Number(line.qtyUomId),
        lot_code: line.lotCode ?? null,
        expiry_date: line.expiryDate ?? null,
      })),
    }));
    setAdjustmentModalOpen(true);
  };

  const addAdjustmentLine = () => {
    const lineType = String(form.adj_type ?? 'out') as 'in' | 'out';
    const itemId = Number(form.adj_item_id);
    const qty = Number(form.adj_qty);
    const uomId = Number(form.adj_uom_id);
    if (!itemId || !uomId || !Number.isFinite(qty) || qty <= 0) {
      toast.error('Select item, unit, and quantity > 0');
      return;
    }
    if (lineType === 'in' && !form.adj_expiry_date) {
      toast.error('Expiry date is required for IN adjustment lines');
      return;
    }
    const nextLine = {
      line_type: lineType,
      inventory_item_id: itemId,
      qty,
      qty_uom_id: uomId,
      lot_code: lineType === 'in' && form.adj_lot_code ? String(form.adj_lot_code) : null,
      expiry_date: lineType === 'in' && form.adj_expiry_date ? String(form.adj_expiry_date) : null,
    };
    setForm((prev: any) => ({
      ...prev,
      adj_lines: [...(Array.isArray(prev.adj_lines) ? prev.adj_lines : []), nextLine],
      adj_item_id: '',
      adj_qty: '',
      adj_uom_id: '',
      adj_lot_code: '',
      adj_expiry_date: '',
    }));
  };

  const updateAdjustmentLine = (
    index: number,
    patch: Record<string, unknown>,
  ) => {
    setForm((prev: any) => ({
      ...prev,
      adj_lines: (Array.isArray(prev.adj_lines) ? prev.adj_lines : []).map(
        (line: any, i: number) => (i === index ? { ...line, ...patch } : line),
      ),
    }));
  };

  const buildAdjustmentPayloads = (groupRefOverride?: string): Array<{
    branch_id: number;
    adjustment_type: 'in' | 'out';
    reason_code: string;
    notes?: string;
    lines: Array<{
      inventory_item_id: number;
      qty: number;
      qty_uom_id: number;
      lot_code?: string | null;
      expiry_date?: string | null;
    }>;
  }> | null => {
    if (!branchId) {
      toast.error('Select a branch first');
      return null;
    }
    const lines = Array.isArray(form.adj_lines) ? form.adj_lines : [];
    if (lines.length === 0) {
      toast.error('Add at least one line');
      return null;
    }
    const reasonCode = String(form.adj_reason || 'manual_correction');
    const groupRef = groupRefOverride ?? createAdjustmentGroupRef();
    const notes = `[GROUP_REF:${groupRef}]`;
    const grouped: Record<'in' | 'out', any[]> = { in: [], out: [] };
    for (let idx = 0; idx < lines.length; idx += 1) {
      const line = lines[idx];
      const adjustmentType = String(line?.line_type ?? 'out') === 'in' ? 'in' : 'out';
      const itemId = Number(line?.inventory_item_id);
      const qty = Number(line?.qty);
      const uomId = Number(line?.qty_uom_id);
      if (!itemId || !uomId || !Number.isFinite(qty) || qty <= 0) {
        toast.error(`Line ${idx + 1}: invalid item/unit/quantity`);
        return null;
      }
      if (adjustmentType === 'in' && !line?.expiry_date) {
        toast.error(`Line ${idx + 1}: expiry date is required for IN lines`);
        return null;
      }
      grouped[adjustmentType].push({
        inventory_item_id: itemId,
        qty,
        qty_uom_id: uomId,
        lot_code: adjustmentType === 'in' ? (line?.lot_code ? String(line.lot_code) : null) : null,
        expiry_date: adjustmentType === 'in' ? (line?.expiry_date ? String(line.expiry_date) : null) : null,
      });
    }
    const payloads: Array<{
      branch_id: number;
      adjustment_type: 'in' | 'out';
      reason_code: string;
      notes?: string;
      lines: Array<{
        inventory_item_id: number;
        qty: number;
        qty_uom_id: number;
        lot_code?: string | null;
        expiry_date?: string | null;
      }>;
    }> = [];
    if (grouped.out.length > 0) {
      payloads.push({
        branch_id: branchId,
        adjustment_type: 'out',
        reason_code: reasonCode,
        notes,
        lines: grouped.out,
      });
    }
    if (grouped.in.length > 0) {
      payloads.push({
        branch_id: branchId,
        adjustment_type: 'in',
        reason_code: reasonCode,
        notes,
        lines: grouped.in,
      });
    }
    return payloads;
  };

  const saveEditedAdjustmentGroup = async (postAfterSave: boolean) => {
    if (!editingAdjustmentGroup) {
      toast.error('No draft adjustment selected for edit');
      return;
    }
    const editable = (editingAdjustmentGroup.adjustments ?? []).every(
      (a: any) => String(a?.status ?? '') === 'draft',
    );
    if (!editable) {
      toast.error('Only draft adjustments can be edited');
      return;
    }
    const groupRef = String(editingAdjustmentGroup.reference ?? '').trim();
    const payloads = buildAdjustmentPayloads(groupRef || undefined);
    if (!payloads) return;
    const payloadByType = new Map<'in' | 'out', any>();
    for (const payload of payloads) {
      payloadByType.set(payload.adjustment_type, payload);
    }
    const existingDraftByType = new Map<'in' | 'out', any>();
    for (const adj of editingAdjustmentGroup.adjustments ?? []) {
      if (String(adj?.status ?? '') !== 'draft') continue;
      const t = String(adj?.adjustmentType ?? '').toLowerCase() === 'in' ? 'in' : 'out';
      existingDraftByType.set(t, adj);
    }
    const touchedIds: number[] = [];
    for (const [type, payload] of payloadByType.entries()) {
      const existing = existingDraftByType.get(type);
      if (existing?.id) {
        await inventoryService.updateAdjustment(Number(existing.id), {
          reason_code: payload.reason_code,
          notes: payload.notes ?? null,
          lines: payload.lines,
        });
        touchedIds.push(Number(existing.id));
      } else {
        const created = await inventoryService.createAdjustment(payload);
        if (created?.id) touchedIds.push(Number(created.id));
      }
    }
    for (const [type, adj] of existingDraftByType.entries()) {
      if (!payloadByType.has(type) && adj?.id) {
        await inventoryService.deleteAdjustment(Number(adj.id));
      }
    }
    if (postAfterSave) {
      for (const id of touchedIds) {
        await inventoryService.postAdjustment(id);
      }
      toast.success('Adjustment updated and posted');
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
    } else {
      toast.success('Draft adjustment updated');
    }
    await queryClient.invalidateQueries({ queryKey: ['inventory-adjustments', branchId] });
    setAdjustmentModalOpen(false);
    setEditingAdjustmentGroup(null);
  };

  const openCreateVendor = () => {
    setForm((f: any) => ({
      ...f,
      vendor_edit_id: null,
      vendor_name: '',
      vendor_type: 'supplier',
      vendor_linked_branch_id: '',
      vendor_email: '',
      vendor_phone: '',
      vendor_address: '',
    }));
    setVendorModalOpen(true);
  };

  const openEditVendor = (v: any) => {
    setForm((f: any) => ({
      ...f,
      vendor_edit_id: v.id,
      vendor_name: v.name ?? '',
      vendor_type: v.type ?? 'supplier',
      vendor_linked_branch_id: v.linkedBranchId != null ? String(v.linkedBranchId) : '',
      vendor_email: v.email ?? '',
      vendor_phone: v.phone ?? '',
      vendor_address: v.address ?? '',
    }));
    setVendorModalOpen(true);
  };

  const closeVendorModal = () => {
    setVendorModalOpen(false);
    setForm((f: any) => ({
      ...f,
      vendor_edit_id: null,
      vendor_name: '',
      vendor_type: 'supplier',
      vendor_linked_branch_id: '',
      vendor_email: '',
      vendor_phone: '',
      vendor_address: '',
    }));
  };

  const submitVendor = () => {
    const name = String(form.vendor_name ?? '').trim();
    if (!name) {
      toast.error('Please fill the required fields');
      return;
    }
    const payload = {
      name,
      type: String(form.vendor_type ?? 'supplier').trim() || 'supplier',
      linked_branch_id: form.vendor_linked_branch_id ? Number(form.vendor_linked_branch_id) : null,
      email: form.vendor_email ? String(form.vendor_email).trim() : null,
      phone: form.vendor_phone ? String(form.vendor_phone).trim() : null,
      address: form.vendor_address ? String(form.vendor_address).trim() : null,
    };
    if (form.vendor_edit_id) {
      updateVendorM.mutate({ id: Number(form.vendor_edit_id), payload });
    } else {
      createVendorM.mutate(payload);
    }
    closeVendorModal();
  };

  const openCreateItem = () => {
    setItemBaseUnitDropdownOpen(false);
    setItemBaseUnitSearch('');
    const generatedSku = generateUniqueSku({
      name: '',
      items: itemsQ.data ?? [],
    });
    setForm((f: any) => ({
      ...f,
      item_edit_id: null,
      item_name: '',
      item_code: generatedSku,
      item_code_auto_managed: true,
      item_base_uom_ids: [],
      item_expiry_required: 'yes',
      item_near_expiry_days: '',
      item_reorder_point: '',
      item_buy_price: '',
    }));
    setItemModalOpen(true);
  };

  const openEditItem = (it: any) => {
    setItemBaseUnitDropdownOpen(false);
    setItemBaseUnitSearch('');
    const generatedFromName = buildSkuBase(it.name ?? '');
    const code = String(it.code ?? '');
    const baseUomIds = Array.isArray(it.baseUomIds) && it.baseUomIds.length > 0
      ? it.baseUomIds.map((id: number) => String(id))
      : it.baseUomId != null
        ? [String(it.baseUomId)]
        : [];
    setForm((f: any) => ({
      ...f,
      item_edit_id: it.id,
      item_name: it.name ?? '',
      item_code: code,
      item_code_auto_managed: normalizeSku(code) === normalizeSku(generatedFromName),
      item_base_uom_ids: baseUomIds,
      item_expiry_required: it.trackExpiry ? 'yes' : 'no',
      item_near_expiry_days: it.defaultNearExpiryDays != null ? String(it.defaultNearExpiryDays) : '',
      item_reorder_point: it.defaultReorderPoint != null ? String(it.defaultReorderPoint) : '',
      item_buy_price: it.defaultBuyPrice != null ? String(it.defaultBuyPrice) : '',
    }));
    setItemModalOpen(true);
  };

  const closeItemModal = () => {
    setItemModalOpen(false);
    setItemBaseUnitDropdownOpen(false);
    setItemBaseUnitSearch('');
    setForm((f: any) => ({
      ...f,
      item_edit_id: null,
      item_name: '',
      item_code: '',
      item_code_auto_managed: true,
      item_base_uom_ids: [],
      item_expiry_required: 'yes',
      item_near_expiry_days: '',
      item_reorder_point: '',
      item_buy_price: '',
    }));
  };

  const handleItemNameChange = (nextName: string) => {
    setForm((f: any) => {
      if (f.item_code_auto_managed === false) {
        return { ...f, item_name: nextName };
      }
      const generatedSku = generateUniqueSku({
        name: nextName,
        items: itemsQ.data ?? [],
        excludeItemId: f.item_edit_id ? Number(f.item_edit_id) : undefined,
      });
      return { ...f, item_name: nextName, item_code: generatedSku, item_code_auto_managed: true };
    });
  };

  const handleItemCodeChange = (nextCode: string) => {
    setForm((f: any) => ({ ...f, item_code: nextCode, item_code_auto_managed: false }));
  };

  const toggleItemBaseUom = (uomId: string) => {
    setForm((f: any) => {
      const current = Array.isArray(f.item_base_uom_ids) ? f.item_base_uom_ids : [];
      const exists = current.includes(uomId);
      return {
        ...f,
        item_base_uom_ids: exists
          ? current.filter((id: string) => id !== uomId)
          : [...current, uomId],
      };
    });
  };

  const regenerateItemSku = () => {
    setForm((f: any) => {
      const generatedSku = generateUniqueSku({
        name: f.item_name ?? '',
        items: itemsQ.data ?? [],
        excludeItemId: f.item_edit_id ? Number(f.item_edit_id) : undefined,
      });
      return { ...f, item_code: generatedSku, item_code_auto_managed: true };
    });
  };

  const submitItem = () => {
    const name = String(form.item_name ?? '').trim();
    const code = String(form.item_code ?? '').trim();
    const baseUomIds = Array.isArray(form.item_base_uom_ids)
      ? form.item_base_uom_ids
          .map((id: string | number) => Number(id))
          .filter((id: number) => Number.isInteger(id) && id > 0)
      : [];
    const baseUomId = baseUomIds[0] ?? null;
    if (!name || !code || !baseUomId || baseUomIds.length === 0) {
      toast.error('Please fill the required fields');
      return;
    }
    const duplicate = (itemsQ.data ?? []).find(
      (it: any) =>
        normalizeSku(String(it.code ?? '')) === normalizeSku(code) &&
        Number(it.id) !== Number(form.item_edit_id ?? 0),
    );
    if (duplicate) {
      toast.error('Code / SKU already exists. Please use a unique value.');
      return;
    }
    const selectedUoms = baseUomIds
      .map((id: number) => uomById.get(id))
      .filter(Boolean);
    if (selectedUoms.length > 1) {
      const kind = String(selectedUoms[0]?.kind ?? '');
      const hasMixedKind = selectedUoms.some((u: any) => String(u?.kind ?? '') !== kind);
      if (hasMixedKind) {
        toast.error('Select comparable base units only (same measurement family). Use separate items for mass vs volume.');
        return;
      }
    }

    const expiryRequired = (form.item_expiry_required ?? 'yes') === 'yes';
    const buyPriceRaw = String(form.item_buy_price ?? '').trim();
    if (buyPriceRaw === '') {
      toast.error('Buying price is required');
      return;
    }
    const buyPrice = Number(buyPriceRaw);
    if (!Number.isFinite(buyPrice) || buyPrice < 0) {
      toast.error('Buying price is required and must be a valid number >= 0');
      return;
    }
    const payload = {
      name,
      code,
      type: 'ingredient',
      base_uom_id: baseUomId,
      base_uom_ids: baseUomIds,
      track_expiry: expiryRequired,
      track_lot: true,
      default_near_expiry_days:
        expiryRequired && String(form.item_near_expiry_days ?? '').trim() !== ''
          ? Number(form.item_near_expiry_days)
          : null,
      default_reorder_point: String(form.item_reorder_point ?? '').trim() !== '' ? Number(form.item_reorder_point) : null,
      default_buy_price: buyPrice,
    };

    if (form.item_edit_id) {
      updateItemM.mutate(
        { id: Number(form.item_edit_id), payload },
        { onSuccess: () => closeItemModal() },
      );
    } else {
      createItemM.mutate(payload, { onSuccess: () => closeItemModal() });
    }
  };

  const submitUom = () => {
    const name = String(form.uom_name ?? '').trim();
    const code = String(form.uom_code ?? '').trim();
    const kind = String(form.uom_kind ?? 'count').trim().toLowerCase();
    const baseUomIdRaw = String(form.uom_base_uom_id ?? '').trim();
    const multiplierRaw = String(form.uom_multiplier_to_base ?? '').trim();
    if (!name || !code) {
      toast.error('Please fill the required fields');
      return;
    }
    const base_uom_id = baseUomIdRaw === '' ? null : Number(baseUomIdRaw);
    const multiplier_to_base =
      multiplierRaw === '' ? null : Number(multiplierRaw);
    if (base_uom_id != null && (!Number.isInteger(base_uom_id) || base_uom_id <= 0)) {
      toast.error('Base unit must be a valid selection');
      return;
    }
    if (base_uom_id != null && (multiplier_to_base == null || !Number.isFinite(multiplier_to_base) || multiplier_to_base <= 0)) {
      toast.error('Multiplier to base must be a number greater than 0');
      return;
    }
    if (form.uom_edit_id) {
      updateUomM.mutate({
        id: Number(form.uom_edit_id),
        name,
        code,
        kind,
        base_uom_id,
        multiplier_to_base,
      });
    } else {
      createUomM.mutate({
        name,
        code,
        kind,
        base_uom_id,
        multiplier_to_base,
      });
    }
    closeUomModal();
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">Inventory</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">
            Track stock levels, expiry batches, wastage, and weekly stock counts per branch.
          </p>
        </div>
        <div className="w-full max-w-md">
          <SearchableSelect
            value={selectedBranch}
            onChange={setSelectedBranch}
            options={[{ value: '', label: 'Select branch…' }, ...branchOptions]}
          />
        </div>
      </div>

      <Card>
        <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
          <div className="font-semibold text-slate-800 dark:text-slate-100">How this module works</div>
          <ul className="list-disc pl-5 space-y-1 text-slate-600 dark:text-slate-300">
            <li><span className="font-medium">On-hand inventory</span> shows what you currently have in the selected branch.</li>
            <li><span className="font-medium">Stock movement ledger</span> is the “audit trail” of every increase/decrease (goods received, consumption, wastage, stock count variance, and branch transfers as transfer OUT / transfer IN).</li>
            <li><span className="font-medium">Branch transfers</span> let you request, approve, dispatch, and receive stock between branches; dispatch and receipt rows appear in the stock movement ledger for the source and destination branches respectively.</li>
            {/* <li><span className="font-medium">Alerts</span> highlights items that are low in stock or batches that are near expiry.</li> */}
            {/* <li><span className="font-medium">Storage locations</span> are optional sub-areas inside a branch (e.g., “Dry store”, “Chiller”, “Freezer”). They help you see and count stock by physical place.</li> */}
          </ul>
          {/* <div className="text-xs text-slate-500 dark:text-slate-400">
            Tip: If you don’t use locations, stock can still be tracked at branch level (location will show as “Unassigned”).
          </div> */}
        </div>
      </Card>

      {showTabs && (
        <div className="flex flex-wrap gap-2">
          {[
            { k: 'uoms', label: 'Units of measure' },
            { k: 'vendors', label: 'Vendors' },
            { k: 'items', label: 'Inventory items' },
            { k: 'onhand', label: 'On-hand inventory' },
            { k: 'ledger', label: 'Stock movement ledger' },
            { k: 'transfers', label: 'Branch transfers' },
            { k: 'adjustments', label: 'Stock adjustment' },
            { k: 'wastage', label: 'Record wastage' },
            // { k: 'alerts', label: 'Alerts (low stock & expiry)' },
            // { k: 'stocktake', label: 'Weekly stock count (Finance Day)' },
            // { k: 'weekly', label: 'Weekly usage report' },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k as InventoryTabKey)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                tab === (t.k as InventoryTabKey)
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'onhand' && (
        <Card>
          {!branchId ? (
            <div className="text-slate-500 dark:text-slate-400">Select a branch to view on-hand.</div>
          ) : onHandQ.isLoading ? (
            <Loader />
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-2 pr-4 w-12">#</th>
                    <th className="py-2 pr-4">Item</th>
                    <th className="py-2 pr-4">Buy price</th>
                    <th className="py-2 pr-4">Quantity (base unit)</th>
                    <th className="py-2 pr-4">Actions</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 dark:text-slate-200">
                  {groupedOnHandRows.map((r: any, index: number) => (
                    <tr key={r.inventoryItemId} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 pr-4">{index + 1}</td>
                      <td className="py-2 pr-4">
                        <div className="font-medium">
                          {itemById.get(Number(r.inventoryItemId))?.name ?? `Item #${r.inventoryItemId}`}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {itemById.get(Number(r.inventoryItemId))?.code ?? ''}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        {itemById.get(Number(r.inventoryItemId))?.defaultBuyPrice != null
                          ? formatNumeric(Number(itemById.get(Number(r.inventoryItemId))?.defaultBuyPrice), 2, 6)
                          : '—'}
                      </td>
                      <td className="py-2 pr-4">
                        {formatNumeric(Number(r.qty), 0, 6)}
                        {itemById.get(Number(r.inventoryItemId))?.baseUomId
                          ? ` ${uomById.get(Number(itemById.get(Number(r.inventoryItemId))?.baseUomId))?.code ?? ''}`
                          : ''}
                      </td>
                      <td className="py-2 pr-4">
                        <Button variant="secondary" onClick={() => setSelectedOnHandItemId(Number(r.inventoryItemId))}>
                          History
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

      {tab === 'ledger' && (
        <Card>
          <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Stock movement ledger</h2>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Filter by date, item, movement type, or reference. Click references to jump to the source document.
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="secondary"
                disabled={!branchId || (ledgerQ.data?.items ?? []).length === 0}
                onClick={() => {
                  const safeFrom = ledgerFrom || 'all';
                  const safeTo = ledgerTo || 'all';
                  downloadLedgerCsv(
                    ledgerQ.data?.items ?? [],
                    `ledger-branch-${branchId}-${safeFrom}-to-${safeTo}.csv`,
                  );
                }}
              >
                Export CSV
              </Button>
              <Button
                variant="secondary"
                disabled={!branchId}
                onClick={() => {
                  setLedgerFrom('');
                  setLedgerTo('');
                  setLedgerEventType('');
                  setLedgerItemId('');
                  setLedgerPage(1);
                  setLedgerPageSize(50);
                }}
              >
                Clear filters
              </Button>
            </div>
          </div>

          {!branchId ? (
            <div className="text-slate-500 dark:text-slate-400">Select a branch to view ledger.</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                <label className="text-sm">
                  <div className="text-xs font-medium text-slate-600 mb-1">From</div>
                  <input
                    className="w-full border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    type="date"
                    value={ledgerFrom}
                    onChange={(e) => {
                      setLedgerFrom(e.target.value);
                      setLedgerPage(1);
                    }}
                  />
                </label>
                <label className="text-sm">
                  <div className="text-xs font-medium text-slate-600 mb-1">To</div>
                  <input
                    className="w-full border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    type="date"
                    value={ledgerTo}
                    onChange={(e) => {
                      setLedgerTo(e.target.value);
                      setLedgerPage(1);
                    }}
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  <div className="text-xs font-medium text-slate-600 mb-1">Item</div>
                  <SearchableSelect
                    value={ledgerItemId}
                    onChange={(v) => {
                      setLedgerItemId(v);
                      setLedgerPage(1);
                    }}
                    options={[{ value: '', label: 'All items…' }, ...ledgerItemOptions]}
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  <div className="text-xs font-medium text-slate-600 mb-1">Movement type</div>
                  <SearchableSelect
                    value={ledgerEventType}
                    onChange={(v) => {
                      setLedgerEventType(v);
                      setLedgerPage(1);
                    }}
                    options={ledgerMovementTypeOptions}
                    placeholder="All movements…"
                    searchPlaceholder="Search movement types…"
                    minWidth="w-full"
                    className="w-full"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                <label className="text-sm">
                  <div className="text-xs font-medium text-slate-600 mb-1">Page size</div>
                  <SearchableSelect
                    value={String(ledgerPageSize)}
                    onChange={(v) => {
                      setLedgerPageSize(Number(v));
                      setLedgerPage(1);
                    }}
                    options={tablePageSizeOptions}
                    placeholder="Page size"
                    searchPlaceholder="Search…"
                    minWidth="w-full"
                    className="w-full"
                  />
                </label>
                <div className="flex items-end gap-2">
                  <Button
                    variant="secondary"
                    disabled={ledgerPage <= 1 || ledgerQ.isLoading}
                    onClick={() => setLedgerPage((p) => Math.max(p - 1, 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={
                      ledgerQ.isLoading ||
                      (ledgerQ.data?.total ?? 0) <= ledgerPage * ledgerPageSize
                    }
                    onClick={() => setLedgerPage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
              </div>

              {ledgerQ.isLoading ? (
                <Loader />
              ) : (ledgerQ.data?.items ?? []).length === 0 ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  No ledger rows found for the selected filters.
                </div>
              ) : (
                <>
                  <div className="text-xs text-slate-500 dark:text-slate-400">
                    Showing {(ledgerQ.data?.items ?? []).length} of {ledgerQ.data?.total ?? 0} rows. Page {ledgerQ.data?.page ?? ledgerPage}.
                  </div>
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-left text-slate-600 dark:text-slate-300">
                        <tr>
                          <th className="py-2 pr-4">Time</th>
                          <th className="py-2 pr-4">Type</th>
                          <th className="py-2 pr-4">Item</th>
                          <th className="py-2 pr-4">Location</th>
                          <th className="py-2 pr-4">Lot / Expiry</th>
                          <th className="py-2 pr-4">Qty Δ</th>
                          <th className="py-2 pr-4">Reference</th>
                          <th className="py-2 pr-4">By</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700 dark:text-slate-200">
                        {(ledgerQ.data?.items ?? []).map((r: any) => {
                          const item = itemById.get(Number(r.inventoryItemId));
                          const uomCode = item?.baseUomId ? uomById.get(Number(item.baseUomId))?.code ?? '' : '';
                          const qty = Number(r.qtyDelta ?? 0);
                          const refMeta = getHistoryReferenceMeta(r);
                          const locationLabel = r?.location?.code
                            ? `${r.location.code}${r.location.name ? ` - ${r.location.name}` : ''}`
                            : (r?.location?.name ?? 'Unassigned');
                          const batch = r?.inventoryBatch ?? null;
                          const lot = batch?.lotCode ?? null;
                          const expiry = batch?.expiryDate ?? null;
                          const createdBy = r?.creator?.name ?? (r?.createdBy != null ? `User #${r.createdBy}` : '—');
                          return (
                            <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                              <td className="py-2 pr-4">{formatDateTime(r.createdAt)}</td>
                              <td className="py-2 pr-4">{prettyLedgerEventType(r.eventType)}</td>
                              <td className="py-2 pr-4">
                                <div className="font-medium">
                                  {item?.name ?? `Item #${r.inventoryItemId}`}
                                </div>
                                <div className="text-xs text-slate-500 dark:text-slate-400">{item?.code ?? ''}</div>
                              </td>
                              <td className="py-2 pr-4">{locationLabel || 'Unassigned'}</td>
                              <td className="py-2 pr-4">
                                {r.inventoryBatchId ? (
                                  <div>
                                    <div className="font-medium">
                                      {lot ? `Lot ${lot}` : `Batch #${r.inventoryBatchId}`}
                                    </div>
                                    <div className="text-xs text-slate-500 dark:text-slate-400">
                                      {expiry ? `Expiry ${expiry}` : 'No expiry'}
                                    </div>
                                  </div>
                                ) : (
                                  '—'
                                )}
                              </td>
                              <td className={`py-2 pr-4 ${qty > 0 ? 'text-emerald-700 dark:text-emerald-300' : qty < 0 ? 'text-rose-700 dark:text-rose-300' : ''}`}>
                                {qty > 0 ? `+${formatNumeric(qty, 0, 6)}` : formatNumeric(qty, 0, 6)}
                                {uomCode ? ` ${uomCode}` : ''}
                              </td>
                              <td className="py-2 pr-4">
                                {refMeta?.path ? (
                                  <button
                                    type="button"
                                    className="text-red-700 hover:underline"
                                    onClick={() => navigate(refMeta.path!)}
                                    title="Open source module"
                                  >
                                    {refMeta.label}
                                  </button>
                                ) : (
                                  <span className="text-slate-500 dark:text-slate-400">{refMeta.label}</span>
                                )}
                              </td>
                              <td className="py-2 pr-4">{createdBy}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </>
              )}
            </div>
          )}
        </Card>
      )}

      {tab === 'transfers' && (
        <Card>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Branch transfers</h2>
          {!branchId ? (
            <div className="text-slate-500 dark:text-slate-400">Select a branch.</div>
          ) : (
            <div className="space-y-4">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Workflow: create a <span className="font-medium">transfer request</span>, approve it to create a{' '}
                <span className="font-medium">transfer order</span>, then dispatch from the source branch and receive at
                the destination. Stock and ledger change only on dispatch (source) and receive (destination).
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Lists below include only rows where the selected branch is the source or destination (other branches in
                the same brand are hidden here).
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => setTransferRequestModalOpen(true)}>Create transfer request</Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTransferActionType('dispatch');
                    setTransferActionModalOpen(true);
                  }}
                >
                  Dispatch order
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setTransferActionType('receive');
                    setTransferActionModalOpen(true);
                  }}
                >
                  Receive order
                </Button>
              </div>

              <Card>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">Transfer requests</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Draft of what to move. Approve creates a transfer order; only requests in <span className="font-medium">submitted</span>{' '}
                  status can be approved.
                </p>
                {transferRequestsQ.isLoading ? (
                  <Loader />
                ) : transferRequestsForBranch.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">No transfer requests for this branch.</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-left text-slate-600 dark:text-slate-300">
                        <tr>
                          <th className="py-2 pr-4 w-12">#</th>
                          <th className="py-2 pr-4">Request</th>
                          <th className="py-2 pr-4">Source branch</th>
                          <th className="py-2 pr-4">Destination branch</th>
                          <th className="py-2 pr-4">Status</th>
                          <th className="py-2 pr-4">Created</th>
                          <th className="py-2 pr-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700 dark:text-slate-200">
                        {transferRequestsForBranch.map((r: any, index: number) => (
                          <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                            <td className="py-2 pr-4">{index + 1}</td>
                            <td className="py-2 pr-4 font-medium">REQ-{r.id}</td>
                            <td className="py-2 pr-4">{branchById.get(Number(r.sourceBranchId))?.name ?? '—'}</td>
                            <td className="py-2 pr-4">{branchById.get(Number(r.destinationBranchId))?.name ?? '—'}</td>
                            <td className="py-2 pr-4">{r.status}</td>
                            <td className="py-2 pr-4">{formatDateTime(r.createdAt)}</td>
                            <td className="py-2 pr-4">
                              <div className="flex flex-wrap gap-2">
                                <Button variant="secondary" onClick={() => setSelectedTransferRequest(r)}>
                                  View
                                </Button>
                                {String(r.status ?? '') === 'submitted' ? (
                                  <Button onClick={() => approveTransferRequestM.mutate(r.id)}>Approve</Button>
                                ) : null}
                              </div>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>

              <Card>
                <h3 className="text-base font-semibold text-slate-800 dark:text-slate-100 mb-1">Transfer orders</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-3">
                  Created when a request is approved. Use <span className="font-medium">Dispatch order</span> /{' '}
                  <span className="font-medium">Receive order</span> above to move stock; status reflects dispatch and receipt progress.
                </p>
                {transferOrdersQ.isLoading ? (
                  <Loader />
                ) : transferOrdersForBranch.length === 0 ? (
                  <div className="text-sm text-slate-500 dark:text-slate-400">No transfer orders for this branch.</div>
                ) : (
                  <div className="overflow-auto">
                    <table className="min-w-full text-sm">
                      <thead className="text-left text-slate-600 dark:text-slate-300">
                        <tr>
                          <th className="py-2 pr-4 w-12">#</th>
                          <th className="py-2 pr-4">Order</th>
                          <th className="py-2 pr-4">Source branch</th>
                          <th className="py-2 pr-4">Destination branch</th>
                          <th className="py-2 pr-4">Status</th>
                          <th className="py-2 pr-4">Created</th>
                          <th className="py-2 pr-4">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="text-slate-700 dark:text-slate-200">
                        {transferOrdersForBranch.map((o: any, index: number) => (
                          <tr key={o.id} className="border-t border-slate-100 dark:border-slate-700">
                            <td className="py-2 pr-4">{index + 1}</td>
                            <td className="py-2 pr-4 font-medium">TO-{o.id}</td>
                            <td className="py-2 pr-4">{branchById.get(Number(o.sourceBranchId))?.name ?? '—'}</td>
                            <td className="py-2 pr-4">{branchById.get(Number(o.destinationBranchId))?.name ?? '—'}</td>
                            <td className="py-2 pr-4">{o.status}</td>
                            <td className="py-2 pr-4">{formatDateTime(o.createdAt)}</td>
                            <td className="py-2 pr-4">
                              <div className="flex flex-wrap gap-2">
                                <Button variant="secondary" onClick={() => setSelectedTransferOrder(o)}>
                                  View
                                </Button>
                              </div>
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
        </Card>
      )}

      {tab === 'adjustments' && (
        <Card>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Adjustments</h2>
          {!branchId ? (
            <div className="text-slate-500 dark:text-slate-400">Select a branch.</div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Use adjustment only for stock mismatch corrections. OUT decreases stock, IN increases stock.
              </div>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Draft adjustments do not change inventory or ledger until posted.
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={openCreateAdjustment}>Create adjustment</Button>
              </div>

              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 pr-4 w-12">#</th>
                      <th className="py-2 pr-4">Reference</th>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Reason</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Items</th>
                      <th className="py-2 pr-4">Qty total</th>
                      <th className="py-2 pr-4">Created</th>
                      <th className="py-2 pr-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {groupedAdjustments.map((g: any, index: number) => (
                      <tr key={g.reference} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4">{index + 1}</td>
                        <td className="py-2 pr-4 font-medium">
                          <button
                            type="button"
                            className="text-red-700 hover:underline"
                            onClick={() => setSelectedAdjustment(g)}
                          >
                            {g.reference}
                          </button>
                        </td>
                        <td className="py-2 pr-4">{g.typeLabel}</td>
                        <td className="py-2 pr-4">{g.reason}</td>
                        <td className="py-2 pr-4">{g.status}</td>
                        <td className="py-2 pr-4">{g.itemCount}</td>
                        <td className="py-2 pr-4">{formatNumeric(g.totalQtyBase, 0, 6)}</td>
                        <td className="py-2 pr-4">{formatDateTime(g.createdAt)}</td>
                        <td className="py-2 pr-4 flex gap-2">
                          <Button variant="secondary" onClick={() => setSelectedAdjustment(g)}>View</Button>
                          {(g.adjustments ?? []).every((a: any) => String(a?.status ?? '') === 'draft') ? (
                            <Button variant="secondary" onClick={() => openEditAdjustmentGroup(g)}>
                              Edit
                            </Button>
                          ) : null}
                          <Button
                            disabled={String(g.status) !== 'draft'}
                            onClick={() => {
                              (async () => {
                                const draftIds = (g.adjustments ?? [])
                                  .filter((a: any) => String(a.status ?? '') === 'draft')
                                  .map((a: any) => Number(a.id))
                                  .filter((id: number) => Number.isInteger(id) && id > 0);
                                if (draftIds.length === 0) return;
                                for (const id of draftIds) {
                                  await inventoryService.postAdjustment(id);
                                }
                                toast.success('Adjustment posted');
                                await queryClient.invalidateQueries({ queryKey: ['inventory-adjustments', branchId] });
                                await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
                                await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
                              })().catch((e: any) => toast.error(readApiError(e, 'Failed to post adjustment')));
                            }}
                          >
                            Post
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === 'alerts' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Low stock</h2>
              {branchId && (
                <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['inventory-lowstock', branchId] })}>
                  Refresh
                </Button>
              )}
            </div>
            {!branchId ? (
              <div className="text-slate-500 dark:text-slate-400">Select a branch.</div>
            ) : lowStockQ.isLoading ? (
              <Loader />
            ) : (
              <div className="space-y-2">
                {(lowStockQ.data ?? []).length === 0 ? (
                  <div className="text-slate-500 dark:text-slate-400">No alerts.</div>
                ) : (
                  (lowStockQ.data ?? []).map((a: any) => (
                    <div key={a.inventory_item_id} className="flex items-center justify-between border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                      <div>
                        <div className="font-medium">{a.item_name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{a.item_code}</div>
                      </div>
                      <div className="text-right text-sm">
                        <div>On-hand: <span className="font-semibold text-red-600">{a.on_hand_qty}</span></div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">Reorder: {a.reorder_point}</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>

          <Card>
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Near expiry</h2>
              {branchId && (
                <Button onClick={async () => {
                  await queryClient.invalidateQueries({ queryKey: ['inventory-nearexpiry', branchId] });
                  await queryClient.invalidateQueries({ queryKey: ['inventory-expiry-coverage-warnings', branchId] });
                }}>
                  Refresh
                </Button>
              )}
            </div>
            {!branchId ? (
              <div className="text-slate-500 dark:text-slate-400">Select a branch.</div>
            ) : nearExpiryQ.isLoading ? (
              <Loader />
            ) : (
              <div className="space-y-2">
                {(expiryCoverageWarningsQ.data ?? []).map((w: any) => (
                  <div key={w.inventory_item_id} className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-amber-800">
                    <div className="font-medium">{w.warning}</div>
                    <div className="text-xs">
                      {w.item_name} ({w.item_code}) has on-hand {w.on_hand_qty} but no available expiry-dated batches.
                    </div>
                  </div>
                ))}
                {(nearExpiryQ.data ?? []).length === 0 ? (
                  <div className="text-slate-500 dark:text-slate-400">No alerts.</div>
                ) : (
                  (nearExpiryQ.data ?? []).map((a: any) => (
                    <div key={a.batch_id} className="flex items-center justify-between border border-slate-200 dark:border-slate-700 rounded-lg p-3">
                      <div>
                        <div className="font-medium">{a.item_name}</div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">{a.item_code} · Batch {a.batch_id}</div>
                      </div>
                      <div className="text-right text-sm">
                        <div>Expiry: <span className="font-semibold">{a.expiry_date}</span></div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">Qty: {a.on_hand_qty} · {a.days_to_expiry} days</div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}
          </Card>
        </div>
      )}

      {tab === 'uoms' && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Units of measure</h2>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Used for purchasing, recipes, stock counts, and conversions (e.g., kilogram, gram, liter).
              </div>
            </div>
            <Button onClick={openCreateUom}>Create unit</Button>
          </div>
          {uomsQ.isLoading ? (
            <Loader />
          ) : (
            <>
              <div className="overflow-auto">
                <table className="w-full table-auto text-sm">
                  <thead className="text-left text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 pr-4 w-16">#</th>
                      <th className="py-2 pr-4 w-40">Code</th>
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4 w-32">Kind</th>
                      <th className="py-2 pr-4">Base unit</th>
                      <th className="py-2 pr-4 w-40">Multiplier to base</th>
                      <th className="py-2 pr-4 w-44">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(uomsQ.data ?? []).map((u: any, index: number) => (
                      <tr key={u.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4">{index + 1}</td>
                        <td className="py-2 pr-4">{u.code}</td>
                        <td className="py-2 pr-4">{u.name}</td>
                        <td className="py-2 pr-4">{u.kind ?? '—'}</td>
                        <td className="py-2 pr-4">
                          {u.baseUomId != null ? (uomById.get(Number(u.baseUomId))?.code ?? `#${u.baseUomId}`) : '—'}
                        </td>
                        <td className="py-2 pr-4">
                          {u.multiplierToBase != null ? Number(u.multiplierToBase) : '—'}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex gap-2">
                            <Button
                              onClick={() => openEditUom(u)}
                            >
                              Edit
                            </Button>
                            <Button
                              onClick={() => {
                                (async () => {
                                  const ok = await confirmDialog({
                                    title: `Delete unit of measure "${u.code}"?`,
                                    text: 'This can affect recipes and purchasing.',
                                    confirmText: 'Delete',
                                    cancelText: 'Cancel',
                                  });
                                  if (!ok) return;
                                  deleteUomM.mutate(u.id);
                                })();
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Modal
                isOpen={uomModalOpen}
                onClose={closeUomModal}
                title={form.uom_edit_id ? 'Edit unit of measure' : 'Create unit of measure'}
                size="medium"
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 gap-3">
                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">
                        Name <span className="text-red-600">*</span>
                      </div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        placeholder="e.g. Kilogram"
                        value={form.uom_name ?? ''}
                        onChange={(e) => setForm({ ...form, uom_name: e.target.value })}
                      />
                    </label>
                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">
                        Code <span className="text-red-600">*</span>
                      </div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        placeholder="e.g. kg"
                        value={form.uom_code ?? ''}
                        onChange={(e) => setForm({ ...form, uom_code: e.target.value })}
                      />
                    </label>
                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">
                        Kind <span className="text-red-600">*</span>
                      </div>
                      <SearchableSelect
                        value={String(form.uom_kind ?? 'count')}
                        onChange={(v) =>
                          setForm({
                            ...form,
                            uom_kind: v,
                            uom_base_uom_id: '',
                            uom_multiplier_to_base: '',
                          })
                        }
                        options={uomKindSelectOptions}
                        placeholder="Kind"
                        searchPlaceholder="Search kinds…"
                        minWidth="w-full"
                        className="w-full"
                      />
                    </label>
                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">Base unit (optional)</div>
                      <SearchableSelect
                        value={String(form.uom_base_uom_id ?? '')}
                        onChange={(v) => setForm({ ...form, uom_base_uom_id: v })}
                        options={uomBaseUomSelectOptions}
                        placeholder="None (this is a base unit)"
                        searchPlaceholder="Search units…"
                        minWidth="w-full"
                        className="w-full"
                      />
                    </label>
                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">Multiplier to base</div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        placeholder="e.g. 1000"
                        value={form.uom_multiplier_to_base ?? ''}
                        onChange={(e) => setForm({ ...form, uom_multiplier_to_base: e.target.value })}
                        disabled={!String(form.uom_base_uom_id ?? '').trim()}
                      />
                    </label>
                    <div className="text-xs text-slate-500">
                      Required fields are marked with <span className="text-red-600">*</span>. If a base unit is selected,
                      multiplier to base must be greater than 0.
                    </div>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="secondary" onClick={closeUomModal}>
                      Cancel
                    </Button>
                    <Button onClick={submitUom}>
                      {form.uom_edit_id ? 'Save changes' : 'Create'}
                    </Button>
                  </div>
                </div>
              </Modal>
            </>
          )}
        </Card>
      )}

      {tab === 'vendors' && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Vendors</h2>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Suppliers, warehouses, or “branch vendors” used for procurement workflows.
              </div>
            </div>
            <Button onClick={openCreateVendor}>Create vendor</Button>
          </div>
          {vendorsQ.isLoading ? <Loader /> : (
            <>
              <div className="overflow-auto">
                <table className="w-full table-auto text-sm">
                  <thead className="text-left text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4 w-36">Type</th>
                      <th className="py-2 pr-4">Linked branch</th>
                      <th className="py-2 pr-4">Contact</th>
                      <th className="py-2 pr-4 w-44">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(vendorsQ.data ?? []).map((v: any) => (
                      <tr key={v.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4 font-medium">{v.name}</td>
                        <td className="py-2 pr-4">{v.type}</td>
                        <td className="py-2 pr-4">
                          {v.linkedBranchId
                            ? (branches ?? []).find((b: any) => Number(b.id) === Number(v.linkedBranchId))?.name ??
                              `Branch #${v.linkedBranchId}`
                            : '—'}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="text-xs text-slate-600 dark:text-slate-300">
                            {v.email ? <div>Email: {v.email}</div> : null}
                            {v.phone ? <div>Phone: {v.phone}</div> : null}
                          </div>
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex gap-2">
                            <Button onClick={() => openEditVendor(v)}>Edit</Button>
                            <Button
                              onClick={() => {
                                (async () => {
                                  const ok = await confirmDialog({
                                    title: `Delete vendor "${v.name}"?`,
                                    text: 'This can affect purchasing and goods receiving.',
                                    confirmText: 'Delete',
                                  });
                                  if (!ok) return;
                                  deleteVendorM.mutate(v.id);
                                })();
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Modal
                isOpen={vendorModalOpen}
                onClose={closeVendorModal}
                title={form.vendor_edit_id ? 'Edit vendor' : 'Create vendor'}
                size="large"
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">
                        Name <span className="text-red-600">*</span>
                      </div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        placeholder="e.g. ABC Foods Supplier"
                        value={form.vendor_name ?? ''}
                        onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
                      />
                    </label>

                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">Type</div>
                      <SearchableSelect
                        value={String(form.vendor_type ?? 'supplier')}
                        onChange={(v) => setForm({ ...form, vendor_type: v })}
                        options={vendorTypeOptions}
                        placeholder="Type"
                        searchPlaceholder="Search types…"
                        minWidth="w-full"
                        className="w-full"
                      />
                    </label>

                    <label className="text-sm lg:col-span-2">
                      <div className="text-xs font-medium text-slate-600 mb-1">Linked branch (optional)</div>
                      <SearchableSelect
                        value={String(form.vendor_linked_branch_id ?? '')}
                        onChange={(v) => setForm({ ...form, vendor_linked_branch_id: v })}
                        options={[{ value: '', label: 'None' }, ...branchSearchableOptions]}
                        placeholder="None"
                        searchPlaceholder="Search branches…"
                        minWidth="w-full"
                        className="w-full"
                      />
                      <div className="text-xs text-slate-500 mt-1">
                        Use this only when the “vendor” is actually another branch or your central warehouse branch.
                      </div>
                    </label>

                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">Email (optional)</div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        placeholder="email@example.com"
                        value={form.vendor_email ?? ''}
                        onChange={(e) => setForm({ ...form, vendor_email: e.target.value })}
                      />
                    </label>

                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">Phone (optional)</div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        placeholder="+92..."
                        value={form.vendor_phone ?? ''}
                        onChange={(e) => setForm({ ...form, vendor_phone: e.target.value })}
                      />
                    </label>

                    <label className="text-sm lg:col-span-2">
                      <div className="text-xs font-medium text-slate-600 mb-1">Address (optional)</div>
                      <textarea
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        rows={3}
                        value={form.vendor_address ?? ''}
                        onChange={(e) => setForm({ ...form, vendor_address: e.target.value })}
                      />
                    </label>
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="secondary" onClick={closeVendorModal}>
                      Cancel
                    </Button>
                    <Button onClick={submitVendor}>
                      {form.vendor_edit_id ? 'Save changes' : 'Create'}
                    </Button>
                  </div>
                </div>
              </Modal>
            </>
          )}
        </Card>
      )}

      {tab === 'items' && (
        <Card>
          <div className="flex items-center justify-between mb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Inventory items</h2>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Items you buy/stock (ingredients, packaging). Expiry is recorded as a <span className="font-medium">date</span> when receiving goods.
              </div>
            </div>
            <Button onClick={openCreateItem}>Create item</Button>
          </div>
          {itemsQ.isLoading ? <Loader /> : (
            <>
              <div className="overflow-auto">
                <table className="w-full table-auto text-sm">
                  <thead className="text-left text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 pr-4 w-16">#</th>
                      <th className="py-2 pr-4 w-40">Code</th>
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4 w-40">Base unit</th>
                      <th className="py-2 pr-4 w-40">Buy price</th>
                      <th className="py-2 pr-4 w-56">Expiry settings</th>
                      <th className="py-2 pr-4 w-44">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(itemsQ.data ?? []).map((it: any, index: number) => (
                      <tr key={it.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4">{index + 1}</td>
                        <td className="py-2 pr-4">{it.code}</td>
                        <td className="py-2 pr-4 font-medium">{it.name}</td>
                        <td className="py-2 pr-4">
                          {(() => {
                            const ids = Array.isArray(it.baseUomIds) && it.baseUomIds.length > 0
                              ? it.baseUomIds
                              : [it.baseUomId];
                            return ids
                              .map((id: number) => uomById.get(Number(id))?.code ?? `#${id}`)
                              .join(', ');
                          })()}
                        </td>
                        <td className="py-2 pr-4">
                          {it.defaultBuyPrice == null
                            ? '—'
                            : Number(it.defaultBuyPrice).toLocaleString(undefined, {
                                minimumFractionDigits: 2,
                                maximumFractionDigits: 6,
                              })}
                        </td>
                        <td className="py-2 pr-4">
                          {it.trackExpiry ? (
                            <div className="text-xs">
                              <div className="font-medium">Expiry date required</div>
                              <div className="text-slate-500 dark:text-slate-400">
                                Near-expiry alert: {it.defaultNearExpiryDays ?? '—'} days
                              </div>
                            </div>
                          ) : (
                            <div className="text-xs text-slate-600 dark:text-slate-300">No expiry tracking</div>
                          )}
                        </td>
                        <td className="py-2 pr-4">
                          <div className="flex gap-2">
                            <Button onClick={() => openEditItem(it)}>Edit</Button>
                            <Button
                              onClick={() => {
                                (async () => {
                                  const ok = await confirmDialog({
                                    title: `Delete item "${it.name}"?`,
                                    text: 'This can affect recipes, purchasing, and stock.',
                                    confirmText: 'Delete',
                                  });
                                  if (!ok) return;
                                  deleteItemM.mutate(it.id);
                                })();
                              }}
                            >
                              Delete
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Modal
                isOpen={itemModalOpen}
                onClose={closeItemModal}
                title={form.item_edit_id ? 'Edit inventory item' : 'Create inventory item'}
                size="xlarge"
              >
                <div className="space-y-4">
                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">
                        Name <span className="text-red-600">*</span>
                      </div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        placeholder="e.g. Chicken breast"
                        value={form.item_name ?? ''}
                        onChange={(e) => handleItemNameChange(e.target.value)}
                      />
                    </label>

                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">
                        Code / SKU <span className="text-red-600">*</span>
                      </div>
                      <div className="flex items-stretch gap-2">
                        <input
                          className="w-full border rounded-lg p-2 bg-white border-slate-200"
                          placeholder="e.g. CHK-BRST"
                          value={form.item_code ?? ''}
                          onChange={(e) => handleItemCodeChange(e.target.value)}
                        />
                        <Button
                          variant="outline"
                          size="small"
                          className="whitespace-nowrap px-3"
                          onClick={regenerateItemSku}
                        >
                          Regenerate SKU
                        </Button>
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        Auto-generated from name, but you can edit it. SKU must be unique.
                      </div>
                    </label>

                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">
                        Base units <span className="text-red-600">*</span>
                      </div>
                      <div className="relative">
                        <button
                          type="button"
                          className="w-full border rounded-lg p-2 bg-white border-slate-200 text-left text-sm"
                          onClick={() => setItemBaseUnitDropdownOpen((v) => !v)}
                        >
                          {Array.isArray(form.item_base_uom_ids) && form.item_base_uom_ids.length > 0
                            ? `${form.item_base_uom_ids.length} selected`
                            : 'Select one or more units'}
                        </button>
                        {itemBaseUnitDropdownOpen && (
                          <div className="absolute z-20 mt-1 w-full rounded-lg border border-slate-200 bg-white shadow-lg p-2">
                            <input
                              className="w-full border rounded-md p-2 bg-white border-slate-200 text-sm mb-2"
                              placeholder="Search units..."
                              value={itemBaseUnitSearch}
                              onChange={(e) => setItemBaseUnitSearch(e.target.value)}
                            />
                            <div className="max-h-44 overflow-auto space-y-1">
                              {(uomsQ.data ?? [])
                                .filter((u: any) => {
                                  const q = itemBaseUnitSearch.trim().toLowerCase();
                                  if (!q) return true;
                                  return (
                                    String(u.code ?? '').toLowerCase().includes(q) ||
                                    String(u.name ?? '').toLowerCase().includes(q)
                                  );
                                })
                                .map((u: any) => {
                                  const id = String(u.id);
                                  const selected =
                                    Array.isArray(form.item_base_uom_ids) &&
                                    form.item_base_uom_ids.includes(id);
                                  return (
                                    <label
                                      key={u.id}
                                      className={`flex items-center justify-between rounded px-2 py-1 cursor-pointer ${
                                        selected ? 'bg-red-50' : 'hover:bg-slate-50'
                                      }`}
                                    >
                                      <span className="text-sm text-slate-700">{u.code} - {u.name}</span>
                                      <input
                                        type="checkbox"
                                        checked={selected}
                                        onChange={() => toggleItemBaseUom(id)}
                                        className="rounded border-slate-300 text-red-600 focus:ring-red-500"
                                      />
                                    </label>
                                  );
                                })}
                            </div>
                          </div>
                        )}
                      </div>
                      {Array.isArray(form.item_base_uom_ids) && form.item_base_uom_ids.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {form.item_base_uom_ids.map((id: string, idx: number) => {
                            const uom = (uomsQ.data ?? []).find((u: any) => String(u.id) === id);
                            if (!uom) return null;
                            return (
                              <span
                                key={`${id}-${idx}`}
                                className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs ${
                                  idx === 0 ? 'bg-red-100 text-red-700' : 'bg-slate-100 text-slate-700'
                                }`}
                              >
                                {uom.code}
                                {idx === 0 ? ' (Primary)' : ''}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      <div className="text-xs text-slate-500 mt-1">
                        Select one or more units. First selected unit is used as primary for stock conversion.
                      </div>
                      <div className="text-xs text-slate-500 mt-1">
                        For non-comparable families (e.g., mass vs volume), create separate inventory items.
                      </div>
                    </label>

                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">Expiry date on receiving</div>
                      <SearchableSelect
                        value={String(form.item_expiry_required ?? 'yes')}
                        onChange={(v) => setForm({ ...form, item_expiry_required: v })}
                        options={itemExpiryRequiredOptions}
                        placeholder="Expiry on receiving"
                        searchPlaceholder="Search…"
                        minWidth="w-full"
                        className="w-full"
                      />
                      <div className="text-xs text-slate-500 mt-1">
                        Expiry itself is stored as a <span className="font-medium">date</span> on each received batch.
                      </div>
                    </label>

                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">Near-expiry alert (days)</div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        placeholder="e.g. 3"
                        value={form.item_near_expiry_days ?? ''}
                        onChange={(e) => setForm({ ...form, item_near_expiry_days: e.target.value })}
                        disabled={(form.item_expiry_required ?? 'yes') !== 'yes'}
                      />
                      <div className="text-xs text-slate-500 mt-1">Alerts will show batches expiring within this many days.</div>
                    </label>

                    <label className="text-sm lg:col-span-2">
                      <div className="text-xs font-medium text-slate-600 mb-1">Default reorder point (optional)</div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        placeholder="e.g. 10"
                        value={form.item_reorder_point ?? ''}
                        onChange={(e) => setForm({ ...form, item_reorder_point: e.target.value })}
                      />
                    </label>

                    <label className="text-sm lg:col-span-2">
                      <div className="text-xs font-medium text-slate-600 mb-1">
                        Default buying price <span className="text-red-600">*</span>
                      </div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        type="number"
                        inputMode="decimal"
                        min="0"
                        step="any"
                        placeholder="e.g. 120.00"
                        value={form.item_buy_price ?? ''}
                        onChange={(e) => setForm({ ...form, item_buy_price: e.target.value })}
                        required
                      />
                      <div className="text-xs text-slate-500 mt-1">
                        Stored per primary unit; used to prefill procurement costs.
                      </div>
                    </label>
                  </div>

                  <div className="text-xs text-slate-500">
                    Required fields are marked with <span className="text-red-600">*</span>.
                  </div>

                  <div className="flex justify-end gap-2 pt-2">
                    <Button variant="secondary" onClick={closeItemModal}>
                      Cancel
                    </Button>
                    <Button onClick={submitItem}>
                      {form.item_edit_id ? 'Save changes' : 'Create'}
                    </Button>
                  </div>
                </div>
              </Modal>
            </>
          )}
        </Card>
      )}

      {tab === 'wastage' && (
        <Card>
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div>
              <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100">Record wastage</h2>
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Record damaged, spoiled, or discarded stock. Wastage creates a stock-out movement in the ledger.
              </div>
            </div>
            <Button disabled={!branchId} onClick={() => setWastageModalOpen(true)}>Record wastage</Button>
          </div>
          {!branchId ? (
            <div className="text-slate-500 dark:text-slate-400">Select a branch.</div>
          ) : itemsQ.isLoading ? (
            <Loader />
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
                <label className="text-sm">
                  <div className="text-xs font-medium text-slate-600 mb-1">From</div>
                  <input
                    className="w-full border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    type="date"
                    value={wastageFrom}
                    onChange={(e) => {
                      setWastageFrom(e.target.value);
                      setWastagePage(1);
                    }}
                  />
                </label>
                <label className="text-sm">
                  <div className="text-xs font-medium text-slate-600 mb-1">To</div>
                  <input
                    className="w-full border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    type="date"
                    value={wastageTo}
                    onChange={(e) => {
                      setWastageTo(e.target.value);
                      setWastagePage(1);
                    }}
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  <div className="text-xs font-medium text-slate-600 mb-1">Item</div>
                  <SearchableSelect
                    value={wastageItemId}
                    onChange={(v) => {
                      setWastageItemId(v);
                      setWastagePage(1);
                    }}
                    options={[{ value: '', label: 'All items…' }, ...ledgerItemOptions]}
                  />
                </label>
                <label className="text-sm md:col-span-2">
                  <div className="text-xs font-medium text-slate-600 mb-1">Reason contains</div>
                  <input
                    className="w-full border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                    placeholder="e.g. spoiled"
                    value={wastageReason}
                    onChange={(e) => {
                      setWastageReason(e.target.value);
                      setWastagePage(1);
                    }}
                  />
                </label>
              </div>

              <div className="flex flex-wrap items-end justify-between gap-2">
                <div className="flex items-end gap-2">
                  <label className="text-sm">
                    <div className="text-xs font-medium text-slate-600 mb-1">Page size</div>
                    <SearchableSelect
                      value={String(wastagePageSize)}
                      onChange={(v) => {
                        setWastagePageSize(Number(v));
                        setWastagePage(1);
                      }}
                      options={tablePageSizeOptions}
                      placeholder="Page size"
                      searchPlaceholder="Search…"
                      minWidth="min-w-[100px]"
                      className="border rounded-lg"
                    />
                  </label>
                  <Button
                    variant="secondary"
                    disabled={wastagePage <= 1 || wastageQ.isLoading}
                    onClick={() => setWastagePage((p) => Math.max(p - 1, 1))}
                  >
                    Prev
                  </Button>
                  <Button
                    variant="secondary"
                    disabled={
                      wastageQ.isLoading ||
                      (wastageQ.data?.total ?? 0) <= wastagePage * wastagePageSize
                    }
                    onClick={() => setWastagePage((p) => p + 1)}
                  >
                    Next
                  </Button>
                </div>
                <Button
                  variant="secondary"
                  onClick={() => {
                    setWastageFrom('');
                    setWastageTo('');
                    setWastageItemId('');
                    setWastageReason('');
                    setWastagePage(1);
                    setWastagePageSize(50);
                  }}
                >
                  Clear filters
                </Button>
              </div>

              {wastageQ.isLoading ? (
                <Loader />
              ) : (wastageQ.data?.items ?? []).length === 0 ? (
                <div className="text-sm text-slate-500 dark:text-slate-400">
                  No wastage entries found for the selected filters.
                </div>
              ) : (
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="py-2 pr-4 w-12">#</th>
                        <th className="py-2 pr-4">Time</th>
                        <th className="py-2 pr-4">Item</th>
                        <th className="py-2 pr-4">Qty</th>
                        <th className="py-2 pr-4">Reason</th>
                        <th className="py-2 pr-4">Reference</th>
                        <th className="py-2 pr-4">By</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700 dark:text-slate-200">
                      {(wastageQ.data?.items ?? []).map((w: any, index: number) => {
                        const item = itemById.get(Number(w.inventoryItemId));
                        const uomCode = item?.baseUomId ? uomById.get(Number(item.baseUomId))?.code ?? '' : '';
                        const createdBy = w?.creator?.name ?? (w?.createdBy != null ? `User #${w.createdBy}` : '—');
                        const serial = (Number(wastageQ.data?.page ?? wastagePage) - 1) * wastagePageSize + index + 1;
                        return (
                          <tr key={w.id} className="border-t border-slate-100 dark:border-slate-700">
                            <td className="py-2 pr-4">{serial}</td>
                            <td className="py-2 pr-4">{formatDateTime(w.createdAt)}</td>
                            <td className="py-2 pr-4">
                              <div className="font-medium">{item?.name ?? `Item #${w.inventoryItemId}`}</div>
                              <div className="text-xs text-slate-500 dark:text-slate-400">{item?.code ?? ''}</div>
                            </td>
                            <td className="py-2 pr-4">
                              <span className="text-rose-700 dark:text-rose-300">
                                -{formatNumeric(Number(w.qty ?? 0), 0, 6)}
                              </span>{' '}
                              {uomCode}
                            </td>
                            <td className="py-2 pr-4">{w.reason ?? '—'}</td>
                            <td className="py-2 pr-4 font-medium">{w?.id != null ? `WST-${w.id}` : '—'}</td>
                            <td className="py-2 pr-4">{createdBy}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      {tab === 'stocktake' && (
        <Card>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Finance Day stocktake</h2>
          {!branchId ? (
            <div className="text-slate-500 dark:text-slate-400">Select a branch.</div>
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Create the weekly stocktake first, then add count lines. After review, submit and close to post variance.
              </div>
              <div className="flex flex-wrap gap-2 items-center">
                <Button onClick={() => setStocktakeCreateModalOpen(true)}>Create / Load stocktake</Button>
                <Button
                  variant="secondary"
                  disabled={!form.stocktake_id}
                  onClick={() => setStocktakeLineModalOpen(true)}
                >
                  Add counted line
                </Button>
                <span className="text-sm text-slate-600 dark:text-slate-300">
                  Active stocktake: {form.stocktake_id ? `#${form.stocktake_id}` : 'None selected'}
                </span>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button onClick={() => submitStocktakeM.mutate(Number(form.stocktake_id))}>Submit</Button>
                <Button onClick={() => closeStocktakeM.mutate(Number(form.stocktake_id))}>Close (post variance)</Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {tab === 'weekly' && (
        <Card>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Weekly usage (ledger summary)</h2>
          {!branchId ? (
            <div className="text-slate-500 dark:text-slate-400">Select a branch.</div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                <input
                  className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  placeholder="From (YYYY-MM-DD)"
                  value={form.weekly_from ?? ''}
                  onChange={(e) => setForm({ ...form, weekly_from: e.target.value })}
                />
                <input
                  className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  placeholder="To (YYYY-MM-DD)"
                  value={form.weekly_to ?? ''}
                  onChange={(e) => setForm({ ...form, weekly_to: e.target.value })}
                />
                <Button onClick={() => weeklyUsageM.mutate({ from: form.weekly_from, to: form.weekly_to })}>
                  Generate
                </Button>
              </div>

              {weeklyUsageM.data && (
                <div className="overflow-auto">
                  <table className="min-w-full text-sm">
                    <thead className="text-left text-slate-600 dark:text-slate-300">
                      <tr>
                        <th className="py-2 pr-4">Item ID</th>
                        <th className="py-2 pr-4">Movements</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-700 dark:text-slate-200">
                      {(weeklyUsageM.data.items ?? []).map((it: any) => (
                        <tr key={it.inventory_item_id} className="border-t border-slate-100 dark:border-slate-700">
                          <td className="py-2 pr-4">{it.inventory_item_id}</td>
                          <td className="py-2 pr-4">
                            <pre className="text-xs whitespace-pre-wrap">{JSON.stringify(it.movements, null, 2)}</pre>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </Card>
      )}

      <Modal
        isOpen={transferRequestModalOpen}
        onClose={() => setTransferRequestModalOpen(false)}
        title="Create transfer request"
        size="large"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Source branch</div>
              <input
                className="w-full border rounded-lg p-2 bg-slate-50 border-slate-200"
                value={branchById.get(Number(branchId))?.name ?? ''}
                readOnly
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Destination branch</div>
              <SearchableSelect
                value={String(form.tr_destination_branch_id ?? '')}
                onChange={(v) => setForm({ ...form, tr_destination_branch_id: v })}
                options={transferDestinationBranchOptions}
                placeholder="Select destination branch…"
                searchPlaceholder="Search branches…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Item</div>
              <SearchableSelect
                value={String(form.tr_item_id ?? '')}
                onChange={(v) => {
                  const itemId = Number(v);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    tr_item_id: v,
                    tr_uom_id: getDefaultItemUomId(selected),
                  });
                }}
                options={itemNameSelectOptions}
                placeholder="Select item…"
                searchPlaceholder="Search items…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Requested quantity</div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                placeholder="e.g. 10"
                value={form.tr_qty ?? ''}
                onChange={(e) => setForm({ ...form, tr_qty: e.target.value })}
              />
            </label>
            <label className="text-sm lg:col-span-2">
              <div className="text-xs font-medium text-slate-600 mb-1">Unit</div>
              <SearchableSelect
                value={String(form.tr_uom_id ?? '')}
                onChange={(v) => setForm({ ...form, tr_uom_id: v })}
                options={getItemAllowedUoms(selectedTransferRequestItem, form.tr_uom_id).map((u: any) => ({
                  value: String(u.id),
                  label: u.code,
                }))}
                placeholder="Select unit…"
                searchPlaceholder="Search units…"
                minWidth="w-full"
                className="w-full"
                disabled={!selectedTransferRequestItem}
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">
                Lot / batch code {(form.adj_type ?? 'out') === 'in' ? '(optional)' : '(only for IN)'}
              </div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.adj_lot_code ?? ''}
                onChange={(e) => setForm({ ...form, adj_lot_code: e.target.value })}
                placeholder="e.g. ADJ-LOT-01"
                disabled={(form.adj_type ?? 'out') !== 'in'}
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">
                Expiry date
                {(form.adj_type ?? 'out') === 'in'
                  ? selectedAdjustmentItem?.trackExpiry
                    ? ' (required for this item)'
                    : ' (optional)'
                  : ' (only for IN)'}
              </div>
              <input
                type="date"
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.adj_expiry_date ?? ''}
                onChange={(e) => setForm({ ...form, adj_expiry_date: e.target.value })}
                disabled={(form.adj_type ?? 'out') !== 'in'}
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setTransferRequestModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!branchId || !form.tr_destination_branch_id || !form.tr_item_id || !form.tr_qty || !form.tr_uom_id) {
                  toast.error('Please fill all required fields');
                  return;
                }
                createTransferRequestM.mutate({
                  source_branch_id: Number(branchId),
                  destination_branch_id: Number(form.tr_destination_branch_id),
                  lines: [
                    {
                      inventory_item_id: Number(form.tr_item_id),
                      requested_qty: Number(form.tr_qty),
                      requested_uom_id: Number(form.tr_uom_id),
                    },
                  ],
                });
                setTransferRequestModalOpen(false);
              }}
            >
              Create request
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={transferActionModalOpen}
        onClose={() => setTransferActionModalOpen(false)}
        title={transferActionType === 'dispatch' ? 'Dispatch transfer order' : 'Receive transfer order'}
        size="large"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Transfer order</div>
              <SearchableSelect
                value={String(form.tr_order_id ?? '')}
                onChange={(v) => setForm({ ...form, tr_order_id: v })}
                options={transferOrderSelectOptions}
                placeholder="Select order…"
                searchPlaceholder="Search transfer orders…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Item</div>
              <SearchableSelect
                value={String(form.tr_order_item_id ?? '')}
                onChange={(v) => {
                  const itemId = Number(v);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    tr_order_item_id: v,
                    tr_order_uom_id: getDefaultItemUomId(selected),
                  });
                }}
                options={itemNameSelectOptions}
                placeholder="Select item…"
                searchPlaceholder="Search items…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Quantity</div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.tr_order_qty ?? ''}
                onChange={(e) => setForm({ ...form, tr_order_qty: e.target.value })}
                placeholder="e.g. 5"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Unit</div>
              <SearchableSelect
                value={String(form.tr_order_uom_id ?? '')}
                onChange={(v) => setForm({ ...form, tr_order_uom_id: v })}
                options={getItemAllowedUoms(selectedTransferOrderItem, form.tr_order_uom_id).map((u: any) => ({
                  value: String(u.id),
                  label: u.code,
                }))}
                placeholder="Select unit…"
                searchPlaceholder="Search units…"
                minWidth="w-full"
                className="w-full"
                disabled={!selectedTransferOrderItem}
              />
            </label>
            {transferActionType === 'receive' && (
              <>
                <label className="text-sm">
                  <div className="text-xs font-medium text-slate-600 mb-1">Lot / batch code (optional)</div>
                  <input
                    className="w-full border rounded-lg p-2 bg-white border-slate-200"
                    value={form.tr_order_lot_code ?? ''}
                    onChange={(e) => setForm({ ...form, tr_order_lot_code: e.target.value })}
                    placeholder="e.g. LOT-2026-09"
                  />
                </label>
                <label className="text-sm">
                  <div className="text-xs font-medium text-slate-600 mb-1">
                    Expiry date {selectedTransferOrderItem?.trackExpiry ? '(required for this item)' : '(optional)'}
                  </div>
                  <input
                    type="date"
                    className="w-full border rounded-lg p-2 bg-white border-slate-200"
                    value={form.tr_order_expiry_date ?? ''}
                    onChange={(e) => setForm({ ...form, tr_order_expiry_date: e.target.value })}
                  />
                </label>
              </>
            )}
          </div>
          <div className="text-xs text-slate-500">Partial dispatch and receive are supported.</div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setTransferActionModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!form.tr_order_id || !form.tr_order_item_id || !form.tr_order_qty || !form.tr_order_uom_id) {
                  toast.error('Please fill all required fields');
                  return;
                }
                if (transferActionType === 'dispatch') {
                  dispatchTransferOrderM.mutate({
                    orderId: Number(form.tr_order_id),
                    lines: [
                      {
                        inventory_item_id: Number(form.tr_order_item_id),
                        qty: Number(form.tr_order_qty),
                        qty_uom_id: Number(form.tr_order_uom_id),
                        location_id: null,
                      },
                    ],
                  });
                } else {
                  if (selectedTransferOrderItem?.trackExpiry && !form.tr_order_expiry_date) {
                    toast.error('Expiry date is required for this item');
                    return;
                  }
                  receiveTransferOrderM.mutate({
                    orderId: Number(form.tr_order_id),
                    lines: [
                      {
                        inventory_item_id: Number(form.tr_order_item_id),
                        received_qty: Number(form.tr_order_qty),
                        received_uom_id: Number(form.tr_order_uom_id),
                        location_id: null,
                        lot_code: form.tr_order_lot_code ? String(form.tr_order_lot_code) : null,
                        expiry_date: form.tr_order_expiry_date ? String(form.tr_order_expiry_date) : null,
                      },
                    ],
                  });
                }
                setTransferActionModalOpen(false);
              }}
            >
              {transferActionType === 'dispatch' ? 'Dispatch' : 'Receive'}
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={selectedTransferRequest != null}
        onClose={() => setSelectedTransferRequest(null)}
        title="Transfer request details"
        size="large"
      >
        {selectedTransferRequest ? (
          <div className="space-y-3 text-sm text-slate-700">
            <div>Source: {branchById.get(Number(selectedTransferRequest.sourceBranchId))?.name ?? '—'}</div>
            <div>Destination: {branchById.get(Number(selectedTransferRequest.destinationBranchId))?.name ?? '—'}</div>
            <div>Status: {selectedTransferRequest.status}</div>
            <div>Created: {formatDateTime(selectedTransferRequest.createdAt)}</div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600">
                  <tr>
                    <th className="py-2 pr-4">Item</th>
                    <th className="py-2 pr-4">Requested</th>
                    <th className="py-2 pr-4">Approved</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedTransferRequest.lines ?? []).map((line: any) => (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="py-2 pr-4">{itemById.get(Number(line.inventoryItemId))?.name ?? '—'}</td>
                      <td className="py-2 pr-4">{line.requestedQty} {uomById.get(Number(line.requestedUomId))?.code ?? ''}</td>
                      <td className="py-2 pr-4">{line.approvedQty ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={selectedTransferOrder != null}
        onClose={() => setSelectedTransferOrder(null)}
        title="Transfer order details"
        size="large"
      >
        {selectedTransferOrder ? (
          <div className="space-y-3 text-sm text-slate-700">
            <div>Source: {branchById.get(Number(selectedTransferOrder.sourceBranchId))?.name ?? '—'}</div>
            <div>Destination: {branchById.get(Number(selectedTransferOrder.destinationBranchId))?.name ?? '—'}</div>
            <div>Status: {selectedTransferOrder.status}</div>
            <div>Created: {formatDateTime(selectedTransferOrder.createdAt)}</div>
            {selectedTransferOrder.requestId ? (
              <div>
                Request status: {transferRequestById.get(Number(selectedTransferOrder.requestId))?.status ?? '—'}
              </div>
            ) : null}
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={selectedOnHandItemId != null}
        onClose={() => setSelectedOnHandItemId(null)}
        title={`Product history${selectedOnHandItem?.name ? ` - ${selectedOnHandItem.name}` : ''}`}
        size="large"
      >
        {!selectedOnHandItem ? null : productHistoryQ.isLoading ? (
          <Loader />
        ) : (
          <div className="space-y-4">
            <div className="text-xs text-slate-500">
              Totals are grouped in base unit and include purchases, adjustments, transfers, wastage, and consumption.
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-2 text-sm">
              <div className="rounded-lg border border-slate-200 p-2">
                <div className="text-xs text-slate-500">Received (purchase)</div>
                <div className="font-semibold">
                  {formatNumeric(productHistorySummary.received, 0, 6)} {uomById.get(Number(selectedOnHandItem.baseUomId))?.code ?? ''}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2">
                <div className="text-xs text-slate-500">Utilized (consume)</div>
                <div className="font-semibold">
                  {formatNumeric(productHistorySummary.utilized, 0, 6)} {uomById.get(Number(selectedOnHandItem.baseUomId))?.code ?? ''}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2">
                <div className="text-xs text-slate-500">Wastage</div>
                <div className="font-semibold">
                  {formatNumeric(productHistorySummary.wastage, 0, 6)} {uomById.get(Number(selectedOnHandItem.baseUomId))?.code ?? ''}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2">
                <div className="text-xs text-slate-500">Adjustment IN</div>
                <div className="font-semibold text-emerald-700">
                  {formatNumeric(productHistorySummary.adjustmentIn, 0, 6)} {uomById.get(Number(selectedOnHandItem.baseUomId))?.code ?? ''}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2">
                <div className="text-xs text-slate-500">Adjustment OUT</div>
                <div className="font-semibold text-rose-700">
                  {formatNumeric(productHistorySummary.adjustmentOut, 0, 6)} {uomById.get(Number(selectedOnHandItem.baseUomId))?.code ?? ''}
                </div>
              </div>
              <div className="rounded-lg border border-slate-200 p-2">
                <div className="text-xs text-slate-500">Transfers (In / Out)</div>
                <div className="font-semibold">
                  {formatNumeric(productHistorySummary.transferIn, 0, 6)} / {formatNumeric(productHistorySummary.transferOut, 0, 6)} {uomById.get(Number(selectedOnHandItem.baseUomId))?.code ?? ''}
                </div>
              </div>
            </div>

            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600">
                  <tr>
                    <th className="py-2 pr-4 w-12">#</th>
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Movement</th>
                    <th className="py-2 pr-4">Qty change</th>
                    <th className="py-2 pr-4">Reference</th>
                  </tr>
                </thead>
                <tbody>
                  {(productHistoryQ.data?.items ?? []).map((entry: any, index: number) => {
                    const meta = getHistoryReferenceMeta(entry);
                    return (
                      <tr key={entry.id} className="border-t border-slate-100">
                        <td className="py-2 pr-4">{index + 1}</td>
                        <td className="py-2 pr-4">{formatDateTime(entry.createdAt)}</td>
                        <td className="py-2 pr-4">{prettyLedgerEventType(entry.eventType)}</td>
                        <td className="py-2 pr-4">
                          <span className={Number(entry.qtyDelta) >= 0 ? 'text-emerald-700' : 'text-rose-700'}>
                            {Number(entry.qtyDelta) > 0 ? '+' : ''}
                            {formatNumeric(Number(entry.qtyDelta), 0, 6)}
                          </span>
                          {' '}
                          {uomById.get(Number(selectedOnHandItem.baseUomId))?.code ?? ''}
                        </td>
                        <td className="py-2 pr-4">
                          {meta.path ? (
                            <button
                              type="button"
                              className="text-red-700 hover:underline"
                              onClick={() => {
                                setSelectedOnHandItemId(null);
                                navigate(`${meta.path}?ref_type=${encodeURIComponent(String(entry.eventRefType ?? ''))}&ref_id=${Number(entry.eventRefId ?? 0)}`);
                              }}
                            >
                              {meta.label}
                            </button>
                          ) : (
                            meta.label
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </Modal>

      <Modal
        isOpen={adjustmentModalOpen}
        onClose={() => {
          setAdjustmentModalOpen(false);
          setEditingAdjustmentGroup(null);
        }}
        title={editingAdjustmentGroup ? 'Edit draft adjustment' : 'Create adjustment'}
        size="large"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Line type</div>
              <SearchableSelect
                value={String(form.adj_type ?? 'out')}
                onChange={(v) => setForm({ ...form, adj_type: v })}
                options={adjustmentHeaderTypeOptions}
                placeholder="Type"
                searchPlaceholder="Search…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Item</div>
              <SearchableSelect
                value={String(form.adj_item_id ?? '')}
                onChange={(v) => {
                  const itemId = Number(v);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    adj_item_id: v,
                    adj_uom_id: getDefaultItemUomId(selected),
                  });
                }}
                options={itemNameSelectOptions}
                placeholder="Select item…"
                searchPlaceholder="Search items…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Quantity</div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.adj_qty ?? ''}
                onChange={(e) => setForm({ ...form, adj_qty: e.target.value })}
                placeholder="e.g. 2"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Unit</div>
              <SearchableSelect
                value={String(form.adj_uom_id ?? '')}
                onChange={(v) => setForm({ ...form, adj_uom_id: v })}
                options={getItemAllowedUoms(selectedAdjustmentItem, form.adj_uom_id).map((u: any) => ({
                  value: String(u.id),
                  label: u.code,
                }))}
                placeholder="Select unit…"
                searchPlaceholder="Search units…"
                minWidth="w-full"
                className="w-full"
                disabled={!selectedAdjustmentItem}
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">
                Lot / batch code {(form.adj_type ?? 'out') === 'in' ? '(optional)' : '(only for IN)'}
              </div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.adj_lot_code ?? ''}
                onChange={(e) => setForm({ ...form, adj_lot_code: e.target.value })}
                placeholder="e.g. ADJ-LOT-01"
                disabled={(form.adj_type ?? 'out') !== 'in'}
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">
                Expiry date
                {(form.adj_type ?? 'out') === 'in' ? ' (required for IN)' : ' (only for IN)'}
              </div>
              <input
                type="date"
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.adj_expiry_date ?? ''}
                onChange={(e) => setForm({ ...form, adj_expiry_date: e.target.value })}
                disabled={(form.adj_type ?? 'out') !== 'in'}
              />
            </label>
            <div className="text-sm lg:col-span-2">
              <Button variant="secondary" onClick={addAdjustmentLine}>
                Add line
              </Button>
            </div>
          </div>

          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-600">
                <tr>
                  <th className="py-2 pr-4 w-12">#</th>
                  <th className="py-2 pr-4">Type</th>
                  <th className="py-2 pr-4">Item</th>
                  <th className="py-2 pr-4">Qty</th>
                  <th className="py-2 pr-4">Unit</th>
                    <th className="py-2 pr-4">Lot/batch</th>
                  <th className="py-2 pr-4">Expiry</th>
                  <th className="py-2 pr-4">Action</th>
                </tr>
              </thead>
              <tbody>
                {(Array.isArray(form.adj_lines) ? form.adj_lines : []).map((line: any, index: number) => (
                  <tr key={`adj-line-${index}`} className="border-t border-slate-100">
                    <td className="py-2 pr-4">{index + 1}</td>
                      <td className="py-2 pr-4">
                        <SearchableSelect
                          value={String(line.line_type ?? 'out')}
                          onChange={(v) =>
                            updateAdjustmentLine(index, {
                              line_type: v,
                              lot_code: v === 'in' ? line.lot_code ?? null : null,
                              expiry_date: v === 'in' ? line.expiry_date ?? null : null,
                            })
                          }
                          options={adjustmentRowLineTypeOptions}
                          placeholder="Type"
                          searchPlaceholder="Search…"
                          minWidth="min-w-[5.5rem]"
                          className="min-w-[5.5rem]"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <SearchableSelect
                          value={line.inventory_item_id ? String(line.inventory_item_id) : ''}
                          onChange={(v) => {
                            const itemId = Number(v);
                            const item = itemById.get(itemId);
                            updateAdjustmentLine(index, {
                              inventory_item_id: itemId,
                              qty_uom_id: Number(getDefaultItemUomId(item) || line.qty_uom_id || 0),
                            });
                          }}
                          options={itemNameSelectOptions}
                          placeholder="Select item…"
                          searchPlaceholder="Search items…"
                          minWidth="min-w-[10rem]"
                          className="min-w-[150px]"
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          className="border rounded px-2 py-1 bg-white border-slate-200 w-24"
                          type="number"
                          inputMode="decimal"
                          step="any"
                          min="0"
                          value={line.qty ?? ''}
                          onChange={(e) => updateAdjustmentLine(index, { qty: e.target.value })}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <SearchableSelect
                          value={line.qty_uom_id ? String(line.qty_uom_id) : ''}
                          onChange={(v) =>
                            updateAdjustmentLine(index, { qty_uom_id: v ? Number(v) : '' })
                          }
                          options={getItemAllowedUoms(itemById.get(Number(line.inventory_item_id)), line.qty_uom_id).map(
                            (u: any) => ({ value: String(u.id), label: u.code }),
                          )}
                          placeholder="Select…"
                          searchPlaceholder="Search units…"
                          minWidth="min-w-[5rem]"
                          className="min-w-[5rem]"
                          disabled={!line.inventory_item_id}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          className="border rounded px-2 py-1 bg-white border-slate-200 w-28"
                          value={line.lot_code ?? line.lotCode ?? ''}
                          onChange={(e) => updateAdjustmentLine(index, { lot_code: e.target.value })}
                          disabled={String(line.line_type ?? '') !== 'in'}
                        />
                      </td>
                      <td className="py-2 pr-4">
                        <input
                          type="date"
                          className="border rounded px-2 py-1 bg-white border-slate-200"
                          value={line.expiry_date ?? ''}
                          onChange={(e) => updateAdjustmentLine(index, { expiry_date: e.target.value })}
                          disabled={String(line.line_type ?? '') !== 'in'}
                        />
                      </td>
                    <td className="py-2 pr-4">
                      <button
                        type="button"
                        className="text-rose-700 hover:underline"
                        onClick={() =>
                          setForm((prev: any) => ({
                            ...prev,
                            adj_lines: (Array.isArray(prev.adj_lines) ? prev.adj_lines : []).filter(
                              (_: any, i: number) => i !== index,
                            ),
                          }))
                        }
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
                {(!Array.isArray(form.adj_lines) || form.adj_lines.length === 0) ? (
                  <tr className="border-t border-slate-100">
                    <td className="py-3 pr-4 text-slate-500" colSpan={8}>
                      No lines added yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>

          <div className="border-t border-slate-200 pt-3">
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="text-sm">
                <div className="text-xs font-medium text-slate-600 mb-1">Reason code</div>
                <input
                  className="w-full border rounded-lg p-2 bg-white border-slate-200"
                  value={form.adj_reason ?? ''}
                  onChange={(e) => setForm({ ...form, adj_reason: e.target.value })}
                  placeholder="manual_correction"
                />
              </label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="secondary"
              onClick={() => {
                setAdjustmentModalOpen(false);
                setEditingAdjustmentGroup(null);
              }}
            >
              Cancel
            </Button>
            <Button
              variant="secondary"
              isLoading={createAdjustmentM.isPending}
              onClick={async () => {
                if (editingAdjustmentGroup) {
                  await saveEditedAdjustmentGroup(false);
                  return;
                }
                const payloads = buildAdjustmentPayloads();
                if (!payloads) return;
                createAdjustmentM.mutate(payloads);
                setAdjustmentModalOpen(false);
              }}
            >
              Save as draft
            </Button>
            <Button
              isLoading={createAndPostAdjustmentM.isPending}
              onClick={async () => {
                if (editingAdjustmentGroup) {
                  await saveEditedAdjustmentGroup(true);
                  return;
                }
                const payloads = buildAdjustmentPayloads();
                if (!payloads) return;
                createAndPostAdjustmentM.mutate(payloads);
                setAdjustmentModalOpen(false);
              }}
            >
              Create and post
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={selectedAdjustment != null}
        onClose={() => setSelectedAdjustment(null)}
        title="Adjustment details"
        size="large"
      >
        {selectedAdjustment ? (
          <div className="space-y-3 text-sm text-slate-700">
            <div>Reference: {selectedAdjustment.reference ?? `ADJ-${selectedAdjustment.id}`}</div>
            <div>Type: {selectedAdjustment.typeLabel ?? selectedAdjustment.adjustmentType}</div>
            <div>Reason: {selectedAdjustment.reason ?? selectedAdjustment.reasonCode}</div>
            <div>Status: {selectedAdjustment.status}</div>
            <div>Created: {formatDateTime(selectedAdjustment.createdAt)}</div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600">
                  <tr>
                    <th className="py-2 pr-4">#</th>
                    <th className="py-2 pr-4">Type</th>
                    <th className="py-2 pr-4">Item</th>
                    <th className="py-2 pr-4">Qty</th>
                    <th className="py-2 pr-4">Unit</th>
                    <th className="py-2 pr-4">Lot/batch</th>
                    <th className="py-2 pr-4">Parent adj</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedAdjustment.lines ?? []).map((line: any, index: number) => (
                    <tr key={`${line.id}-${index}`} className="border-t border-slate-100">
                      <td className="py-2 pr-4">{index + 1}</td>
                      <td className="py-2 pr-4">{String(line.adjustmentType ?? selectedAdjustment.adjustmentType ?? '').toUpperCase()}</td>
                      <td className="py-2 pr-4">{itemById.get(Number(line.inventoryItemId))?.name ?? '—'}</td>
                      <td className="py-2 pr-4">{line.qty}</td>
                      <td className="py-2 pr-4">{uomById.get(Number(line.qtyUomId))?.code ?? '—'}</td>
                      <td className="py-2 pr-4">{line.lotCode ?? line.lot_code ?? '—'}</td>
                      <td className="py-2 pr-4">ADJ-{line.parentAdjustmentId ?? selectedAdjustment.id}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null}
      </Modal>

      <Modal
        isOpen={wastageModalOpen}
        onClose={() => setWastageModalOpen(false)}
        title="Record wastage"
        size="large"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Item</div>
              <SearchableSelect
                value={String(form.w_item_id ?? '')}
                onChange={(v) => {
                  const itemId = Number(v);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    w_item_id: v,
                    w_uom_id: getDefaultItemUomId(selected),
                  });
                }}
                options={itemNameSelectOptions}
                placeholder="Select item…"
                searchPlaceholder="Search items…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Quantity</div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.w_qty ?? ''}
                onChange={(e) => setForm({ ...form, w_qty: e.target.value })}
                placeholder="e.g. 1"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Unit</div>
              <SearchableSelect
                value={String(form.w_uom_id ?? '')}
                onChange={(v) => setForm({ ...form, w_uom_id: v })}
                options={getItemAllowedUoms(selectedWastageItem, form.w_uom_id).map((u: any) => ({
                  value: String(u.id),
                  label: u.code,
                }))}
                placeholder="Select unit…"
                searchPlaceholder="Search units…"
                minWidth="w-full"
                className="w-full"
                disabled={!selectedWastageItem}
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Reason</div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.w_reason ?? ''}
                onChange={(e) => setForm({ ...form, w_reason: e.target.value })}
                placeholder="wastage"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setWastageModalOpen(false)}>Cancel</Button>
            <Button
              isLoading={createWastageM.isPending}
              onClick={() => {
                if (!branchId || !form.w_item_id || !form.w_qty || !form.w_uom_id) {
                  toast.error('Please fill all required fields');
                  return;
                }
                createWastageM.mutate({
                  inventory_item_id: Number(form.w_item_id),
                  qty: Number(form.w_qty),
                  qty_uom_id: Number(form.w_uom_id),
                  reason: String(form.w_reason || 'wastage'),
                  notes: form.w_notes,
                });
              }}
            >
              Save
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={stocktakeCreateModalOpen}
        onClose={() => setStocktakeCreateModalOpen(false)}
        title="Create or load stocktake"
        size="large"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Week start</div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                placeholder="YYYY-MM-DD"
                value={form.st_week_start ?? ''}
                onChange={(e) => setForm({ ...form, st_week_start: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Week end</div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                placeholder="YYYY-MM-DD"
                value={form.st_week_end ?? ''}
                onChange={(e) => setForm({ ...form, st_week_end: e.target.value })}
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Finance day</div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                placeholder="YYYY-MM-DD"
                value={form.st_finance_day ?? ''}
                onChange={(e) => setForm({ ...form, st_finance_day: e.target.value })}
              />
            </label>
          </div>
          <div className="text-xs text-slate-500">
            If a stocktake already exists for this week, the same document is returned and loaded.
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setStocktakeCreateModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!form.st_week_start || !form.st_week_end || !form.st_finance_day) {
                  toast.error('Please fill all required fields');
                  return;
                }
                createStocktakeM.mutate({
                  week_start: form.st_week_start,
                  week_end: form.st_week_end,
                  finance_day: form.st_finance_day,
                });
                setStocktakeCreateModalOpen(false);
              }}
            >
              Create / Load
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={stocktakeLineModalOpen}
        onClose={() => setStocktakeLineModalOpen(false)}
        title="Add counted line"
        size="large"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Stocktake ID</div>
              <input
                className="w-full border rounded-lg p-2 bg-slate-50 border-slate-200"
                value={form.stocktake_id ?? ''}
                readOnly
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Item</div>
              <SearchableSelect
                value={String(form.st_item_id ?? '')}
                onChange={(v) => {
                  const itemId = Number(v);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    st_item_id: v,
                    st_uom_id: getDefaultItemUomId(selected),
                  });
                }}
                options={itemNameSelectOptions}
                placeholder="Select item…"
                searchPlaceholder="Search items…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Counted quantity</div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.st_qty ?? ''}
                onChange={(e) => setForm({ ...form, st_qty: e.target.value })}
                placeholder="e.g. 7"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Counted unit</div>
              <SearchableSelect
                value={String(form.st_uom_id ?? '')}
                onChange={(v) => setForm({ ...form, st_uom_id: v })}
                options={getItemAllowedUoms(selectedStocktakeItem, form.st_uom_id).map((u: any) => ({
                  value: String(u.id),
                  label: u.code,
                }))}
                placeholder="Select unit…"
                searchPlaceholder="Search units…"
                minWidth="w-full"
                className="w-full"
                disabled={!selectedStocktakeItem}
              />
            </label>
            <label className="text-sm lg:col-span-2">
              <div className="text-xs font-medium text-slate-600 mb-1">Location (optional)</div>
              <SearchableSelect
                value={String(form.st_location_id ?? '')}
                onChange={(v) => setForm({ ...form, st_location_id: v })}
                options={stocktakeLocationOptions}
                placeholder="Unassigned"
                searchPlaceholder="Search locations…"
                minWidth="w-full"
                className="w-full"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="secondary" onClick={() => setStocktakeLineModalOpen(false)}>Cancel</Button>
            <Button
              onClick={() => {
                if (!form.stocktake_id || !form.st_item_id || !form.st_qty || !form.st_uom_id) {
                  toast.error('Please fill all required fields');
                  return;
                }
                upsertStocktakeLineM.mutate({
                  stocktakeId: Number(form.stocktake_id),
                  line: {
                    inventory_item_id: Number(form.st_item_id),
                    counted_qty: Number(form.st_qty),
                    counted_uom_id: Number(form.st_uom_id),
                    location_id: form.st_location_id ? Number(form.st_location_id) : null,
                    notes: null,
                  },
                });
                setStocktakeLineModalOpen(false);
              }}
            >
              Save line
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

export default Inventory;

