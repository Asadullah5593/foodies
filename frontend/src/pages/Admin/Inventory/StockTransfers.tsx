import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  LuFileText,
  LuPackage,
  LuPackageCheck,
  LuClock,
  LuCircleCheck,
  LuTruck,
  LuDownload,
  LuPlus,
  LuLightbulb,
  LuSearch,
  LuArrowRight,
} from 'react-icons/lu';
import Modal from '../../../components/Modal';
import Loader from '../../../components/Loader';
import PaginationBar from '../../../components/PaginationBar';
import apiClient from '../../../utils/apiClient';
import { inventoryService } from '../../../services/api/inventoryService';

const card = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm';
const field = 'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400';

type TabKey = 'all' | 'requests' | 'dispatch' | 'receive' | 'completed';

const transferType = (sBrand: number | null, dBrand: number | null) => {
  const s = sBrand != null, d = dBrand != null;
  if (!s && !d) return 'Branch → Branch';
  if (!s && d) return 'Branch → Brand';
  if (s && !d) return 'Brand → Branch';
  return 'Brand → Brand';
};

const PILL: Record<string, string> = {
  amber: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  blue: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  green: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300',
  purple: 'bg-purple-100 text-purple-700 dark:bg-purple-900/30 dark:text-purple-300',
  gray: 'bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300',
};

