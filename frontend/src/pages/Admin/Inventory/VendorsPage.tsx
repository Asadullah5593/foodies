import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { LuPlus, LuSearch, LuPencil, LuTrash2, LuMail, LuPhone } from 'react-icons/lu';
import Modal from '../../../components/Modal';
import Loader from '../../../components/Loader';
import SearchableSelect from '../../../components/SearchableSelect';
import apiClient from '../../../utils/apiClient';
import { inventoryService } from '../../../services/api/inventoryService';

const card = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl';
const field = 'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400';
const TYPES = [{ value: 'supplier', label: 'Supplier' }, { value: 'warehouse', label: 'Warehouse' }, { value: 'branch', label: 'Branch (internal)' }];
const TYPE_PILL: Record<string, string> = { supplier: 'bg-blue-100 text-blue-700', warehouse: 'bg-purple-100 text-purple-700', branch: 'bg-green-100 text-green-700' };

const VendorsPage: React.FC = () => {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [f, setF] = useState<any>({ name: '', type: 'supplier', linked_branch_id: '', email: '', phone: '', address: '' });

  const vendorsQ = useQuery({ queryKey: ['inventory-vendors'], queryFn: inventoryService.listVendors });
  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: async () => (await apiClient.get('/admin/branches')).data ?? [] });
  const vendors = (vendorsQ.data ?? []) as any[];
  const branchById = useMemo(() => { const m = new Map<number, string>(); for (const b of branchesQ.data ?? []) m.set(Number(b.id), b.name); return m; }, [branchesQ.data]);
  const invalidate = () => qc.invalidateQueries({ queryKey: ['inventory-vendors'] });

  const createM = useMutation({ mutationFn: (d: any) => inventoryService.createVendor(d), onSuccess: () => { invalidate(); setOpen(false); toast.success('Vendor created'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create') });
  const updateM = useMutation({ mutationFn: ({ id, d }: any) => inventoryService.updateVendor(id, d), onSuccess: () => { invalidate(); setOpen(false); toast.success('Vendor updated'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update') });
  const deleteM = useMutation({ mutationFn: (id: number) => inventoryService.deleteVendor(id), onSuccess: () => { invalidate(); toast.success('Vendor deleted'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to delete') });

  const kpi = useMemo(() => ({ total: vendors.length, suppliers: vendors.filter((v) => v.type === 'supplier').length, warehouses: vendors.filter((v) => v.type === 'warehouse').length, branches: vendors.filter((v) => v.type === 'branch').length }), [vendors]);
  const rows = useMemo(() => {
    let r = vendors;
    if (typeFilter) r = r.filter((v) => v.type === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) r = r.filter((v) => [v.name, v.email, v.phone].some((x) => String(x ?? '').toLowerCase().includes(q)));
    return r;
  }, [vendors, typeFilter, search]);
  const branchOptions = useMemo(() => [{ value: '', label: 'None' }, ...(branchesQ.data ?? []).map((b: any) => ({ value: String(b.id), label: b.name }))], [branchesQ.data]);

  const openCreate = () => { setEditId(null); setF({ name: '', type: 'supplier', linked_branch_id: '', email: '', phone: '', address: '' }); setOpen(true); };
  const openEdit = (v: any) => { setEditId(Number(v.id)); setF({ name: v.name ?? '', type: v.type ?? 'supplier', linked_branch_id: v.linkedBranchId != null ? String(v.linkedBranchId) : '', email: v.email ?? '', phone: v.phone ?? '', address: v.address ?? '' }); setOpen(true); };
  const submit = () => {
    if (!f.name.trim()) { toast.error('Name is required'); return; }
    const d = { name: f.name.trim(), type: f.type, linked_branch_id: f.type === 'branch' && f.linked_branch_id ? Number(f.linked_branch_id) : null, email: f.email || null, phone: f.phone || null, address: f.address || null };
    if (editId) updateM.mutate({ id: editId, d }); else createM.mutate(d);
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12.5px] text-slate-400 font-medium mb-1.5"><span>Inventory</span><span className="text-slate-300">/</span><span className="text-slate-600 dark:text-slate-300 font-semibold">Vendors</span></div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Vendors</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-xl leading-relaxed">Suppliers and internal sources you receive stock from. Purchase orders and goods receipts are placed against these vendors.</p>
        </div>
        <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 text-sm font-semibold shadow-sm"><LuPlus className="w-4 h-4" /> Add vendor</button>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Total vendors</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.total}</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Suppliers</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.suppliers}</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Warehouses</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.warehouses}</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Internal branches</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.branches}</div></div>
      </div>

      <div className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
          <div className="flex gap-1.5">
            {[['', 'All'], ...TYPES.map((t) => [t.value, t.label.split(' ')[0]])].map(([k, lbl]) => (
              <button key={k} onClick={() => setTypeFilter(k)} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${typeFilter === k ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>{lbl}</button>
            ))}
          </div>
          <div className="relative flex-1 min-w-[220px] max-w-[340px]"><LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search name, email or phone…" className={`${field} pl-9`} /></div>
        </div>
        {vendorsQ.isLoading ? <div className="p-10"><Loader /></div> : (
          <table className="min-w-full text-sm">
            <thead className="bg-slate-50/70 dark:bg-slate-900/40 text-left text-[11.5px] font-bold uppercase tracking-wide text-slate-400"><tr><th className="py-3 px-4">Vendor</th><th className="py-3 px-4">Type</th><th className="py-3 px-4">Contact</th><th className="py-3 px-4">Linked branch</th><th className="py-3 px-4 text-right">Actions</th></tr></thead>
            <tbody className="text-slate-700 dark:text-slate-200">
              {rows.length === 0 ? <tr><td colSpan={5} className="py-12 text-center text-slate-400">No vendors found.</td></tr> : rows.map((v) => (
                <tr key={v.id} className="border-t border-slate-100 dark:border-slate-700">
                  <td className="py-3 px-4"><div className="font-semibold text-slate-900 dark:text-slate-100">{v.name}</div>{v.address && <div className="text-xs text-slate-400 truncate max-w-[260px]">{v.address}</div>}</td>
                  <td className="py-3 px-4"><span className={`px-2.5 py-1 rounded-full text-xs font-semibold capitalize ${TYPE_PILL[v.type] ?? 'bg-slate-100 text-slate-600'}`}>{v.type ?? '—'}</span></td>
                  <td className="py-3 px-4 text-[13px]"><div className="space-y-0.5">{v.email && <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300"><LuMail className="w-3.5 h-3.5 text-slate-400" />{v.email}</div>}{v.phone && <div className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300"><LuPhone className="w-3.5 h-3.5 text-slate-400" />{v.phone}</div>}{!v.email && !v.phone && <span className="text-slate-400">—</span>}</div></td>
                  <td className="py-3 px-4">{v.linkedBranchId != null ? (branchById.get(Number(v.linkedBranchId)) ?? `#${v.linkedBranchId}`) : <span className="text-slate-400">—</span>}</td>
                  <td className="py-3 px-4"><div className="flex gap-2 justify-end"><button onClick={() => openEdit(v)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"><LuPencil className="w-3.5 h-3.5" /></button><button onClick={() => { if (confirm(`Delete vendor "${v.name}"?`)) deleteM.mutate(Number(v.id)); }} className="px-2.5 py-1.5 rounded-lg border border-red-200 text-red-600 hover:bg-red-50"><LuTrash2 className="w-3.5 h-3.5" /></button></div></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <Modal isOpen={open} onClose={() => setOpen(false)} title={editId ? 'Edit vendor' : 'Add vendor'} size="medium">
        <div className="space-y-3">
          <div><div className="text-xs font-medium text-slate-500 mb-1">Name</div><input className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Acme Foods Ltd." /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-xs font-medium text-slate-500 mb-1">Type</div><SearchableSelect value={f.type} onChange={(v) => setF({ ...f, type: v })} options={TYPES} minWidth="w-full" className="w-full" /></div>
            {f.type === 'branch' && <div><div className="text-xs font-medium text-slate-500 mb-1">Linked branch</div><SearchableSelect value={f.linked_branch_id} onChange={(v) => setF({ ...f, linked_branch_id: v })} options={branchOptions} placeholder="Select branch…" searchPlaceholder="Search…" minWidth="w-full" className="w-full" /></div>}
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><div className="text-xs font-medium text-slate-500 mb-1">Email</div><input className={field} value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} placeholder="orders@acme.com" /></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Phone</div><input className={field} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder="+1 555 0100" /></div>
          </div>
          <div><div className="text-xs font-medium text-slate-500 mb-1">Address</div><input className={field} value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} placeholder="Street, city…" /></div>
          <div className="flex justify-end gap-2 pt-1"><button onClick={() => setOpen(false)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button><button onClick={submit} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold">{editId ? 'Save changes' : 'Create vendor'}</button></div>
        </div>
      </Modal>
    </div>
  );
};

export default VendorsPage;
