import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { LuPlus, LuSearch, LuPencil, LuTrash2 } from 'react-icons/lu';
import Modal from '../../../components/Modal';
import Loader from '../../../components/Loader';
import SearchableSelect from '../../../components/SearchableSelect';
import { inventoryService } from '../../../services/api/inventoryService';

const card = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl';
const field = 'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400';
const KINDS = [{ value: 'count', label: 'Count (pcs)' }, { value: 'mass', label: 'Mass (g, kg)' }, { value: 'volume', label: 'Volume (ml, L)' }];
const KIND_PILL: Record<string, string> = { count: 'bg-blue-100 text-blue-700', mass: 'bg-purple-100 text-purple-700', volume: 'bg-cyan-100 text-cyan-700' };

const UomsPage: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [baseFilter, setBaseFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [f, setF] = useState<any>({ name: '', code: '', kind: 'count', base_uom_id: '', multiplier_to_base: '' });

  const uomsQ = useQuery({ queryKey: ['inventory-uoms'], queryFn: inventoryService.listUoms });
  const uoms = (uomsQ.data ?? []) as any[];
  const invalidate = () => qc.invalidateQueries({ queryKey: ['inventory-uoms'] });
  const nameById = useMemo(() => { const m = new Map<number, string>(); for (const u of uoms) m.set(Number(u.id), u.code ?? u.name); return m; }, [uoms]);

  const createM = useMutation({ mutationFn: (d: any) => inventoryService.createUom(d), onSuccess: () => { invalidate(); setOpen(false); toast.success('Unit created'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create') });
  const updateM = useMutation({ mutationFn: ({ id, d }: any) => inventoryService.updateUom(id, d), onSuccess: () => { invalidate(); setOpen(false); toast.success('Unit updated'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update') });
  const deleteM = useMutation({ mutationFn: (id: number) => inventoryService.deleteUom(id), onSuccess: () => { invalidate(); toast.success('Unit deleted'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete') });

  const kpi = useMemo(() => ({ total: uoms.length, base: uoms.filter((u) => u.baseUomId == null).length, derived: uoms.filter((u) => u.baseUomId != null).length, kinds: new Set(uoms.map((u) => u.kind)).size }), [uoms]);
  const rows = useMemo(() => {
    let r = uoms;
    if (baseFilter === 'base') r = r.filter((u) => u.baseUomId == null);
    else if (baseFilter === 'derived') r = r.filter((u) => u.baseUomId != null);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((u) => String(u.name ?? '').toLowerCase().includes(q) || String(u.code ?? '').toLowerCase().includes(q));
    return r;
  }, [uoms, baseFilter, search]);

  const baseOptions = useMemo(() => [{ value: '', label: 'None — this is a base unit' }, ...uoms.filter((u) => Number(u.id) !== editId).map((u) => ({ value: String(u.id), label: `${u.name} (${u.code})` }))], [uoms, editId]);

  const openCreate = () => { setEditId(null); setF({ name: '', code: '', kind: 'count', base_uom_id: '', multiplier_to_base: '' }); setOpen(true); };
  const openEdit = (u: any) => { setEditId(Number(u.id)); setF({ name: u.name ?? '', code: u.code ?? '', kind: u.kind ?? 'count', base_uom_id: u.baseUomId != null ? String(u.baseUomId) : '', multiplier_to_base: u.multiplierToBase != null ? String(u.multiplierToBase) : '' }); setOpen(true); };
  const submit = () => {
    if (!f.name.trim() || !f.code.trim()) { toast.error('Name and code are required'); return; }
    const baseId = f.base_uom_id ? Number(f.base_uom_id) : null;
    if (baseId != null && !(Number(f.multiplier_to_base) > 0)) { toast.error('Multiplier to base must be > 0'); return; }
    const d = { name: f.name.trim(), code: f.code.trim(), kind: f.kind, base_uom_id: baseId, multiplier_to_base: baseId != null ? Number(f.multiplier_to_base) : null };
    if (editId) updateM.mutate({ id: editId, d }); else createM.mutate(d);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12.5px] text-slate-400 font-medium mb-1.5"><span>Inventory</span><span className="text-slate-300">/</span><span className="text-slate-600 dark:text-slate-300 font-semibold">Units of measure</span></div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Units of Measure</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-xl leading-relaxed">Define the units stock is counted in. A base unit stands alone; a derived unit converts into its base via a multiplier (e.g. 1 kg → 1000 g).</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 text-sm font-semibold shadow-sm"><LuPlus className="w-4 h-4" /> Add unit</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Total units</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.total}</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Base units</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.base}</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Derived units</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.derived}</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Measurement kinds</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.kinds}</div></div>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
          <div className="flex gap-1.5">
            {[['', 'All'], ['base', 'Base units'], ['derived', 'Derived units']].map(([k, lbl]) => (
              <button key={k} onClick={() => setBaseFilter(k)} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${baseFilter === k ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>{lbl}</button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[220px] max-w-[340px]"><LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name or code…" className={`${field} pl-9`} /></div>
        </div>
        {uomsQ.isLoading ? <div className="p-10"><Loader /></div> : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/70 dark:bg-slate-900/40 text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-400"><tr><th className="py-3 px-4">Name</th><th className="py-3 px-4">Code</th><th className="py-3 px-4">Kind</th><th className="py-3 px-4">Base unit</th><th className="py-3 px-4">Conversion</th><th className="py-3 px-4 text-right">Actions</th></tr></thead>
            <tbody className="text-slate-700 dark:text-slate-200">
              {rows.length === 0 ? <tr><td colSpan={6} className="py-12 text-center text-slate-400">No units found.</td></tr> : rows.map((u) => (
                <tr key={u.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">{u.name}</td>
                  <td className="py-3 px-4 font-mono text-slate-500">{u.code}</td>
                  <td className="py-3 px-4"><span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${KIND_PILL[u.kind] ?? 'bg-slate-100 text-slate-600'}`}>{u.kind ?? '—'}</span></td>
                  <td className="py-3 px-4">{u.baseUomId == null ? <span className="text-slate-400">Base unit</span> : (nameById.get(Number(u.baseUomId)) ?? `#${u.baseUomId}`)}</td>
                  <td className="py-3 px-4 text-slate-500">{u.baseUomId == null ? '—' : `× ${Number(u.multiplierToBase)} ${nameById.get(Number(u.baseUomId)) ?? ''}`}</td>
                  <td className="py-3 px-4"><div className="flex gap-2 justify-end"><button onClick={() => openEdit(u)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"><LuPencil className="w-3.5 h-3.5" /></button><button onClick={() => { if (confirm(`Delete unit "${u.name}"?`)) deleteM.mutate(Number(u.id)); }} className="px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><LuTrash2 className="w-3.5 h-3.5" /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editId ? 'Edit unit' : 'Add unit'} size="medium">
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-xs font-medium text-slate-500 mb-1">Name</div><input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Kilogram" /></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Code</div><input className={field} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} placeholder="kg" /></div>
          </div>
          <div><div className="text-xs font-medium text-slate-500 mb-1">Measurement kind</div><SearchableSelect value={f.kind} onChange={(v) => setF({ ...f, kind: v })} options={KINDS} minWidth="w-full" className="w-full" /></div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
            <div className="text-xs text-slate-500">Leave the base unit empty for a standalone base unit. Otherwise pick the base it converts into and the multiplier.</div>
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs font-medium text-slate-500 mb-1">Converts into (base)</div><SearchableSelect value={f.base_uom_id} onChange={(v) => setF({ ...f, base_uom_id: v })} options={baseOptions} placeholder="None — base unit" searchPlaceholder="Search units…" minWidth="w-full" className="w-full" /></div>
              <div><div className="text-xs font-medium text-slate-500 mb-1">Multiplier to base</div><input className={field} value={f.multiplier_to_base} onChange={(e) => setF({ ...f, multiplier_to_base: e.target.value })} placeholder="1000" disabled={!f.base_uom_id} /></div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-1"><button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button><button onClick={submit} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold">{editId ? 'Save changes' : 'Create unit'}</button></div>
        </div>
      </Modal>
    </div>
  );
};

export default UomsPage;