const StockTransfers: React.FC = () => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<TabKey>('all');
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [branchFilter, setBranchFilter] = useState('');
  const [page, setPage] = useState(1);

  const [newOpen, setNewOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<any | null>(null);
  const [detailMode, setDetailMode] = useState<'view' | 'dispatch' | 'receive'>('view');
  const [actionLines, setActionLines] = useState<any[]>([]);

  // New-transfer form
  const [nf, setNf] = useState<any>({});

  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: async () => (await apiClient.get('/admin/branches')).data ?? [] });
  const brandsQ = useQuery({ queryKey: ['brands'], queryFn: async () => (await apiClient.get('/admin/brands')).data ?? [] });
  const itemsQ = useQuery({ queryKey: ['transfer-ref-items'], queryFn: inventoryService.listTransferReferenceItems });
  const uomsQ = useQuery({ queryKey: ['transfer-ref-uoms'], queryFn: inventoryService.listTransferReferenceUoms });
  const requestsQ = useQuery({ queryKey: ['transfer-requests'], queryFn: () => inventoryService.listTransferRequests() });
  const ordersQ = useQuery({ queryKey: ['transfer-orders'], queryFn: () => inventoryService.listTransferOrders() });

  const branchById = useMemo(() => { const m = new Map<number, any>(); for (const b of branchesQ.data ?? []) m.set(Number(b.id), b); return m; }, [branchesQ.data]);
  const brandById = useMemo(() => { const m = new Map<number, any>(); for (const b of brandsQ.data ?? []) m.set(Number(b.id), b); return m; }, [brandsQ.data]);
  const itemById = useMemo(() => { const m = new Map<number, any>(); for (const it of itemsQ.data ?? []) m.set(Number(it.id), it); return m; }, [itemsQ.data]);
  const uomById = useMemo(() => { const m = new Map<number, any>(); for (const u of uomsQ.data ?? []) m.set(Number(u.id), u); return m; }, [uomsQ.data]);
  const requestById = useMemo(() => { const m = new Map<number, any>(); for (const r of requestsQ.data ?? []) m.set(Number(r.id), r); return m; }, [requestsQ.data]);

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['transfer-requests'] });
    queryClient.invalidateQueries({ queryKey: ['transfer-orders'] });
  };

  const brandOptions = useMemo(() => [{ value: '', label: 'Branch pool (shared)' }, ...(brandsQ.data ?? []).map((b: any) => ({ value: String(b.id), label: b.name }))], [brandsQ.data]);

  const bucketLabel = (branchId: number, brandId: number | null) =>
    brandId != null ? brandById.get(Number(brandId))?.name ?? `Brand #${brandId}` : branchById.get(Number(branchId))?.name ?? `Branch #${branchId}`;
  const bucketKind = (brandId: number | null) => (brandId != null ? 'Brand' : 'Branch');

  // Build unified rows: pending/rejected requests + all orders.
  const rows = useMemo(() => {
    const out: any[] = [];
    for (const r of requestsQ.data ?? []) {
      if (r.status !== 'submitted' && r.status !== 'rejected') continue; // approved -> represented by its order
      out.push({
        kind: 'request', raw: r, id: r.id, ref: `REQ-${r.id}`,
        sub: 'Request', status: r.status,
        statusLabel: r.status === 'rejected' ? 'Rejected' : 'Pending approval',
        color: r.status === 'rejected' ? 'gray' : 'amber',
        sourceBranchId: r.sourceBranchId, sourceBrandId: r.sourceBrandId ?? null,
        destinationBranchId: r.destinationBranchId, destinationBrandId: r.destinationBrandId ?? null,
        items: (r.lines ?? []).length, createdAt: r.createdAt,
      });
    }
    for (const o of ordersQ.data ?? []) {
      const isDispatch = o.status === 'approved';
      const isReceive = ['dispatched_partial', 'dispatched_full', 'received_partial'].includes(o.status);
      const isDone = o.status === 'closed';
      const req = requestById.get(Number(o.transferRequestId));
      out.push({
        kind: 'order', raw: o, id: o.id, ref: isDispatch ? `DIS-${o.id}` : isReceive ? `REC-${o.id}` : `TO-${o.id}`,
        sub: isDispatch ? 'Dispatch' : isReceive ? 'Receive' : isDone ? 'Completed' : o.status,
        status: o.status,
        statusLabel: isDispatch ? 'Pending dispatch' : isReceive ? 'Pending receipt' : isDone ? 'Completed' : o.status,
        color: isDispatch ? 'blue' : isReceive ? 'green' : isDone ? 'purple' : 'gray',
        sourceBranchId: o.sourceBranchId, sourceBrandId: o.sourceBrandId ?? null,
        destinationBranchId: o.destinationBranchId, destinationBrandId: o.destinationBrandId ?? null,
        items: (req?.lines ?? []).length, createdAt: o.createdAt, request: req,
      });
    }
    return out.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [requestsQ.data, ordersQ.data, requestById]);

  const stats = useMemo(() => {
    const reqs = requestsQ.data ?? [];
    const ords = ordersQ.data ?? [];
    return {
      pendingApproval: reqs.filter((r: any) => r.status === 'submitted').length,
      pendingDispatch: ords.filter((o: any) => o.status === 'approved').length,
      pendingReceipt: ords.filter((o: any) => ['dispatched_partial', 'dispatched_full', 'received_partial'].includes(o.status)).length,
      completed: ords.filter((o: any) => o.status === 'closed').length,
    };
  }, [requestsQ.data, ordersQ.data]);

  const filteredRows = useMemo(() => {
    let rs = rows;
    if (tab === 'requests') rs = rs.filter((r) => r.kind === 'request');
    else if (tab === 'dispatch') rs = rs.filter((r) => r.statusLabel === 'Pending dispatch');
    else if (tab === 'receive') rs = rs.filter((r) => r.statusLabel === 'Pending receipt');
    else if (tab === 'completed') rs = rs.filter((r) => r.statusLabel === 'Completed');
    if (typeFilter) rs = rs.filter((r) => transferType(r.sourceBrandId, r.destinationBrandId) === typeFilter);
    if (branchFilter) rs = rs.filter((r) => String(r.sourceBranchId) === branchFilter || String(r.destinationBranchId) === branchFilter);
    const q = search.trim().toLowerCase();
    if (q) rs = rs.filter((r) => r.ref.toLowerCase().includes(q) || bucketLabel(r.sourceBranchId, r.sourceBrandId).toLowerCase().includes(q) || bucketLabel(r.destinationBranchId, r.destinationBrandId).toLowerCase().includes(q));
    return rs;
  }, [rows, tab, typeFilter, branchFilter, search]); // eslint-disable-line react-hooks/exhaustive-deps

  const PAGE_SIZE = 10;
  const pageRows = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // --- mutations ---
  const createM = useMutation({
    mutationFn: (data: any) => inventoryService.createTransferRequest(data),
    onSuccess: () => { invalidate(); setNewOpen(false); setNf({}); toast.success('Transfer request created'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create request'),
  });
  const approveM = useMutation({
    mutationFn: (id: number) => inventoryService.approveTransferRequest(id),
    onSuccess: () => { invalidate(); setDetailRow(null); toast.success('Approved — transfer order created'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to approve'),
  });
  const rejectM = useMutation({
    mutationFn: (id: number) => inventoryService.rejectTransferRequest(id),
    onSuccess: () => { invalidate(); setDetailRow(null); toast.success('Request rejected'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to reject'),
  });
  const dispatchM = useMutation({
    mutationFn: ({ id, lines }: any) => inventoryService.dispatchTransferOrder(id, { lines }),
    onSuccess: () => { invalidate(); setDetailRow(null); toast.success('Dispatched'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to dispatch'),
  });
  const receiveM = useMutation({
    mutationFn: ({ id, lines }: any) => inventoryService.receiveTransferOrder(id, { lines }),
    onSuccess: () => { invalidate(); setDetailRow(null); toast.success('Received'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to receive'),
  });

  const getItemAllowedUoms = (item: any) => {
    if (!item) return uomsQ.data ?? [];
    const ids = (Array.isArray(item.baseUomIds) && item.baseUomIds.length ? item.baseUomIds : [item.baseUomId]).map((x: any) => Number(x)).filter((x: number) => x > 0);
    if (!ids.includes(Number(item.baseUomId)) && item.baseUomId) ids.unshift(Number(item.baseUomId));
    const opts = ids.map((id: number) => uomById.get(id)).filter(Boolean);
    return opts.length ? opts : (uomsQ.data ?? []);
  };

  const openDetail = (row: any, mode: 'view' | 'dispatch' | 'receive') => {
    setDetailRow(row);
    setDetailMode(mode);
    if (mode === 'dispatch' || mode === 'receive') {
      const lines = (row.request?.lines ?? []).map((l: any) => ({
        inventory_item_id: l.inventoryItemId,
        qty: String(l.requestedQty),
        qty_uom_id: String(l.requestedUomId),
        lot_code: '',
        expiry_date: '',
      }));
      setActionLines(lines);
    }
  };

  const loading = requestsQ.isLoading || ordersQ.isLoading;

  const StatCard = ({ icon: Icon, tone, label, value, hint }: any) => (
    <div className={`${card} p-4 flex items-start gap-3`}>
      <span className={`w-10 h-10 rounded-lg flex items-center justify-center ${PILL[tone]}`}><Icon className="w-5 h-5" /></span>
      <div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
        <div className="text-2xl font-bold text-slate-900 dark:text-slate-100 leading-tight">{value}</div>
        <div className="text-xs text-slate-400 dark:text-slate-500">{hint}</div>
      </div>
    </div>
  );

  const Step = ({ icon: Icon, n, title, desc }: any) => (
    <div className="flex items-start gap-3">
      <span className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-slate-500 dark:text-slate-300"><Icon className="w-4 h-4" /></span>
      <div>
        <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">{n} {title}</div>
        <div className="text-xs text-slate-500 dark:text-slate-400">{desc}</div>
      </div>
    </div>
  );

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Stock transfers</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Move stock between branches and brands with full control and visibility.</p>
        </div>
        <div className="flex items-center gap-2">
          <a href="/docs/inventory" onClick={(e) => { e.preventDefault(); toast('Create a request → approve → dispatch → receive.'); }}
            className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50">
            <LuLightbulb className="w-4 h-4" /> Learn how it works
          </a>
          <button onClick={() => { setNf({}); setNewOpen(true); }} className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold">
            <LuPlus className="w-4 h-4" /> New transfer
          </button>
        </div>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard icon={LuFileText} tone="amber" label="Transfer requests" value={stats.pendingApproval} hint="Pending approval" />
        <StatCard icon={LuPackage} tone="blue" label="Dispatch orders" value={stats.pendingDispatch} hint="Pending dispatch" />
        <StatCard icon={LuPackageCheck} tone="green" label="Receive orders" value={stats.pendingReceipt} hint="Pending receipt" />
        <StatCard icon={LuClock} tone="purple" label="Completed transfers" value={stats.completed} hint="All time" />
      </div>

      {/* how it works */}
      <div className={`${card} p-5`}>
        <div className="font-semibold text-slate-900 dark:text-slate-100 mb-4">How stock transfers work</div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Step icon={LuFileText} n="1" title="Create request" desc="What stock to move, from where to where." />
          <Step icon={LuCircleCheck} n="2" title="Approve" desc="Review and approve the transfer request." />
          <Step icon={LuTruck} n="3" title="Dispatch" desc="Send stock from source location." />
          <Step icon={LuDownload} n="4" title="Receive" desc="Confirm receipt at destination." />
        </div>
        <div className="mt-4 text-xs text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-700 pt-3">
          Transfers can be branch → branch, brand → brand, branch → brand, or brand → branch.
        </div>
      </div>

      {/* table panel */}
      <div className={`${card} p-0`}>
        {/* tabs */}
        <div className="flex flex-wrap gap-1 px-4 pt-3 border-b border-slate-100 dark:border-slate-700">
          {([['all', 'All'], ['requests', 'Requests'], ['dispatch', 'Dispatch orders'], ['receive', 'Receive orders'], ['completed', 'Completed']] as [TabKey, string][]).map(([k, label]) => (
            <button key={k} onClick={() => { setTab(k); setPage(1); }}
              className={`px-3 py-2 text-sm font-medium border-b-2 -mb-px ${tab === k ? 'border-red-600 text-red-600' : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700'}`}>{label}</button>
          ))}
        </div>

        {/* filters */}
        <div className="flex flex-wrap items-center gap-2 p-4">
          <div className="relative flex-1 min-w-[220px]">
            <LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input className={`${field} pl-9`} placeholder="Search by request/order, reference, branch…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
          </div>
          <select className={`${field} w-auto`} value={typeFilter} onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}>
            <option value="">All transfer types</option>
            {['Branch → Branch', 'Branch → Brand', 'Brand → Branch', 'Brand → Brand'].map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className={`${field} w-auto`} value={branchFilter} onChange={(e) => { setBranchFilter(e.target.value); setPage(1); }}>
            <option value="">All branches</option>
            {(branchesQ.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </select>
          {(search || typeFilter || branchFilter) && (
            <button onClick={() => { setSearch(''); setTypeFilter(''); setBranchFilter(''); setPage(1); }} className="text-sm text-slate-500 hover:text-slate-700 px-2">Clear</button>
          )}
        </div>

        {/* table */}
        {loading ? <div className="p-8"><Loader /></div> : (
          <div className="overflow-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-2.5 px-4 font-medium">ID</th>
                  <th className="py-2.5 px-4 font-medium">Type</th>
                  <th className="py-2.5 px-4 font-medium">From</th>
                  <th className="py-2.5 px-4 font-medium">To</th>
                  <th className="py-2.5 px-4 font-medium">Status</th>
                  <th className="py-2.5 px-4 font-medium">Items</th>
                  <th className="py-2.5 px-4 font-medium">Created</th>
                  <th className="py-2.5 px-4 font-medium text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="text-slate-700 dark:text-slate-200">
                {pageRows.length === 0 ? (
                  <tr><td colSpan={8} className="py-10 text-center text-slate-400">No transfers found.</td></tr>
                ) : pageRows.map((r) => (
                  <tr key={`${r.kind}-${r.id}`} className="border-t border-slate-100 dark:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-700/30">
                    <td className="py-3 px-4"><div className="font-semibold text-slate-900 dark:text-slate-100">{r.ref}</div><div className="text-xs text-slate-400">{r.sub}</div></td>
                    <td className="py-3 px-4">{transferType(r.sourceBrandId, r.destinationBrandId)}</td>
                    <td className="py-3 px-4"><div className="font-medium">{bucketLabel(r.sourceBranchId, r.sourceBrandId)}</div><div className="text-xs text-slate-400">{bucketKind(r.sourceBrandId)}</div></td>
                    <td className="py-3 px-4"><div className="flex items-center gap-1"><LuArrowRight className="w-3.5 h-3.5 text-slate-300 shrink-0" /><div><div className="font-medium">{bucketLabel(r.destinationBranchId, r.destinationBrandId)}</div><div className="text-xs text-slate-400">{bucketKind(r.destinationBrandId)}</div></div></div></td>
                    <td className="py-3 px-4"><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL[r.color]}`}>{r.statusLabel}</span></td>
                    <td className="py-3 px-4">{r.items}</td>
                    <td className="py-3 px-4 text-slate-500 dark:text-slate-400">{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</td>
                    <td className="py-3 px-4">
                      <div className="flex items-center justify-end gap-2">
                        {r.statusLabel === 'Pending dispatch' && <button onClick={() => openDetail(r, 'dispatch')} className="rounded-lg bg-blue-50 text-blue-700 hover:bg-blue-100 px-3 py-1.5 text-xs font-semibold">Dispatch</button>}
                        {r.statusLabel === 'Pending receipt' && <button onClick={() => openDetail(r, 'receive')} className="rounded-lg bg-green-50 text-green-700 hover:bg-green-100 px-3 py-1.5 text-xs font-semibold">Receive</button>}
                        {r.statusLabel === 'Pending approval' && <button onClick={() => openDetail(r, 'view')} className="rounded-lg bg-amber-50 text-amber-700 hover:bg-amber-100 px-3 py-1.5 text-xs font-semibold">Review</button>}
                        <button onClick={() => openDetail(r, 'view')} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">View</button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="p-4">
              <PaginationBar totalCount={filteredRows.length} page={page} pageSize={PAGE_SIZE} onPageChange={setPage} itemLabel="transfers" />
            </div>
          </div>
        )}
      </div>

      {/* New transfer modal */}
      <Modal isOpen={newOpen} onClose={() => setNewOpen(false)} title="New transfer" size="large">
        <div className="space-y-3">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
            <div><div className="text-xs font-medium text-slate-500 mb-1">Source branch</div>
              <select className={field} value={nf.sb ?? ''} onChange={(e) => setNf({ ...nf, sb: e.target.value })}>
                <option value="">Select branch…</option>{(branchesQ.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Source brand bucket</div>
              <select className={field} value={nf.sbr ?? ''} onChange={(e) => setNf({ ...nf, sbr: e.target.value })}>{brandOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Destination branch</div>
              <select className={field} value={nf.db ?? ''} onChange={(e) => setNf({ ...nf, db: e.target.value })}>
                <option value="">Select branch…</option>{(branchesQ.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Destination brand bucket</div>
              <select className={field} value={nf.dbr ?? ''} onChange={(e) => setNf({ ...nf, dbr: e.target.value })}>{brandOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Item</div>
              <select className={field} value={nf.item ?? ''} onChange={(e) => { const it = itemById.get(Number(e.target.value)); setNf({ ...nf, item: e.target.value, uom: it?.baseUomId ? String(it.baseUomId) : '' }); }}>
                <option value="">Select item…</option>{(itemsQ.data ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select></div>
            <div className="grid grid-cols-2 gap-2">
              <div><div className="text-xs font-medium text-slate-500 mb-1">Quantity</div><input className={field} placeholder="e.g. 5" value={nf.qty ?? ''} onChange={(e) => setNf({ ...nf, qty: e.target.value })} /></div>
              <div><div className="text-xs font-medium text-slate-500 mb-1">Unit</div>
                <select className={field} value={nf.uom ?? ''} onChange={(e) => setNf({ ...nf, uom: e.target.value })} disabled={!nf.item}>
                  <option value="">Unit…</option>{getItemAllowedUoms(itemById.get(Number(nf.item))).map((u: any) => <option key={u.id} value={u.id}>{u.code}</option>)}
                </select></div>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setNewOpen(false)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button onClick={() => {
              if (!nf.sb || !nf.db || !nf.item || !nf.qty || !nf.uom) { toast.error('Fill all required fields'); return; }
              const sbr = nf.sbr ? Number(nf.sbr) : null, dbr = nf.dbr ? Number(nf.dbr) : null;
              if (Number(nf.sb) === Number(nf.db) && sbr === dbr) { toast.error('Source and destination (branch, brand) must differ'); return; }
              createM.mutate({ source_branch_id: Number(nf.sb), destination_branch_id: Number(nf.db), source_brand_id: sbr, destination_brand_id: dbr, lines: [{ inventory_item_id: Number(nf.item), requested_qty: Number(nf.qty), requested_uom_id: Number(nf.uom) }] });
            }} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold">Create request</button>
          </div>
        </div>
      </Modal>

      {/* Detail / action modal */}
      <Modal isOpen={detailRow != null} onClose={() => setDetailRow(null)} title={detailRow ? `${detailRow.ref} · ${transferType(detailRow.sourceBrandId, detailRow.destinationBrandId)}` : ''} size="large">
        {detailRow && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div><div className="text-xs text-slate-500">From</div><div className="font-medium">{bucketLabel(detailRow.sourceBranchId, detailRow.sourceBrandId)} <span className="text-xs text-slate-400">({bucketKind(detailRow.sourceBrandId)})</span></div></div>
              <div><div className="text-xs text-slate-500">To</div><div className="font-medium">{bucketLabel(detailRow.destinationBranchId, detailRow.destinationBrandId)} <span className="text-xs text-slate-400">({bucketKind(detailRow.destinationBrandId)})</span></div></div>
              <div><div className="text-xs text-slate-500">Status</div><span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${PILL[detailRow.color]}`}>{detailRow.statusLabel}</span></div>
              <div><div className="text-xs text-slate-500">Created</div><div>{detailRow.createdAt ? new Date(detailRow.createdAt).toLocaleString() : '—'}</div></div>
            </div>

            {/* line items */}
            {(() => {
              const lines = detailRow.kind === 'request' ? (detailRow.raw.lines ?? []) : (detailRow.request?.lines ?? []);
              if (detailMode === 'view') {
                return (
                  <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-slate-500"><tr><th className="py-2 px-3 font-medium">Item</th><th className="py-2 px-3 font-medium">Requested</th></tr></thead>
                      <tbody>{lines.map((l: any, i: number) => (<tr key={i} className="border-t border-slate-100 dark:border-slate-700"><td className="py-2 px-3">{itemById.get(Number(l.inventoryItemId))?.name ?? `Item #${l.inventoryItemId}`}</td><td className="py-2 px-3">{Number(l.requestedQty)} {uomById.get(Number(l.requestedUomId))?.code ?? ''}</td></tr>))}</tbody>
                    </table>
                  </div>
                );
              }
              // dispatch / receive editable lines
              return (
                <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3 space-y-2">
                  <div className="text-sm font-medium">{detailMode === 'dispatch' ? 'Dispatch quantities' : 'Received quantities'}</div>
                  {actionLines.map((al, i) => {
                    const item = itemById.get(Number(al.inventory_item_id));
                    return (
                      <div key={i} className="grid grid-cols-1 lg:grid-cols-[1fr_100px_120px_auto] gap-2 items-center">
                        <div className="text-sm">{item?.name ?? `Item #${al.inventory_item_id}`}</div>
                        <input className={field} value={al.qty} onChange={(e) => setActionLines(actionLines.map((x, j) => j === i ? { ...x, qty: e.target.value } : x))} />
                        <select className={field} value={al.qty_uom_id} onChange={(e) => setActionLines(actionLines.map((x, j) => j === i ? { ...x, qty_uom_id: e.target.value } : x))}>
                          {getItemAllowedUoms(item).map((u: any) => <option key={u.id} value={u.id}>{u.code}</option>)}
                        </select>
                        {detailMode === 'receive' && (
                          <input type="date" className={field} value={al.expiry_date} onChange={(e) => setActionLines(actionLines.map((x, j) => j === i ? { ...x, expiry_date: e.target.value } : x))} title={item?.trackExpiry ? 'Expiry required' : 'Expiry (optional)'} />
                        )}
                      </div>
                    );
                  })}
                  <div className="text-xs text-slate-500">Partial dispatch / receive is supported.</div>
                </div>
              );
            })()}

            {/* actions */}
            <div className="flex justify-end gap-2 pt-1">
              {detailMode === 'view' && detailRow.kind === 'request' && detailRow.status === 'submitted' && (
                <>
                  <button onClick={() => rejectM.mutate(detailRow.id)} className="rounded-lg border border-red-200 text-red-600 px-4 py-2 text-sm font-medium hover:bg-red-50">Reject</button>
                  <button onClick={() => approveM.mutate(detailRow.id)} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold">Approve</button>
                </>
              )}
              {detailMode === 'view' && detailRow.statusLabel === 'Pending dispatch' && (
                <button onClick={() => setDetailMode('dispatch')} className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold">Dispatch…</button>
              )}
              {detailMode === 'view' && detailRow.statusLabel === 'Pending receipt' && (
                <button onClick={() => openDetail(detailRow, 'receive')} className="rounded-lg bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-sm font-semibold">Receive…</button>
              )}
              {detailMode === 'dispatch' && (
                <button onClick={() => dispatchM.mutate({ id: detailRow.id, lines: actionLines.filter((l) => Number(l.qty) > 0).map((l) => ({ inventory_item_id: Number(l.inventory_item_id), qty: Number(l.qty), qty_uom_id: Number(l.qty_uom_id), location_id: null })) })}
                  className="rounded-lg bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 text-sm font-semibold">Confirm dispatch</button>
              )}
              {detailMode === 'receive' && (
                <button onClick={() => {
                  for (const l of actionLines) { const it = itemById.get(Number(l.inventory_item_id)); if (it?.trackExpiry && !l.expiry_date && Number(l.qty) > 0) { toast.error(`Expiry required for ${it.name}`); return; } }
                  receiveM.mutate({ id: detailRow.id, lines: actionLines.filter((l) => Number(l.qty) > 0).map((l) => ({ inventory_item_id: Number(l.inventory_item_id), received_qty: Number(l.qty), received_uom_id: Number(l.qty_uom_id), lot_code: l.lot_code || null, expiry_date: l.expiry_date || null })) });
                }} className="rounded-lg bg-green-600 hover:bg-green-700 text-white px-4 py-2 text-sm font-semibold">Confirm receipt</button>
              )}
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default StockTransfers;
