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
  | 'uoms'
  | 'vendors'
  | 'items'
  | 'wastage'
  | 'stocktake'
  | 'weekly';

const Inventory: React.FC<{ initialTab?: InventoryTabKey; showTabs?: boolean }> = ({
  initialTab = 'onhand',
  showTabs = true,
}) => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<InventoryTabKey>(initialTab);
  const [uomModalOpen, setUomModalOpen] = useState(false);
  const [vendorModalOpen, setVendorModalOpen] = useState(false);
  const [itemModalOpen, setItemModalOpen] = useState(false);

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
    queryFn: () => inventoryService.getLedger(branchId!, 300),
    enabled: tab === 'ledger' && branchId != null,
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

  const createUomM = useMutation({
    mutationFn: inventoryService.createUom,
    onSuccess: async () => {
      toast.success('Unit of measure created');
      await queryClient.invalidateQueries({ queryKey: ['inventory-uoms'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create unit of measure'),
  });

  const updateUomM = useMutation({
    mutationFn: (data: { id: number; name: string; code: string }) =>
      inventoryService.updateUom(data.id, { name: data.name, code: data.code }),
    onSuccess: async () => {
      toast.success('Unit of measure updated');
      await queryClient.invalidateQueries({ queryKey: ['inventory-uoms'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update unit of measure'),
  });

  const deleteUomM = useMutation({
    mutationFn: (id: number) => inventoryService.deleteUom(id),
    onSuccess: async () => {
      toast.success('Unit of measure deleted');
      await queryClient.invalidateQueries({ queryKey: ['inventory-uoms'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete unit of measure'),
  });

  const createVendorM = useMutation({
    mutationFn: inventoryService.createVendor,
    onSuccess: async () => {
      toast.success('Vendor created');
      await queryClient.invalidateQueries({ queryKey: ['inventory-vendors'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create vendor'),
  });

  const updateVendorM = useMutation({
    mutationFn: (data: { id: number; payload: any }) => inventoryService.updateVendor(data.id, data.payload),
    onSuccess: async () => {
      toast.success('Vendor updated');
      await queryClient.invalidateQueries({ queryKey: ['inventory-vendors'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update vendor'),
  });

  const deleteVendorM = useMutation({
    mutationFn: (id: number) => inventoryService.deleteVendor(id),
    onSuccess: async () => {
      toast.success('Vendor deleted');
      await queryClient.invalidateQueries({ queryKey: ['inventory-vendors'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete vendor'),
  });

  const createItemM = useMutation({
    mutationFn: inventoryService.createItem,
    onSuccess: async () => {
      toast.success('Item created');
      await queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create item'),
  });

  const updateItemM = useMutation({
    mutationFn: (data: { id: number; payload: any }) => inventoryService.updateItem(data.id, data.payload),
    onSuccess: async () => {
      toast.success('Item updated');
      await queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update item'),
  });

  const deleteItemM = useMutation({
    mutationFn: (id: number) => inventoryService.deleteItem(id),
    onSuccess: async () => {
      toast.success('Item deleted');
      await queryClient.invalidateQueries({ queryKey: ['inventory-items'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete item'),
  });

  const createWastageM = useMutation({
    mutationFn: (data: any) => inventoryService.createWastage(branchId!, data),
    onSuccess: async () => {
      toast.success('Wastage recorded');
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record wastage'),
  });

  const createStocktakeM = useMutation({
    mutationFn: (data: { week_start: string; week_end: string; finance_day: string }) =>
      inventoryService.createStocktake(branchId!, data),
    onSuccess: async (st) => {
      toast.success('Stocktake created');
      setForm((f: any) => ({ ...f, stocktake_id: st?.id ?? f.stocktake_id }));
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create stocktake'),
  });

  const upsertStocktakeLineM = useMutation({
    mutationFn: (data: { stocktakeId: number; line: any }) =>
      inventoryService.upsertStocktakeLine(branchId!, data.stocktakeId, data.line),
    onSuccess: () => toast.success('Count saved'),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to save line'),
  });

  const submitStocktakeM = useMutation({
    mutationFn: (stocktakeId: number) => inventoryService.submitStocktake(branchId!, stocktakeId),
    onSuccess: () => toast.success('Stocktake submitted'),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to submit stocktake'),
  });

  const closeStocktakeM = useMutation({
    mutationFn: (stocktakeId: number) => inventoryService.closeStocktake(branchId!, stocktakeId),
    onSuccess: async () => {
      toast.success('Stocktake closed (variance posted)');
      await queryClient.invalidateQueries({ queryKey: ['inventory-ledger', branchId] });
      await queryClient.invalidateQueries({ queryKey: ['inventory-onhand', branchId] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to close stocktake'),
  });

  const weeklyUsageM = useMutation({
    mutationFn: (data: { from: string; to: string }) => inventoryService.weeklyUsage(branchId!, data),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to generate report'),
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
    setForm((f: any) => ({
      ...f,
      item_edit_id: null,
      item_name: '',
      item_code: '',
      item_type: 'ingredient',
      item_base_uom_id: '',
      item_expiry_required: 'yes',
      item_near_expiry_days: '',
      item_reorder_point: '',
    }));
    setItemModalOpen(true);
  };

  const openEditItem = (it: any) => {
    setForm((f: any) => ({
      ...f,
      item_edit_id: it.id,
      item_name: it.name ?? '',
      item_code: it.code ?? '',
      item_type: it.type ?? 'ingredient',
      item_base_uom_id: it.baseUomId != null ? String(it.baseUomId) : '',
      item_expiry_required: it.trackExpiry ? 'yes' : 'no',
      item_near_expiry_days: it.defaultNearExpiryDays != null ? String(it.defaultNearExpiryDays) : '',
      item_reorder_point: it.defaultReorderPoint != null ? String(it.defaultReorderPoint) : '',
    }));
    setItemModalOpen(true);
  };

  const closeItemModal = () => {
    setItemModalOpen(false);
    setForm((f: any) => ({
      ...f,
      item_edit_id: null,
      item_name: '',
      item_code: '',
      item_type: 'ingredient',
      item_base_uom_id: '',
      item_expiry_required: 'yes',
      item_near_expiry_days: '',
      item_reorder_point: '',
    }));
  };

  const submitItem = () => {
    const name = String(form.item_name ?? '').trim();
    const code = String(form.item_code ?? '').trim();
    const baseUomId = form.item_base_uom_id ? Number(form.item_base_uom_id) : null;
    if (!name || !code || !baseUomId) {
      toast.error('Please fill the required fields');
      return;
    }

    const expiryRequired = (form.item_expiry_required ?? 'yes') === 'yes';
    const payload = {
      name,
      code,
      type: String(form.item_type ?? 'ingredient').trim() || 'ingredient',
      base_uom_id: baseUomId,
      track_expiry: expiryRequired,
      track_lot: true,
      default_near_expiry_days:
        expiryRequired && String(form.item_near_expiry_days ?? '').trim() !== ''
          ? Number(form.item_near_expiry_days)
          : null,
      default_reorder_point: String(form.item_reorder_point ?? '').trim() !== '' ? Number(form.item_reorder_point) : null,
    };

    if (form.item_edit_id) {
      updateItemM.mutate({ id: Number(form.item_edit_id), payload });
    } else {
      createItemM.mutate(payload);
    }
    closeItemModal();
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
                  {(ledgerQ.data ?? []).map((r: any) => (
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
                <Button onClick={() => queryClient.invalidateQueries({ queryKey: ['inventory-nearexpiry', branchId] })}>
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
                      <th className="py-2 pr-4 w-40">Code</th>
                      <th className="py-2 pr-4">Name</th>
                      <th className="py-2 pr-4 w-40">Type</th>
                      <th className="py-2 pr-4 w-40">Base unit</th>
                      <th className="py-2 pr-4 w-56">Expiry settings</th>
                      <th className="py-2 pr-4 w-44">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="text-slate-700 dark:text-slate-200">
                    {(itemsQ.data ?? []).map((it: any) => (
                      <tr key={it.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 pr-4">{it.code}</td>
                        <td className="py-2 pr-4 font-medium">{it.name}</td>
                        <td className="py-2 pr-4">{it.type}</td>
                        <td className="py-2 pr-4">
                          {uomById.get(Number(it.baseUomId))?.code ?? `#${it.baseUomId}`}
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
                        onChange={(e) => setForm({ ...form, item_name: e.target.value })}
                      />
                    </label>

                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">
                        Code / SKU <span className="text-red-600">*</span>
                      </div>
                      <input
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        placeholder="e.g. CHK-BRST"
                        value={form.item_code ?? ''}
                        onChange={(e) => setForm({ ...form, item_code: e.target.value })}
                      />
                    </label>

                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">Type</div>
                      <select
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        value={form.item_type ?? 'ingredient'}
                        onChange={(e) => setForm({ ...form, item_type: e.target.value })}
                      >
                        <option value="ingredient">Ingredient</option>
                        <option value="packaging">Packaging</option>
                        <option value="finished">Finished</option>
                      </select>
                    </label>

                    <label className="text-sm">
                      <div className="text-xs font-medium text-slate-600 mb-1">
                        Base unit <span className="text-red-600">*</span>
                      </div>
                      <select
                        className="w-full border rounded-lg p-2 bg-white border-slate-200"
                        value={form.item_base_uom_id ?? ''}
                        onChange={(e) => setForm({ ...form, item_base_uom_id: e.target.value })}
                      >
                        <option value="">Select unit…</option>
                        {(uomsQ.data ?? []).map((u: any) => (
                          <option key={u.id} value={u.id}>
                            {u.code} — {u.name}
                          </option>
                        ))}
                      </select>
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
            <div className="grid grid-cols-1 lg:grid-cols-5 gap-2">
              <select
                className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                value={form.w_item_id ?? ''}
                onChange={(e) => setForm({ ...form, w_item_id: e.target.value })}
              >
                <option value="">Select item…</option>
                {(itemsQ.data ?? []).map((it: any) => (
                  <option key={it.id} value={it.id}>{it.name}</option>
                ))}
              </select>
              <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700" placeholder="Qty"
                value={form.w_qty ?? ''} onChange={(e) => setForm({ ...form, w_qty: e.target.value })} />
              <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700" placeholder="Qty UOM id"
                value={form.w_uom_id ?? ''} onChange={(e) => setForm({ ...form, w_uom_id: e.target.value })} />
              <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700" placeholder="Reason"
                value={form.w_reason ?? ''} onChange={(e) => setForm({ ...form, w_reason: e.target.value })} />
              <Button
                onClick={() =>
                  createWastageM.mutate({
                    inventory_item_id: Number(form.w_item_id),
                    qty: Number(form.w_qty),
                    qty_uom_id: Number(form.w_uom_id),
                    reason: String(form.w_reason || 'wastage'),
                    notes: form.w_notes,
                  })
                }
              >
                Save
              </Button>
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
              <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
                <input
                  className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  placeholder="Week start (YYYY-MM-DD)"
                  value={form.st_week_start ?? ''}
                  onChange={(e) => setForm({ ...form, st_week_start: e.target.value })}
                />
                <input
                  className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  placeholder="Week end (YYYY-MM-DD)"
                  value={form.st_week_end ?? ''}
                  onChange={(e) => setForm({ ...form, st_week_end: e.target.value })}
                />
                <input
                  className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  placeholder="Finance day (YYYY-MM-DD)"
                  value={form.st_finance_day ?? ''}
                  onChange={(e) => setForm({ ...form, st_finance_day: e.target.value })}
                />
                <Button
                  onClick={() =>
                    createStocktakeM.mutate({
                      week_start: form.st_week_start,
                      week_end: form.st_week_end,
                      finance_day: form.st_finance_day,
                    })
                  }
                >
                  Create / Load
                </Button>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-6 gap-2 items-end">
                <input
                  className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  placeholder="Stocktake id"
                  value={form.stocktake_id ?? ''}
                  onChange={(e) => setForm({ ...form, stocktake_id: e.target.value })}
                />
                <select
                  className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  value={form.st_item_id ?? ''}
                  onChange={(e) => setForm({ ...form, st_item_id: e.target.value })}
                >
                  <option value="">Item…</option>
                  {(itemsQ.data ?? []).map((it: any) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
                <input
                  className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  placeholder="Counted qty"
                  value={form.st_qty ?? ''}
                  onChange={(e) => setForm({ ...form, st_qty: e.target.value })}
                />
                <input
                  className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  placeholder="Counted UOM id"
                  value={form.st_uom_id ?? ''}
                  onChange={(e) => setForm({ ...form, st_uom_id: e.target.value })}
                />
                <input
                  className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  placeholder="Location id (optional)"
                  value={form.st_location_id ?? ''}
                  onChange={(e) => setForm({ ...form, st_location_id: e.target.value })}
                />
                <Button
                  onClick={() =>
                    upsertStocktakeLineM.mutate({
                      stocktakeId: Number(form.stocktake_id),
                      line: {
                        inventory_item_id: Number(form.st_item_id),
                        counted_qty: Number(form.st_qty),
                        counted_uom_id: Number(form.st_uom_id),
                        location_id: form.st_location_id ? Number(form.st_location_id) : null,
                        notes: null,
                      },
                    })
                  }
                >
                  Save line
                </Button>
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
    </div>
  );
};

export default Inventory;

