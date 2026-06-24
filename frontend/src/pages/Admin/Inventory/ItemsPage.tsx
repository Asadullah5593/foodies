import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { LuPlus, LuSearch, LuPencil, LuTrash2, LuCalendarClock, LuTag } from 'react-icons/lu';
import Modal from '../../../components/Modal';
import Loader from '../../../components/Loader';
import SearchableSelect from '../../../components/SearchableSelect';
import { inventoryService } from '../../../services/api/inventoryService';

const card = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl';
const field = 'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400';
const TRACK_FILTERS: [string, string][] = [['', 'All'], ['expiry', 'Expiry-tracked'], ['lot', 'Lot-tracked'], ['none', 'Untracked']];

const ItemsPage: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [trackFilter, setTrackFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [f, setF] = useState<any>({ name: '', code: '', base_uom_id: '', track_expiry: false, track_lot: false, reorder: '', near_expiry_days: '', buy_price: '' });

  const itemsQ = useQuery({ queryKey: ['inventory-items'], queryFn: inventoryService.listItems });
  const uomsQ = useQuery({ queryKey: ['inventory-uoms'], queryFn: inventoryService.listUoms });
  const items = (itemsQ.data ?? []) as any[];
  const uomById = useMemo(() => { const m = new Map<number, string>(); for (const u of uomsQ.data ?? []) m.set(Number(u.id), u.code ?? u.name); return m; }, [uomsQ.data]);
  const uomOptions = useMemo(() => (uomsQ.data ?? []).map((u: any) => ({ value: String(u.id), label: `${u.name} (${u.code})` })), [uomsQ.data]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['inventory-items'] });

  const createM = useMutation({ mutationFn: (d: any) => inventoryService.createItem(d), onSuccess: () => { invalidate(); setOpen(false); toast.success('Item created'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create') });
  const updateM = useMutation({ mutationFn: ({ id, d }: any) => inventoryService.updateItem(id, d), onSuccess: () => { invalidate(); setOpen(false); toast.success('Item updated'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update') });
  const deleteM = useMutation({ mutationFn: (id: number) => inventoryService.deleteItem(id), onSuccess: () => { invalidate(); toast.success('Item deleted'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete') });

  const kpi = useMemo(() => ({ total: items.length, expiry: items.filter((i) => i.trackExpiry).length, lot: items.filter((i) => i.trackLot).length, reorder: items.filter((i) => i.defaultReorderPoint != null).length }), [items]);
  const rows = useMemo(() => {
    let r = items;
    if (trackFilter === 'expiry') r = r.filter((i) => i.trackExpiry);
    else if (trackFilter === 'lot') r = r.filter((i) => i.trackLot);
    else if (trackFilter === 'none') r = r.filter((i) => !i.trackExpiry && !i.trackLot);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((i) => String(i.name ?? '').toLowerCase().includes(q) || String(i.code ?? '').toLowerCase().includes(q));
    return r;
  }, [items, trackFilter, search]);

  const openCreate = () => { setEditId(null); setF({ name: '', code: '', base_uom_id: '', track_expiry: false, track_lot: false, reorder: '', near_expiry_days: '', buy_price: '' }); setOpen(true); };
  const openEdit = (i: any) => { setEditId(Number(i.id)); setF({ name: i.name ?? '', code: i.code ?? '', base_uom_id: i.baseUomId != null ? String(i.baseUomId) : '', track_expiry: !!i.trackExpiry, track_lot: !!i.trackLot, reorder: i.defaultReorderPoint != null ? String(i.defaultReorderPoint) : '', near_expiry_days: i.defaultNearExpiryDays != null ? String(i.defaultNearExpiryDays) : '', buy_price: i.defaultBuyPrice != null ? String(i.defaultBuyPrice) : '' }); setOpen(true); };
  const submit = () => {
    if (!f.name.trim() || !f.code.trim() || !f.base_uom_id) { toast.error('Name, code and base unit are required'); return; }
    const d: any = { name: f.name.trim(), code: f.code.trim(), type: 'ingredient', base_uom_id: Number(f.base_uom_id), track_expiry: !!f.track_expiry, track_lot: !!f.track_lot, default_reorder_point: f.reorder !== '' ? Number(f.reorder) : null, default_near_expiry_days: f.near_expiry_days !== '' ? Number(f.near_expiry_days) : null, default_buy_price: f.buy_price !== '' ? Number(f.buy_price) : 0 };
    if (editId) updateM.mutate({ id: editId, d }); else createM.mutate(d);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12.5px] text-slate-400 font-medium mb-1.5"><span>Inventory</span><span className="text-slate-300">/</span><span className="text-slate-600 dark:text-slate-300 font-semibold">Inventory items</span></div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Inventory Items</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-xl leading-relaxed">The raw ingredients, packaging and goods you stock. Each item has a base unit; recipes and receipts measure against it.</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 text-sm font-semibold shadow-sm"><LuPlus className="w-4 h-4" /> Add item</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Total items</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.total}</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Expiry-tracked</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.expiry}</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Lot-tracked</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.lot}</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">With reorder point</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.reorder}</div></div>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
          <div className="flex gap-1.5 flex-wrap">
            {TRACK_FILTERS.map(([k, lbl]) => (
              <button key={k} onClick={() => setTrackFilter(k)} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${trackFilter === k ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>{lbl}</button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[220px] max-w-[340px]"><LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code…" className={`${field} pl-9`} /></div>
        </div>
        {itemsQ.isLoading ? <div className="p-10"><Loader /></div> : (
          <div className="overflow-x-auto"><table className="min-w-full text-sm">
            <thead className="bg-slate-50/70 dark:bg-slate-900/40 text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-400"><tr><th className="py-3 px-4">Item</th><th className="py-3 px-4">Base unit</th><th className="py-3 px-4 text-right">Reorder</th><th className="py-3 px-4">Tracking</th><th className="py-3 px-4 text-right">Buy price</th><th className="py-3 px-4 text-right">Actions</th></tr></thead>
            <tbody className="text-slate-700 dark:text-slate-200">
              {rows.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-slate-400">No items found.</td></tr> : rows.map((i) => (
                <tr key={i.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="py-3 px-4"><div className="font-semibold text-slate-900 dark:text-slate-100">{i.name}</div><div className="text-xs font-mono text-slate-400">{i.code}</div></td>
                  <td className="py-3 px-4">{uomById.get(Number(i.baseUomId)) ?? '—'}</td>
                  <td className="py-3 px-4 text-right">{i.defaultReorderPoint != null ? `${Number(i.defaultReorderPoint)} ${uomById.get(Number(i.baseUomId)) ?? ''}` : <span className="text-slate-400">—</span>}</td>
                  <td className="py-3 px-4"><div className="flex gap-1.5">{i.trackExpiry && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-amber-100 text-amber-700"><LuCalendarClock className="w-3 h-3" />Expiry</span>}{i.trackLot && <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-purple-100 text-purple-700"><LuTag className="w-3 h-3" />Lot</span>}{!i.trackExpiry && !i.trackLot && <span className="text-slate-400 text-xs">—</span>}</div></td>
                  <td className="py-3 px-4 text-right font-medium">{i.defaultBuyPrice != null ? Number(i.defaultBuyPrice).toFixed(2) : '—'}</td>
                  <td className="py-3 px-4"><div className="flex gap-2 justify-end"><button onClick={() => openEdit(i)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"><LuPencil className="w-3.5 h-3.5" /></button><button onClick={() => { if (confirm(`Delete item "${i.name}"?`)) deleteM.mutate(Number(i.id)); }} className="px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><LuTrash2 className="w-3.5 h-3.5" /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table></div>
        )}
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editId ? 'Edit item' : 'Add item'} size="large">
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div className="lg:col-span-2"><div className="text-xs font-medium text-slate-500 mb-1">Name</div><input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Beef patty" /></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Code</div><input className={field} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="PATTY" /></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Base unit</div><SearchableSelect value={f.base_uom_id} onChange={(v) => setF({ ...f, base_uom_id: v })} options={uomOptions} placeholder="Select unit…" searchPlaceholder="Search units…" minWidth="w-full" className="w-full" /></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Default buy price</div><input className={field} value={f.buy_price} onChange={(e) => setF({ ...f, buy_price: e.target.value })} placeholder="0.00" /></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Reorder point</div><input className={field} value={f.reorder} onChange={(e) => setF({ ...f, reorder: e.target.value })} placeholder="optional" /></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Near-expiry days</div><input className={field} value={f.near_expiry_days} onChange={(e) => setF({ ...f, near_expiry_days: e.target.value })} placeholder="optional" /></div>
          </div>
          <div className="flex gap-6 pt-1">
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={f.track_expiry} onChange={(e) => setF({ ...f, track_expiry: e.target.checked })} className="w-4 h-4 accent-red-600" />Track expiry dates</label>
            <label className="flex items-center gap-2 text-sm cursor-pointer"><input type="checkbox" checked={f.track_lot} onChange={(e) => setF({ ...f, track_lot: e.target.checked })} className="w-4 h-4 accent-red-600" />Track lot / batch codes</label>
          </div>
          <div className="flex justify-end gap-2 pt-1"><button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button><button onClick={submit} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold">{editId ? 'Save changes' : 'Create item'}</button></div>
        </div>
      </Modal>
    </div>
  );
};

export default ItemsPage;
