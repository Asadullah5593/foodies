import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
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
  const [transferActionType, setTransferActionType] = useState<'dispatch' | 'receive'>('dispatch');

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
    queryKey: ['inventory-ledger', branchId],
    queryFn: () => inventoryService.getLedger(branchId!, { page_size: 300 }),
    enabled: tab === 'ledger' && branchId != null,
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
    mutationFn: (data: { id: number; name: string; code: string }) =>
      inventoryService.updateUom(data.id, { name: data.name, code: data.code }),
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
    onSuccess: async () => {
      toast.success('Wastage recorded');
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to record wastage')),
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
    mutationFn: inventoryService.createAdjustment,
    onSuccess: async () => {
      toast.success('Adjustment saved as draft');
      await queryClient.invalidateQueries({ queryKey: ['inventory-adjustments', branchId] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to create adjustment')),
  });

  const createAndPostAdjustmentM = useMutation({
    mutationFn: async (payload: {
      branch_id: number;
      adjustment_type: 'in' | 'out';
      reason_code: string;
      lines: Array<{
        inventory_item_id: number;
        qty: number;
        qty_uom_id: number;
        lot_code?: string | null;
        expiry_date?: string | null;
      }>;
    }) => {
      const created = await inventoryService.createAdjustment(payload);
      if (!created?.id) throw new Error('Adjustment created but missing id');
      await inventoryService.postAdjustment(Number(created.id));
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

  const postAdjustmentM = useMutation({
    mutationFn: (id: number) => inventoryService.postAdjustment(id),
    onSuccess: async () => {
      toast.success('Adjustment posted');
      await queryClient.invalidateQueries({ queryKey: ['inventory-adjustments', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
    },
    onError: (e: any) => toast.error(readApiError(e, 'Failed to post adjustment')),
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

  const locationById = useMemo(() => {
    const m = new Map<number, any>();
    for (const l of locationsQ.data ?? []) m.set(Number(l.id), l);
    return m;
  }, [locationsQ.data]);

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

  const formatDateTime = (value?: string | Date | null) => {
    if (!value) return '—';
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return '—';
    return d.toLocaleString();
  };

  const openCreateUom = () => {
    setForm((f: any) => ({ ...f, uom_edit_id: null, uom_name: '', uom_code: '' }));
    setUomModalOpen(true);
  };

  const openEditUom = (u: any) => {
    setForm((f: any) => ({ ...f, uom_edit_id: u.id, uom_name: u.name, uom_code: u.code }));
    setUomModalOpen(true);
  };

  const closeUomModal = () => {
    setUomModalOpen(false);
    setForm((f: any) => ({ ...f, uom_edit_id: null, uom_name: '', uom_code: '' }));
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
    if (!name || !code) {
      toast.error('Please fill the required fields');
      return;
    }
    if (form.uom_edit_id) {
      updateUomM.mutate({ id: Number(form.uom_edit_id), name, code });
    } else {
      createUomM.mutate({ name, code, kind: 'count' });
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
            <li><span className="font-medium">Stock movement ledger</span> is the “audit trail” of every increase/decrease (goods received, consumption, wastage, stock count variance).</li>
            <li><span className="font-medium">Alerts</span> highlights items that are low in stock or batches that are near expiry.</li>
            <li><span className="font-medium">Storage locations</span> are optional sub-areas inside a branch (e.g., “Dry store”, “Chiller”, “Freezer”). They help you see and count stock by physical place.</li>
          </ul>
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Tip: If you don’t use locations, stock can still be tracked at branch level (location will show as “Unassigned”).
          </div>
        </div>
      </Card>

      {showTabs && (
        <div className="flex flex-wrap gap-2">
          {[
            { k: 'onhand', label: 'On-hand inventory' },
            { k: 'ledger', label: 'Stock movement ledger' },
            { k: 'alerts', label: 'Alerts (low stock & expiry)' },
            { k: 'transfers', label: 'Branch transfers' },
            { k: 'adjustments', label: 'Adjustments' },
            { k: 'wastage', label: 'Record wastage' },
            { k: 'stocktake', label: 'Weekly stock count (Finance Day)' },
            { k: 'weekly', label: 'Weekly usage report' },
            { k: 'items', label: 'Inventory items' },
            { k: 'vendors', label: 'Vendors' },
            { k: 'uoms', label: 'Units of measure' },
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
                    <th className="py-2 pr-4">Item</th>
                    <th className="py-2 pr-4">Storage location</th>
                    <th className="py-2 pr-4">Quantity (base unit)</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 dark:text-slate-200">
                  {(onHandQ.data ?? []).map((r: any) => (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 pr-4">
                        <div className="font-medium">
                          {itemById.get(Number(r.inventoryItemId))?.name ?? `Item #${r.inventoryItemId}`}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-400">
                          {itemById.get(Number(r.inventoryItemId))?.code ?? ''}
                        </div>
                      </td>
                      <td className="py-2 pr-4">
                        {r.locationId
                          ? `${locationById.get(Number(r.locationId))?.name ?? `Location #${r.locationId}`}`
                          : 'Unassigned'}
                      </td>
                      <td className="py-2 pr-4">
                        {Number(r.qty)}
                        {itemById.get(Number(r.inventoryItemId))?.baseUomId
                          ? ` ${uomById.get(Number(itemById.get(Number(r.inventoryItemId))?.baseUomId))?.code ?? ''}`
                          : ''}
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
          {!branchId ? (
            <div className="text-slate-500 dark:text-slate-400">Select a branch to view ledger.</div>
          ) : ledgerQ.isLoading ? (
            <Loader />
          ) : (
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600 dark:text-slate-300">
                  <tr>
                    <th className="py-2 pr-4">Time</th>
                    <th className="py-2 pr-4">Movement type</th>
                    <th className="py-2 pr-4">Item</th>
                    <th className="py-2 pr-4">Batch</th>
                    <th className="py-2 pr-4">Quantity change</th>
                    <th className="py-2 pr-4">Reference</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 dark:text-slate-200">
                  {(ledgerQ.data?.items ?? []).map((r: any) => (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 pr-4">{new Date(r.createdAt).toLocaleString()}</td>
                      <td className="py-2 pr-4">{r.eventType}</td>
                      <td className="py-2 pr-4">
                        {itemById.get(Number(r.inventoryItemId))?.name ?? `Item #${r.inventoryItemId}`}
                      </td>
                      <td className="py-2 pr-4">{r.inventoryBatchId ?? '—'}</td>
                      <td className="py-2 pr-4">
                        {Number(r.qtyDelta)}
                        {itemById.get(Number(r.inventoryItemId))?.baseUomId
                          ? ` ${uomById.get(Number(itemById.get(Number(r.inventoryItemId))?.baseUomId))?.code ?? ''}`
                          : ''}
                      </td>
                      <td className="py-2 pr-4">{r.eventRefType ? `${r.eventRefType}:${r.eventRefId}` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
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
            <div className="space-y-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Create request, then approve, then dispatch from source branch, and finally receive at destination branch.
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

              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 pr-4">Source branch</th>
                      <th className="py-2 pr-4">Destination branch</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Created</th>
                      <th className="py-2 pr-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(transferRequestsQ.data ?? []).map((r: any) => (
                      <tr key={r.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4">{branchById.get(Number(r.sourceBranchId))?.name ?? '—'}</td>
                        <td className="py-2 pr-4">{branchById.get(Number(r.destinationBranchId))?.name ?? '—'}</td>
                        <td className="py-2 pr-4">{r.status}</td>
                        <td className="py-2 pr-4">{formatDateTime(r.createdAt)}</td>
                        <td className="py-2 pr-4 flex gap-2">
                          <Button variant="secondary" onClick={() => setSelectedTransferRequest(r)}>View</Button>
                          <Button disabled={r.status !== 'submitted'} onClick={() => approveTransferRequestM.mutate(r.id)}>Approve</Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 pr-4">Source branch</th>
                      <th className="py-2 pr-4">Destination branch</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Created</th>
                      <th className="py-2 pr-4">Action</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(transferOrdersQ.data ?? []).map((o: any) => (
                      <tr key={o.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4">{branchById.get(Number(o.sourceBranchId))?.name ?? '—'}</td>
                        <td className="py-2 pr-4">{branchById.get(Number(o.destinationBranchId))?.name ?? '—'}</td>
                        <td className="py-2 pr-4">{o.status}</td>
                        <td className="py-2 pr-4">{formatDateTime(o.createdAt)}</td>
                        <td className="py-2 pr-4">
                          <Button variant="secondary" onClick={() => setSelectedTransferOrder(o)}>View</Button>
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
                <Button onClick={() => setAdjustmentModalOpen(true)}>Create adjustment</Button>
              </div>

              <div className="overflow-auto">
                <table className="min-w-full text-sm">
                  <thead className="text-left text-slate-600 dark:text-slate-300">
                    <tr>
                      <th className="py-2 pr-4">Type</th>
                      <th className="py-2 pr-4">Item</th>
                      <th className="py-2 pr-4">Reason</th>
                      <th className="py-2 pr-4">Status</th>
                      <th className="py-2 pr-4">Created</th>
                      <th className="py-2 pr-4">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(adjustmentsQ.data ?? []).map((a: any) => (
                      <tr key={a.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4">{a.adjustmentType}</td>
                        <td className="py-2 pr-4">{itemById.get(Number(a.lines?.[0]?.inventoryItemId))?.name ?? '—'}</td>
                        <td className="py-2 pr-4">{a.reasonCode}</td>
                        <td className="py-2 pr-4">{a.status}</td>
                        <td className="py-2 pr-4">{formatDateTime(a.createdAt)}</td>
                        <td className="py-2 pr-4 flex gap-2">
                          <Button variant="secondary" onClick={() => setSelectedAdjustment(a)}>View</Button>
                          <Button disabled={a.status !== 'draft'} onClick={() => postAdjustmentM.mutate(a.id)}>Post</Button>
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
                      <th className="py-2 pr-4 w-40">Code</th>
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4 w-44">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(uomsQ.data ?? []).map((u: any) => (
                      <tr key={u.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4">{u.code}</td>
                        <td className="py-2 pr-4">{u.name}</td>
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
                    <div className="text-xs text-slate-500">
                      Required fields are marked with <span className="text-red-600">*</span>.
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
                      <select
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        value={form.vendor_type ?? 'supplier'}
                        onChange={(e) => setForm({ ...form, vendor_type: e.target.value })}
                      >
                        <option value="supplier">Supplier</option>
                        <option value="warehouse">Warehouse</option>
                        <option value="branch">Branch (inter-branch)</option>
                      </select>
                    </label>

                    <label className="text-sm lg:col-span-2">
                      <div className="text-xs font-medium text-slate-600 mb-1">Linked branch (optional)</div>
                      <select
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        value={form.vendor_linked_branch_id ?? ''}
                        onChange={(e) => setForm({ ...form, vendor_linked_branch_id: e.target.value })}
                      >
                        <option value="">None</option>
                        {(branches ?? []).map((b: any) => (
                          <option key={b.id} value={b.id}>
                            {b.name}{b.code ? ` (${b.code})` : ''}
                          </option>
                        ))}
                      </select>
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
                      <select
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        value={form.item_expiry_required ?? 'yes'}
                        onChange={(e) => setForm({ ...form, item_expiry_required: e.target.value })}
                      >
                        <option value="yes">Required (enter an expiry date)</option>
                        <option value="no">Not required</option>
                      </select>
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
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Record wastage</h2>
          {!branchId ? (
            <div className="text-slate-500 dark:text-slate-400">Select a branch.</div>
          ) : itemsQ.isLoading ? (
            <Loader />
          ) : (
            <div className="space-y-3">
              <div className="text-xs text-slate-500 dark:text-slate-400">
                Record damaged, spoiled, or discarded stock. This creates a stock-out movement in the ledger.
              </div>
              <Button onClick={() => setWastageModalOpen(true)}>Record wastage</Button>
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
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.tr_destination_branch_id ?? ''}
                onChange={(e) => setForm({ ...form, tr_destination_branch_id: e.target.value })}
              >
                <option value="">Select destination branch…</option>
                {(branches ?? [])
                  .filter((b: any) => Number(b.id) !== Number(branchId))
                  .map((b: any) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Item</div>
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.tr_item_id ?? ''}
                onChange={(e) => {
                  const itemId = Number(e.target.value);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    tr_item_id: e.target.value,
                    tr_uom_id: getDefaultItemUomId(selected),
                  });
                }}
              >
                <option value="">Select item…</option>
                {(itemsQ.data ?? []).map((it: any) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
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
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.tr_uom_id ?? ''}
                onChange={(e) => setForm({ ...form, tr_uom_id: e.target.value })}
                disabled={!selectedTransferRequestItem}
              >
                <option value="">Select unit…</option>
                {getItemAllowedUoms(selectedTransferRequestItem, form.tr_uom_id).map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </select>
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
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.tr_order_id ?? ''}
                onChange={(e) => setForm({ ...form, tr_order_id: e.target.value })}
              >
                <option value="">Select order…</option>
                {(transferOrdersQ.data ?? []).map((o: any) => (
                  <option key={o.id} value={o.id}>
                    {branchById.get(Number(o.sourceBranchId))?.name ?? '—'} to {branchById.get(Number(o.destinationBranchId))?.name ?? '—'} ({o.status})
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Item</div>
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.tr_order_item_id ?? ''}
                onChange={(e) => {
                  const itemId = Number(e.target.value);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    tr_order_item_id: e.target.value,
                    tr_order_uom_id: getDefaultItemUomId(selected),
                  });
                }}
              >
                <option value="">Select item…</option>
                {(itemsQ.data ?? []).map((it: any) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
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
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.tr_order_uom_id ?? ''}
                onChange={(e) => setForm({ ...form, tr_order_uom_id: e.target.value })}
                disabled={!selectedTransferOrderItem}
              >
                <option value="">Select unit…</option>
                {getItemAllowedUoms(selectedTransferOrderItem, form.tr_order_uom_id).map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </select>
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
        isOpen={adjustmentModalOpen}
        onClose={() => setAdjustmentModalOpen(false)}
        title="Create adjustment"
        size="large"
      >
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Type</div>
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.adj_type ?? 'out'}
                onChange={(e) => setForm({ ...form, adj_type: e.target.value })}
              >
                <option value="out">OUT (decrease)</option>
                <option value="in">IN (increase)</option>
              </select>
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Reason code</div>
              <input
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.adj_reason ?? ''}
                onChange={(e) => setForm({ ...form, adj_reason: e.target.value })}
                placeholder="manual_correction"
              />
            </label>
            <label className="text-sm">
              <div className="text-xs font-medium text-slate-600 mb-1">Item</div>
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.adj_item_id ?? ''}
                onChange={(e) => {
                  const itemId = Number(e.target.value);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    adj_item_id: e.target.value,
                    adj_uom_id: getDefaultItemUomId(selected),
                  });
                }}
              >
                <option value="">Select item…</option>
                {(itemsQ.data ?? []).map((it: any) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
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
            <label className="text-sm lg:col-span-2">
              <div className="text-xs font-medium text-slate-600 mb-1">Unit</div>
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.adj_uom_id ?? ''}
                onChange={(e) => setForm({ ...form, adj_uom_id: e.target.value })}
                disabled={!selectedAdjustmentItem}
              >
                <option value="">Select unit…</option>
                {getItemAllowedUoms(selectedAdjustmentItem, form.adj_uom_id).map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </select>
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
            <Button variant="secondary" onClick={() => setAdjustmentModalOpen(false)}>Cancel</Button>
            <Button
              variant="secondary"
              isLoading={createAdjustmentM.isPending}
              onClick={() => {
                if (!branchId || !form.adj_item_id || !form.adj_qty || !form.adj_uom_id) {
                  toast.error('Please fill all required fields');
                  return;
                }
                if ((form.adj_type ?? 'out') === 'in' && selectedAdjustmentItem?.trackExpiry && !form.adj_expiry_date) {
                  toast.error('Expiry date is required for this item');
                  return;
                }
                createAdjustmentM.mutate({
                  branch_id: branchId,
                  adjustment_type: form.adj_type ?? 'out',
                  reason_code: String(form.adj_reason || 'manual_correction'),
                  lines: [
                    {
                      inventory_item_id: Number(form.adj_item_id),
                      qty: Number(form.adj_qty),
                      qty_uom_id: Number(form.adj_uom_id),
                      lot_code: form.adj_lot_code ? String(form.adj_lot_code) : null,
                      expiry_date: form.adj_expiry_date ? String(form.adj_expiry_date) : null,
                    },
                  ],
                });
                setAdjustmentModalOpen(false);
              }}
            >
              Save as draft
            </Button>
            <Button
              isLoading={createAndPostAdjustmentM.isPending}
              onClick={() => {
                if (!branchId || !form.adj_item_id || !form.adj_qty || !form.adj_uom_id) {
                  toast.error('Please fill all required fields');
                  return;
                }
                if ((form.adj_type ?? 'out') === 'in' && selectedAdjustmentItem?.trackExpiry && !form.adj_expiry_date) {
                  toast.error('Expiry date is required for this item');
                  return;
                }
                createAndPostAdjustmentM.mutate({
                  branch_id: branchId,
                  adjustment_type: form.adj_type ?? 'out',
                  reason_code: String(form.adj_reason || 'manual_correction'),
                  lines: [
                    {
                      inventory_item_id: Number(form.adj_item_id),
                      qty: Number(form.adj_qty),
                      qty_uom_id: Number(form.adj_uom_id),
                      lot_code: form.adj_lot_code ? String(form.adj_lot_code) : null,
                      expiry_date: form.adj_expiry_date ? String(form.adj_expiry_date) : null,
                    },
                  ],
                });
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
            <div>Type: {selectedAdjustment.adjustmentType}</div>
            <div>Reason: {selectedAdjustment.reasonCode}</div>
            <div>Status: {selectedAdjustment.status}</div>
            <div>Created: {formatDateTime(selectedAdjustment.createdAt)}</div>
            <div className="overflow-auto">
              <table className="min-w-full text-sm">
                <thead className="text-left text-slate-600">
                  <tr>
                    <th className="py-2 pr-4">Item</th>
                    <th className="py-2 pr-4">Qty</th>
                    <th className="py-2 pr-4">Unit</th>
                  </tr>
                </thead>
                <tbody>
                  {(selectedAdjustment.lines ?? []).map((line: any) => (
                    <tr key={line.id} className="border-t border-slate-100">
                      <td className="py-2 pr-4">{itemById.get(Number(line.inventoryItemId))?.name ?? '—'}</td>
                      <td className="py-2 pr-4">{line.qty}</td>
                      <td className="py-2 pr-4">{uomById.get(Number(line.qtyUomId))?.code ?? '—'}</td>
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
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.w_item_id ?? ''}
                onChange={(e) => {
                  const itemId = Number(e.target.value);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    w_item_id: e.target.value,
                    w_uom_id: getDefaultItemUomId(selected),
                  });
                }}
              >
                <option value="">Select item…</option>
                {(itemsQ.data ?? []).map((it: any) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
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
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.w_uom_id ?? ''}
                onChange={(e) => setForm({ ...form, w_uom_id: e.target.value })}
                disabled={!selectedWastageItem}
              >
                <option value="">Select unit…</option>
                {getItemAllowedUoms(selectedWastageItem, form.w_uom_id).map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </select>
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
                setWastageModalOpen(false);
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
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.st_item_id ?? ''}
                onChange={(e) => {
                  const itemId = Number(e.target.value);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    st_item_id: e.target.value,
                    st_uom_id: getDefaultItemUomId(selected),
                  });
                }}
              >
                <option value="">Select item…</option>
                {(itemsQ.data ?? []).map((it: any) => (
                  <option key={it.id} value={it.id}>
                    {it.name}
                  </option>
                ))}
              </select>
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
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.st_uom_id ?? ''}
                onChange={(e) => setForm({ ...form, st_uom_id: e.target.value })}
                disabled={!selectedStocktakeItem}
              >
                <option value="">Select unit…</option>
                {getItemAllowedUoms(selectedStocktakeItem, form.st_uom_id).map((u: any) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm lg:col-span-2">
              <div className="text-xs font-medium text-slate-600 mb-1">Location (optional)</div>
              <select
                className="w-full border rounded-lg p-2 bg-white border-slate-200"
                value={form.st_location_id ?? ''}
                onChange={(e) => setForm({ ...form, st_location_id: e.target.value })}
              >
                <option value="">Unassigned</option>
                {(locationsQ.data ?? []).map((l: any) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
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

