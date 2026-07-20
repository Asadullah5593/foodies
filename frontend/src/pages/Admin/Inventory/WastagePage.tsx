import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { LuPlus, LuSearch, LuTrash2 } from 'react-icons/lu';
import Modal from '../../../components/Modal';
import Loader from '../../../components/Loader';
import SearchableSelect from '../../../components/SearchableSelect';
import apiClient from '../../../utils/apiClient';
import { inventoryService } from '../../../services/api/inventoryService';
import { useHasPermission } from '../../../hooks/useHasPermission';

const card = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl';
const field = 'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400';
const REASONS = [{ value: 'spoilage', label: 'Spoilage' }, { value: 'expired', label: 'Expired' }, { value: 'damaged', label: 'Damaged' }, { value: 'prep_waste', label: 'Prep waste' }, { value: 'theft', label: 'Theft / loss' }, { value: 'other', label: 'Other' }];
const toDateInput = (d: Date) => d.toISOString().slice(0, 10);
const fmtNum = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const prettyReason = (r: string) => { const m = REASONS.find((x) => x.value === r); if (m) return m.label; const s = String(r ?? '').replace(/_/g, ' '); return s ? s[0].toUpperCase() + s.slice(1) : '—'; };

const WastagePage: React.FC = () => {
  const qc = useQueryClient();
  const canRecord = useHasPermission('inventory:waste');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return toDateInput(d); });
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [reasonFilter, setReasonFilter] = useState('');
  const [search, setSearch] = useState('');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState<any>({ item: '', qty: '', uom: '', reason: 'spoilage', notes: '' });

  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: async () => (await apiClient.get('/admin/branches')).data ?? [] });
  const branches = branchesQ.data ?? [];
  const activeBranchId = branchId ?? (branches[0]?.id ?? null);
  const itemsQ = useQuery({ queryKey: ['inventory-items'], queryFn: inventoryService.listItems });
  const uomsQ = useQuery({ queryKey: ['inventory-uoms'], queryFn: inventoryService.listUoms });
  const wastageQ = useQuery({ queryKey: ['wastage', activeBranchId, from, to], queryFn: () => inventoryService.listWastage(activeBranchId as number, { from: from || undefined, to: to || undefined, page: 1, page_size: 200 }), enabled: activeBranchId != null });

  const itemById = useMemo(() => { const m = new Map<number, any>(); for (const it of itemsQ.data ?? []) m.set(Number(it.id), it); return m; }, [itemsQ.data]);
  const uomById = useMemo(() => { const m = new Map<number, any>(); for (const u of uomsQ.data ?? []) m.set(Number(u.id), u); return m; }, [uomsQ.data]);
  const itemOptions = useMemo(() => (itemsQ.data ?? []).map((it: any) => ({ value: String(it.id), label: it.name })), [itemsQ.data]);
  const selItem = itemById.get(Number(f.item));
  const allowedUoms = (item: any) => { if (!item) return uomsQ.data ?? []; const ids = (Array.isArray(item.baseUomIds) && item.baseUomIds.length ? item.baseUomIds : [item.baseUomId]).map((x: any) => Number(x)).filter((x: number) => x > 0); if (item.baseUomId && !ids.includes(Number(item.baseUomId))) ids.unshift(Number(item.baseUomId)); const o = ids.map((id: number) => uomById.get(id)).filter(Boolean); return o.length ? o : (uomsQ.data ?? []); };
  const unitCode = (iid: number) => uomById.get(Number(itemById.get(iid)?.baseUomId))?.code ?? '';

  const events: any[] = wastageQ.data?.items ?? [];
  const qtyBaseOf = (e: any) => { const v = e.qtyBase ?? e.qty_base; if (v != null) return Math.abs(Number(v)); return Math.abs(Number(e.qty ?? 0)); };

  const kpi = useMemo(() => {
    const byReason = new Map<string, number>();
    let totalQty = 0;
    for (const e of events) { totalQty += qtyBaseOf(e); byReason.set(String(e.reason ?? 'other'), (byReason.get(String(e.reason ?? 'other')) ?? 0) + qtyBaseOf(e)); }
    let topReason = '—', topQty = -1; for (const [r, q] of byReason) if (q > topQty) { topQty = q; topReason = r; }
    return { count: events.length, totalQty, items: new Set(events.map((e) => Number(e.inventoryItemId))).size, topReason: events.length ? prettyReason(topReason) : '—' };
  }, [events]); // eslint-disable-line react-hooks/exhaustive-deps

  const rows = useMemo(() => {
    let r = events;
    if (reasonFilter) r = r.filter((e) => String(e.reason) === reasonFilter);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((e) => String(itemById.get(Number(e.inventoryItemId))?.name ?? '').toLowerCase().includes(q) || prettyReason(e.reason).toLowerCase().includes(q) || String(e.notes ?? '').toLowerCase().includes(q));
    return r;
  }, [events, reasonFilter, search, itemById]);

  const recordM = useMutation({
    mutationFn: (d: any) => inventoryService.createWastage(activeBranchId as number, d),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['wastage'] }); qc.invalidateQueries({ queryKey: ['onhand'] }); setOpen(false); setF({ item: '', qty: '', uom: '', reason: 'spoilage', notes: '' }); toast.success('Wastage recorded'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to record wastage'),
  });
  const submit = () => {
    if (!f.item || !f.uom || !(Number(f.qty) > 0)) { toast.error('Item, unit and quantity > 0 are required'); return; }
    recordM.mutate({ inventory_item_id: Number(f.item), qty: Number(f.qty), qty_uom_id: Number(f.uom), reason: f.reason, notes: f.notes || undefined });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12.5px] text-slate-400 font-medium mb-1.5"><span>Inventory</span><span className="text-slate-300">/</span><span className="text-slate-600 dark:text-slate-300 font-semibold">Record wastage</span></div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Record Wastage</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-xl leading-relaxed">Write off spoiled, expired or damaged stock. Each entry posts immediately and reduces on-hand stock at this branch (FEFO).</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative"><span className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-red-500 pointer-events-none" /><select value={activeBranchId ?? ''} onChange={(e) => setBranchId(Number(e.target.value))} className="appearance-none pl-7 pr-9 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-slate-100 min-w-[200px]">{branches.map((b: any) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}</select></div>
          {canRecord && <button onClick={() => { setF({ item: '', qty: '', uom: '', reason: 'spoilage', notes: '' }); setOpen(true); }} className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 text-sm font-semibold shadow-sm"><LuPlus className="w-4 h-4" /> Record wastage</button>}
        </div>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Wastage events</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.count}</div><div className="text-xs text-slate-400 mt-0.5">{from ? new Date(from).toLocaleDateString() : '…'} – {to ? new Date(to).toLocaleDateString() : '…'}</div></div>
        <div className={`${card} p-4`}><div className="flex items-center gap-1.5 text-[13px] font-semibold text-red-600"><LuTrash2 className="w-3.5 h-3.5" />Total wasted</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{fmtNum(kpi.totalQty)}</div><div className="text-xs text-slate-400 mt-0.5">base units</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Items affected</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.items}</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Top reason</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.topReason}</div></div>
      </div>

      <div className={card}>
        <div className="flex flex-wrap items-end gap-4 px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
          <label className="flex flex-col gap-1.5"><span className="text-[12px] font-semibold text-slate-400">From</span><input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={`${field} w-auto`} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-[12px] font-semibold text-slate-400">To</span><input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={`${field} w-auto`} /></label>
          <label className="flex flex-col gap-1.5 min-w-[160px]"><span className="text-[12px] font-semibold text-slate-400">Reason</span><SearchableSelect value={reasonFilter} onChange={setReasonFilter} options={[{ value: '', label: 'All reasons' }, ...REASONS]} placeholder="All reasons" minWidth="w-full" className="w-full" /></label>
          <div className="relative flex-1 min-w-[200px] max-w-[320px] ml-auto"><LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search item, reason or notes…" className={`${field} pl-9`} /></div>
        </div>
        {wastageQ.isLoading ? <div className="p-10"><Loader /></div> : (
          <div className="overflow-x-auto"><table className="min-w-full text-sm">
            <thead className="bg-slate-50/70 dark:bg-slate-900/40 text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-400"><tr><th className="py-3 px-4">Date</th><th className="py-3 px-4">Item</th><th className="py-3 px-4 text-right">Qty</th><th className="py-3 px-4">Reason</th><th className="py-3 px-4">By</th><th className="py-3 px-4">Notes</th></tr></thead>
            <tbody className="text-slate-700 dark:text-slate-200">
              {rows.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-slate-400">No wastage in this window.</td></tr> : rows.map((e) => {
                const it = itemById.get(Number(e.inventoryItemId)); const d = e.createdAt ? new Date(e.createdAt) : null;
                return (
                  <tr key={e.id} className="border-t border-slate-100 dark:border-slate-700" style={{ borderLeft: '3px solid #DC2626' }}>
                    <td className="py-3 px-4 text-slate-500">{d ? d.toLocaleDateString() : '—'}<div className="text-[11.5px] text-slate-400">{d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</div></td>
                    <td className="py-3 px-4"><div className="font-semibold text-slate-900 dark:text-slate-100">{it?.name ?? `Item #${e.inventoryItemId}`}</div><div className="text-xs font-mono text-slate-400">{it?.code ?? ''}</div></td>
                    <td className="py-3 px-4 text-right font-bold text-red-600">−{fmtNum(qtyBaseOf(e))} {unitCode(Number(e.inventoryItemId))}</td>
                    <td className="py-3 px-4"><span className="px-2.5 py-1 rounded-full text-xs font-semibold bg-red-50 text-red-700">{prettyReason(e.reason)}</span></td>
                    <td className="py-3 px-4 text-slate-500">{e.creator?.name ?? (e.createdBy != null ? `User #${e.createdBy}` : 'System')}</td>
                    <td className="py-3 px-4 text-slate-500 truncate max-w-[220px]">{e.notes || '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table></div>
        )}
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title="Record wastage" size="medium">
        <div className="space-y-3">
          <div><div className="text-xs font-medium text-slate-500 mb-1">Item</div><SearchableSelect value={f.item} onChange={(v) => setF({ ...f, item: v, uom: itemById.get(Number(v))?.baseUomId ? String(itemById.get(Number(v)).baseUomId) : '' })} options={itemOptions} placeholder="Select item…" searchPlaceholder="Search items…" minWidth="w-full" className="w-full" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-xs font-medium text-slate-500 mb-1">Quantity</div><input className={field} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} placeholder="e.g. 3" /></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Unit</div><SearchableSelect value={f.uom} onChange={(v) => setF({ ...f, uom: v })} options={allowedUoms(selItem).map((u: any) => ({ value: String(u.id), label: u.code }))} placeholder="Unit…" minWidth="w-full" className="w-full" disabled={!selItem} /></div>
          </div>
          <div><div className="text-xs font-medium text-slate-500 mb-1">Reason</div><SearchableSelect value={f.reason} onChange={(v) => setF({ ...f, reason: v })} options={REASONS} minWidth="w-full" className="w-full" /></div>
          <div><div className="text-xs font-medium text-slate-500 mb-1">Notes (optional)</div><input className={field} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder="What happened?" /></div>
          <div className="rounded-lg bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 px-3 py-2 text-xs text-red-700 dark:text-red-300">This posts immediately and removes the quantity from on-hand stock (FEFO). It cannot be undone — correct mistakes with a stock adjustment.</div>
          <div className="flex justify-end gap-2 pt-1"><button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button><button disabled={recordM.isPending} onClick={submit} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">Record wastage</button></div>
        </div>
      </Modal>
    </div>
  );
};

export default WastagePage;
