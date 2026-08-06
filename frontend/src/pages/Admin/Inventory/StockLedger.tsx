import React, { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { LuPackage, LuSlidersHorizontal, LuUtensils, LuTruck, LuTrash2, LuRotateCcw, LuArrowUp, LuArrowDown, LuDownload, LuExternalLink } from 'react-icons/lu';
import Loader from '../../../components/Loader';
import SearchableSelect from '../../../components/SearchableSelect';
import apiClient from '../../../utils/apiClient';
import { inventoryService } from '../../../services/api/inventoryService';
import { recordBeacon } from '../../../utils/activityBeacon';

const card = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl';
const fieldBox = 'flex items-center gap-2 px-3 py-2 border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 text-sm';
const BRAND_DOTS = ['#16A34A', '#7C3AED', '#EA580C', '#2563EB', '#DB2777', '#0891B2', '#CA8A04', '#4F46E5'];

// eventType -> label/sub/icon-category. Direction (in/out) comes from qtyDelta sign.
const EVENT_META: Record<string, { name: string; sub: string; cat: string }> = {
  receive: { name: 'Received', sub: 'Goods receipt (GRN)', cat: 'receive' },
  receive_reversal: { name: 'Receipt reversed', sub: 'GRN reversal', cat: 'receive' },
  transfer_receipt: { name: 'Transfer IN', sub: 'Receipt', cat: 'transfer' },
  transfer_order: { name: 'Transfer OUT', sub: 'Dispatch', cat: 'transfer' },
  adjustment_in: { name: 'Adjustment IN', sub: 'Manual correction', cat: 'adjust' },
  adjustment_out: { name: 'Adjustment OUT', sub: 'Manual correction', cat: 'adjust' },
  consume: { name: 'Consumption', sub: 'Order fulfilment', cat: 'consume' },
  consume_shortfall: { name: 'Consumption', sub: 'Sold — no stock', cat: 'consume' },
  consume_reversal: { name: 'Reversal', sub: 'Order cancelled', cat: 'consume' },
  waste: { name: 'Wastage', sub: 'Write-off', cat: 'waste' },
};
const CAT_ICON: Record<string, React.ComponentType<any>> = {
  transfer: LuPackage, adjust: LuSlidersHorizontal, consume: LuUtensils, receive: LuTruck, waste: LuTrash2, reversal: LuRotateCcw, other: LuPackage,
};

const toDateInput = (d: Date) => d.toISOString().slice(0, 10);
const fmtNum = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

const StockLedger: React.FC = () => {
  const navigate = useNavigate();
  const [branchId, setBranchId] = useState<number | null>(null);
  const [from, setFrom] = useState(() => { const d = new Date(); d.setDate(d.getDate() - 6); return toDateInput(d); });
  const [to, setTo] = useState(() => toDateInput(new Date()));
  const [eventType, setEventType] = useState('');
  const [itemId, setItemId] = useState('');
  const [dir, setDir] = useState<'all' | 'in' | 'out'>('all');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 50;

  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: async () => (await apiClient.get('/admin/branches')).data ?? [] });
  const brandsQ = useQuery({ queryKey: ['brands'], queryFn: async () => (await apiClient.get('/admin/brands')).data ?? [] });
  const itemsQ = useQuery({ queryKey: ['inventory-items'], queryFn: inventoryService.listItems });
  const uomsQ = useQuery({ queryKey: ['inventory-uoms'], queryFn: inventoryService.listUoms });
  const branches = branchesQ.data ?? [];
  const activeBranchId = branchId ?? (branches[0]?.id ?? null);

  // Fetch the WHOLE window (the backend caps page_size at 200) by paging through, up
  // to a safety cap, so KPIs / direction filter / pagination reflect the full set
  // rather than just the latest 200. `capped` flags the rare >cap case.
  const FETCH_CAP_PAGES = 25; // 25 × 200 = 5000 rows
  const ledgerQ = useQuery({
    queryKey: ['ledger', activeBranchId, from, to, eventType, itemId],
    queryFn: async () => {
      const items: any[] = [];
      let total = 0, pg = 1;
      for (;;) {
        const res = await inventoryService.getLedger(activeBranchId as number, { from: from || undefined, to: to || undefined, event_type: eventType || undefined, inventory_item_id: itemId ? Number(itemId) : undefined, page: pg, page_size: 200 });
        const batch = res?.items ?? [];
        items.push(...batch);
        total = Number(res?.total ?? items.length);
        if (batch.length < 200 || items.length >= total || pg >= FETCH_CAP_PAGES) break;
        pg++;
      }
      return { items, total, capped: items.length < total };
    },
    enabled: activeBranchId != null,
  });
  const allRows: any[] = ledgerQ.data?.items ?? [];
  const serverTotal: number = ledgerQ.data?.total ?? allRows.length;
  const capped: boolean = !!ledgerQ.data?.capped;

  const itemById = useMemo(() => { const m = new Map<number, any>(); for (const it of itemsQ.data ?? []) m.set(Number(it.id), it); return m; }, [itemsQ.data]);
  const uomById = useMemo(() => { const m = new Map<number, any>(); for (const u of uomsQ.data ?? []) m.set(Number(u.id), u); return m; }, [uomsQ.data]);
  const brandById = useMemo(() => { const m = new Map<number, { name: string; color: string }>(); for (const b of brandsQ.data ?? []) m.set(Number(b.id), { name: b.name, color: BRAND_DOTS[Number(b.id) % BRAND_DOTS.length] }); return m; }, [brandsQ.data]);
  const itemOptions = useMemo(() => [{ value: '', label: 'All items' }, ...(itemsQ.data ?? []).map((it: any) => ({ value: String(it.id), label: it.name }))], [itemsQ.data]);
  const typeOptions = useMemo(() => [{ value: '', label: 'All movements' }, ...Object.entries(EVENT_META).map(([k, v]) => ({ value: k, label: v.name + (v.sub ? ` · ${v.sub}` : '') }))], []);

  const unitCode = (iid: number) => uomById.get(Number(itemById.get(iid)?.baseUomId))?.code ?? '';

  // KPIs over the date/item/type-filtered window (not affected by the direction toggle).
  const kpi = useMemo(() => {
    let inQty = 0, outQty = 0, inCount = 0, outCount = 0;
    for (const r of allRows) { const d = Number(r.qtyDelta ?? 0); if (d > 0) { inQty += d; inCount++; } else if (d < 0) { outQty += Math.abs(d); outCount++; } }
    const net = inQty - outQty;
    return { count: allRows.length, inQty, outQty, inCount, outCount, net };
  }, [allRows]);

  const filtered = useMemo(() => allRows.filter((r) => { const d = Number(r.qtyDelta ?? 0); return dir === 'all' || (dir === 'in' && d > 0) || (dir === 'out' && d < 0); }), [allRows, dir]);
  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const refMeta = (r: any): { label: string; path: string | null } => {
    const t = String(r?.eventRefType ?? '').toLowerCase(); const id = Number(r?.eventRefId ?? NaN);
    if (!t || !Number.isFinite(id) || id <= 0) return { label: '—', path: null };
    if (t === 'grn') return { label: `GRN-${id}`, path: `/admin/procurement/grns?grn_id=${id}` };
    if (t === 'inventory_adjustment') return { label: `ADJ-${id}`, path: '/admin/inventory/adjustments' };
    if (t === 'transfer_order') return { label: `TO-${id}`, path: '/admin/inventory/transfers' };
    if (t === 'transfer_receipt') return { label: `TR-${id}`, path: '/admin/inventory/transfers' };
    if (t === 'stocktake') return { label: `ST-${id}`, path: '/admin/inventory/stocktake' };
    if (t === 'wastage_event') return { label: `WST-${id}`, path: '/admin/inventory/wastage' };
    if (t === 'order') return { label: `ORD-${id}`, path: '/admin/orders' };
    return { label: `${t}:${id}`, path: null };
  };

  const exportCsv = () => {
    const headers = ['time', 'movement_type', 'item', 'item_code', 'bucket', 'batch_id', 'lot_code', 'expiry_date', 'qty_delta', 'uom', 'reference', 'by', 'notes'];
    const esc = (v: any) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const lines = [headers.join(',')];
    for (const r of filtered) {
      const it = itemById.get(Number(r.inventoryItemId));
      const bucket = r.brandId == null ? 'Unassigned' : (brandById.get(Number(r.brandId))?.name ?? `Brand #${r.brandId}`);
      lines.push([r.createdAt ? new Date(r.createdAt).toLocaleString() : '', r.eventType ?? '', it?.name ?? `Item #${r.inventoryItemId}`, it?.code ?? '', bucket, r.inventoryBatchId ?? '', r.inventoryBatch?.lotCode ?? '', r.inventoryBatch?.expiryDate ?? '', Number(r.qtyDelta ?? 0), unitCode(Number(r.inventoryItemId)), refMeta(r).label, r.creator?.name ?? (r.createdBy != null ? `User #${r.createdBy}` : 'System'), r.notes ?? ''].map(esc).join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    // A download never reaches the server, so this is the only place it can
    // be recorded. Exporting data is the step before it leaves the building.
    recordBeacon({ action: 'client.export', subject: 'inventory-ledger' });
    const url = URL.createObjectURL(blob); const a = document.createElement('a');
    a.href = url; a.download = `ledger-${activeBranchId}-${from || 'all'}-to-${to || 'all'}.csv`;
    document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
  };

  const clearFilters = () => { const d = new Date(); d.setDate(d.getDate() - 6); setFrom(toDateInput(d)); setTo(toDateInput(new Date())); setEventType(''); setItemId(''); setDir('all'); setPage(1); };

  const loading = branchesQ.isLoading || ledgerQ.isLoading;
  const fmtRange = `${from ? new Date(from).toLocaleDateString() : '…'} – ${to ? new Date(to).toLocaleDateString() : '…'}`;

  const DirTab = ({ id, label, color }: any) => {
    const on = dir === id;
    return <button onClick={() => { setDir(id); setPage(1); }} className={`px-3.5 py-1.5 rounded-md text-[13px] font-semibold ${on ? 'bg-white dark:bg-slate-700 shadow-sm' : ''}`} style={{ color: on ? color : '#7A828F' }}>{label}</button>;
  };

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12.5px] text-slate-400 font-medium mb-1.5"><span>Inventory</span><span className="text-slate-300">/</span><span className="text-slate-600 dark:text-slate-300 font-semibold">Stock movement ledger</span></div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Stock Movement Ledger</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-2xl leading-relaxed">The audit trail of every stock change — receipts, consumption, wastage, adjustments and transfers. Click a reference to open its source document.</p>
        </div>
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-red-500 pointer-events-none" />
          <select value={activeBranchId ?? ''} onChange={(e) => { setBranchId(Number(e.target.value)); setPage(1); }} className="appearance-none pl-7 pr-9 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-slate-100 min-w-[210px]">
            {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
          </select>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Movements</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.count}{serverTotal > kpi.count ? <span className="text-sm text-slate-400 font-semibold"> /{serverTotal}</span> : ''}</div><div className="text-xs text-slate-400 mt-0.5">{fmtRange}</div></div>
        <div className={`${card} p-4`}><div className="flex items-center gap-1.5 text-[13px] font-semibold text-green-600"><LuArrowUp className="w-3.5 h-3.5" />Stock in</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">+{fmtNum(kpi.inQty)}</div><div className="text-xs text-slate-400 mt-0.5">Across {kpi.inCount} movements</div></div>
        <div className={`${card} p-4`}><div className="flex items-center gap-1.5 text-[13px] font-semibold text-red-600"><LuArrowDown className="w-3.5 h-3.5" />Stock out</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">−{fmtNum(kpi.outQty)}</div><div className="text-xs text-slate-400 mt-0.5">Across {kpi.outCount} movements</div></div>
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Net change</div><div className="text-2xl font-bold mt-2" style={{ color: kpi.net > 0 ? '#16A34A' : kpi.net < 0 ? '#DC2626' : undefined }}>{kpi.net >= 0 ? '+' : '−'}{fmtNum(Math.abs(kpi.net))}</div><div className="text-xs text-slate-400 mt-0.5">In − out, this window</div></div>
      </div>

      {/* table */}
      <div className={card}>
        <div className="flex items-center justify-between gap-4 px-4 py-4 border-b border-slate-100 dark:border-slate-700 flex-wrap">
          <div><div className="text-[15px] font-bold text-slate-900 dark:text-slate-100">Movements</div><div className="text-[12.5px] text-slate-400 mt-0.5">Filter by date, item, type or reference</div></div>
          <div className="flex gap-2">
            <button onClick={exportCsv} disabled={filtered.length === 0} className="inline-flex items-center gap-2 px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50"><LuDownload className="w-3.5 h-3.5" /> Export CSV</button>
            <button onClick={clearFilters} className="px-3.5 py-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-[13px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">Clear filters</button>
          </div>
        </div>

        {/* filters */}
        <div className="flex items-end gap-4 px-4 py-4 border-b border-slate-100 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-900/30 flex-wrap">
          <label className="flex flex-col gap-1.5"><span className="text-[12px] font-semibold text-slate-400">From</span><input type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} className={fieldBox} /></label>
          <label className="flex flex-col gap-1.5"><span className="text-[12px] font-semibold text-slate-400">To</span><input type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} className={fieldBox} /></label>
          <label className="flex flex-col gap-1.5 min-w-[170px]"><span className="text-[12px] font-semibold text-slate-400">Item</span><SearchableSelect value={itemId} onChange={(v) => { setItemId(v); setPage(1); }} options={itemOptions} placeholder="All items" searchPlaceholder="Search items…" minWidth="w-full" className="w-full" /></label>
          <label className="flex flex-col gap-1.5 min-w-[200px]"><span className="text-[12px] font-semibold text-slate-400">Movement type</span><SearchableSelect value={eventType} onChange={(v) => { setEventType(v); setPage(1); }} options={typeOptions} placeholder="All movements" searchPlaceholder="Search…" minWidth="w-full" className="w-full" /></label>
          <div className="flex flex-col gap-1.5 ml-auto"><span className="text-[12px] font-semibold text-slate-400">Direction</span>
            <div className="flex bg-slate-200/70 dark:bg-slate-700 rounded-lg p-1 gap-1"><DirTab id="all" label="All" color="#1F2430" /><DirTab id="in" label="Stock in" color="#0F8A4F" /><DirTab id="out" label="Stock out" color="#DC2626" /></div>
          </div>
        </div>

        {loading ? <div className="p-10"><Loader /></div> : (
          <div className="overflow-x-auto">
            <div className="grid items-center px-4 py-3 bg-slate-50/70 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700 text-[11.5px] font-bold uppercase tracking-wide text-slate-400 min-w-[1020px]" style={{ gridTemplateColumns: '150px minmax(180px,1.3fr) 130px 140px minmax(150px,1fr) 110px 120px 110px' }}>
              <div>Time</div><div>Type</div><div>Item</div><div>Location</div><div>Lot / Expiry</div><div className="text-right pr-2">Qty Δ</div><div className="pl-3">Reference</div><div>By</div>
            </div>
            {pageRows.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-400">No movements in this window.</div>
            ) : pageRows.map((r) => {
              const isIn = Number(r.qtyDelta ?? 0) > 0;
              const meta = EVENT_META[String(r.eventType)] ?? { name: String(r.eventType ?? 'Movement'), sub: '', cat: 'other' };
              const Icon = CAT_ICON[meta.cat] ?? LuPackage;
              const it = itemById.get(Number(r.inventoryItemId));
              const uc = unitCode(Number(r.inventoryItemId));
              const d = r.createdAt ? new Date(r.createdAt) : null;
              const batch = r.inventoryBatch ?? null;
              const exp = batch?.expiryDate ? new Date(batch.expiryDate) : null;
              const expDays = exp ? Math.ceil((exp.getTime() - Date.now()) / 86400000) : null;
              const near = expDays != null && expDays <= 7;
              const expBadge = expDays == null ? '' : expDays < 0 ? 'Expired' : expDays === 0 ? 'Today' : `· ${expDays}d`;
              const isPool = r.brandId == null;
              const bucket = isPool ? null : brandById.get(Number(r.brandId));
              const bucketName = isPool ? 'Unassigned' : (bucket?.name ?? `Brand #${r.brandId}`);
              const bucketColor = isPool ? '#94A3B8' : (bucket?.color ?? '#94A3B8');
              const rm = refMeta(r);
              const by = r.creator?.name ?? (r.createdBy != null ? `User #${r.createdBy}` : 'System');
              return (
                <div key={r.id} className="grid items-center px-4 py-3 border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50/60 dark:hover:bg-slate-700/30 min-w-[1020px]" style={{ gridTemplateColumns: '150px minmax(180px,1.3fr) 130px 140px minmax(150px,1fr) 110px 120px 110px', borderLeft: `3px solid ${isIn ? '#16A34A' : '#DC2626'}` }}>
                  <div className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">{d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '—'}<div className="text-[11.5px] text-slate-400 font-medium">{d ? d.toLocaleDateString() : ''}</div></div>
                  <div className="flex items-center gap-2.5 pr-2 min-w-0">
                    <span className="w-[34px] h-[34px] rounded-lg flex items-center justify-center flex-none" style={{ background: isIn ? '#E9F8F0' : '#FCE9E9' }}><Icon className="w-[17px] h-[17px]" style={{ color: isIn ? '#16A34A' : '#DC2626' }} /></span>
                    <div className="min-w-0"><div className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 truncate">{meta.name}</div><div className="text-[11.5px] text-slate-400 truncate">{meta.sub}</div></div>
                  </div>
                  <div className="min-w-0"><div className="text-[13.5px] font-semibold text-slate-900 dark:text-slate-100 truncate">{it?.name ?? `Item #${r.inventoryItemId}`}</div><div className="text-[11.5px] text-slate-400 truncate">{it?.code ?? ''}</div></div>
                  <div>
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[12.5px] font-semibold" style={{ color: isPool ? '#64748B' : '#334155', background: '#F1F5F9' }}><span className="w-1.5 h-1.5 rounded-full" style={{ background: bucketColor }} />{bucketName}</span>
                  </div>
                  <div>
                    {batch ? <>
                      <div className="text-[13px] font-semibold text-slate-700 dark:text-slate-200">Batch #{r.inventoryBatchId}</div>
                      <div className="text-[11.5px] flex items-center gap-1.5" style={{ color: near ? '#B45309' : '#9AA1AD', fontWeight: near ? 600 : 500 }}>{batch.expiryDate ? `Exp ${new Date(batch.expiryDate).toLocaleDateString()}` : 'No expiry'}{near && <span className="text-amber-600 font-bold">{expBadge}</span>}</div>
                    </> : <span className="text-slate-300">—</span>}
                  </div>
                  <div className="text-right">
                    <span className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[13.5px] font-bold" style={{ color: isIn ? '#0F8A4F' : '#DC2626', background: isIn ? '#E6F6EE' : '#FCE9E9' }}>{isIn ? <LuArrowUp className="w-3 h-3" /> : <LuArrowDown className="w-3 h-3" />}{isIn ? '+' : '−'}{fmtNum(Math.abs(Number(r.qtyDelta ?? 0)))} {uc}</span>
                  </div>
                  <div className="pl-3">
                    {rm.path
                      ? <button onClick={() => navigate(rm.path as string)} className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md text-[12.5px] font-bold font-mono text-red-600 bg-red-50 hover:bg-red-100">{rm.label}<LuExternalLink className="w-3 h-3" /></button>
                      : <span className="text-[12.5px] font-mono text-slate-400">{rm.label}</span>}
                  </div>
                  <div className="flex items-center gap-2 min-w-0"><span className="w-6 h-6 rounded-full bg-slate-800 text-white flex items-center justify-center text-[11px] font-bold flex-none uppercase">{(by[0] ?? '?')}</span><span className="text-[12.5px] text-slate-500 dark:text-slate-400 truncate">{by}</span></div>
                </div>
              );
            })}

            <div className="flex items-center justify-between px-4 py-3.5 text-[13px] text-slate-500 flex-wrap gap-3">
              <span>Showing <strong className="text-slate-700 dark:text-slate-200">{pageRows.length}</strong> of {filtered.length} rows · Page {safePage}/{totalPages}</span>
              <div className="flex gap-1.5">
                <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700">Prev</button>
                <button disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} className="px-3.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700">Next</button>
              </div>
            </div>
          </div>
        )}
      </div>
      {capped && <div className="text-xs text-amber-600 -mt-2">Showing the latest {fmtNum(allRows.length)} of {fmtNum(serverTotal)} movements — the cards and counts above cover only this subset. Narrow the date range to include the rest.</div>}
    </div>
  );
};

export default StockLedger;
