import React, { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  LuRefreshCw,
  LuBox,
  LuDatabase,
  LuTriangleAlert,
  LuCircleX,
  LuCalendar,
  LuSearch,
} from 'react-icons/lu';
import Loader from '../../../components/Loader';
import Modal from '../../../components/Modal';
import apiClient from '../../../utils/apiClient';
import { inventoryService } from '../../../services/api/inventoryService';

const EVENT_LABEL: Record<string, string> = {
  receive: 'Received (GRN)',
  consume: 'Sold / consumed',
  consume_shortfall: 'Sold — no stock',
  consume_reversal: 'Order reversed',
  transfer_order: 'Dispatched out',
  transfer_receipt: 'Transferred in',
  waste: 'Wastage',
  adjustment_in: 'Adjustment in',
  adjustment_out: 'Adjustment out',
};

const BRAND_COLORS = ['#16A34A', '#7C3AED', '#EA580C', '#2563EB', '#DB2777', '#0891B2', '#CA8A04', '#4F46E5'];
const POOL_COLOR = '#64748B';
const tint = (hex: string) => `${hex}1F`; // ~12% alpha background

const STATUS: Record<string, { label: string; sub: string; color: string; bg: string }> = {
  in: { label: 'In stock', sub: 'Well stocked', color: '#16A34A', bg: '#E9F8F0' },
  low: { label: 'Low stock', sub: 'Reorder soon', color: '#D97706', bg: '#FCEFD9' },
  out: { label: 'Out of stock', sub: 'Restock required', color: '#DC2626', bg: '#FCE9E9' },
};

const card = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl';

const rowItemKey = (r: any) => Number(r.inventoryItemId ?? r.inventory_item_id);
const rowBrand = (r: any) => { const b = r.brandId ?? r.brand_id ?? null; return b == null ? null : Number(b); };

const OnHandInventory: React.FC = () => {
  const [branchId, setBranchId] = useState<number | null>(null);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [refreshing, setRefreshing] = useState(false);
  const [historyItemId, setHistoryItemId] = useState<number | null>(null);
  const PAGE_SIZE = 10;

  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: async () => (await apiClient.get('/admin/branches')).data ?? [] });
  const brandsQ = useQuery({ queryKey: ['brands'], queryFn: async () => (await apiClient.get('/admin/brands')).data ?? [] });
  const itemsQ = useQuery({ queryKey: ['inventory-items'], queryFn: inventoryService.listItems });
  const uomsQ = useQuery({ queryKey: ['inventory-uoms'], queryFn: inventoryService.listUoms });

  const branches = branchesQ.data ?? [];
  // Default to the first branch once loaded.
  const activeBranchId = branchId ?? (branches[0]?.id ?? null);

  // On-hand for every branch (used for the branch cards + the selected matrix).
  const onHandQs = useQueries({
    queries: branches.map((b: any) => ({
      queryKey: ['onhand', b.id],
      queryFn: () => inventoryService.getOnHand(b.id),
      enabled: branches.length > 0,
    })),
  });
  const onHandByBranch = useMemo(() => {
    const m = new Map<number, any[]>();
    branches.forEach((b: any, i: number) => m.set(Number(b.id), (onHandQs[i]?.data as any[]) ?? []));
    return m;
  }, [branches, onHandQs]);

  const lowStockQ = useQuery({ queryKey: ['low-stock', activeBranchId], queryFn: () => inventoryService.getLowStock(activeBranchId as number), enabled: activeBranchId != null });
  const nearExpiryQ = useQuery({ queryKey: ['near-expiry', activeBranchId], queryFn: () => inventoryService.getNearExpiry(activeBranchId as number), enabled: activeBranchId != null });

  const itemById = useMemo(() => { const m = new Map<number, any>(); for (const it of itemsQ.data ?? []) m.set(Number(it.id), it); return m; }, [itemsQ.data]);
  const uomById = useMemo(() => { const m = new Map<number, any>(); for (const u of uomsQ.data ?? []) m.set(Number(u.id), u); return m; }, [uomsQ.data]);
  const lowStockIds = useMemo(() => new Set((lowStockQ.data ?? []).map((r: any) => Number(r.inventory_item_id ?? r.inventoryItemId ?? r.id))), [lowStockQ.data]);
  const brandNameById = useMemo(() => { const m = new Map<number, string>(); for (const b of brandsQ.data ?? []) m.set(Number(b.id), b.name); return m; }, [brandsQ.data]);

  // History (stock-movement ledger) for one item at the selected branch.
  const historyQ = useQuery({
    queryKey: ['onhand-history', activeBranchId, historyItemId],
    queryFn: () => inventoryService.getLedger(activeBranchId as number, { inventory_item_id: historyItemId as number, page_size: 100 }),
    enabled: activeBranchId != null && historyItemId != null,
  });
  const historyRows: any[] = historyQ.data?.items ?? [];
  // One transfer/sale can touch several batches (FEFO splits per batch), producing
  // multiple ledger rows. Roll them up into one line per operation (event + reference
  // + bucket), summing the change, so a "3 pcs transfer" reads as one +3 row.
  const historyGroups = useMemo(() => {
    const groups = new Map<string, any>();
    for (const e of historyRows) {
      const eventType = e.eventType ?? e.event_type;
      const eventRefType = e.eventRefType ?? e.event_ref_type;
      const eventRefId = e.eventRefId ?? e.event_ref_id;
      const brandId = e.brandId ?? e.brand_id ?? null;
      const delta = Number(e.qtyDelta ?? e.qty_delta ?? 0);
      const key = eventRefId != null ? `${eventType}|${eventRefType}|${eventRefId}|${brandId ?? 'pool'}` : `id:${e.id}`;
      const g = groups.get(key);
      if (g) {
        g.qtyDelta += delta;
        g.batches += 1;
        if (new Date(e.createdAt).getTime() > new Date(g.createdAt).getTime()) g.createdAt = e.createdAt;
      } else {
        groups.set(key, { id: e.id, createdAt: e.createdAt, eventType, eventRefType, eventRefId, brandId, qtyDelta: delta, batches: 1 });
      }
    }
    return Array.from(groups.values()).sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }, [historyRows]);

  const unitCode = (itemId: number) => uomById.get(Number(itemById.get(itemId)?.baseUomId))?.code ?? '';

  // Columns = Branch pool + the brands LINKED to the selected branch (plus any brand
  // that actually holds stock here, so nothing is hidden). Colour is stable per brand.
  const columns = useMemo(() => {
    const activeBranch = branches.find((b: any) => Number(b.id) === Number(activeBranchId));
    const show = new Set<number>(((activeBranch?.brand_ids ?? []) as any[]).map((x) => Number(x)));
    const onHand = activeBranchId != null ? (onHandByBranch.get(activeBranchId) ?? []) : [];
    for (const r of onHand) { const br = rowBrand(r); if (br != null && Number(r.qty ?? 0) !== 0) show.add(br); }
    const brandCols = (brandsQ.data ?? [])
      .map((b: any, idx: number) => ({ b, idx }))
      .filter(({ b }: any) => show.has(Number(b.id)))
      .map(({ b, idx }: any) => ({ key: String(b.id), brandId: Number(b.id), name: b.name, color: BRAND_COLORS[idx % BRAND_COLORS.length] }));
    return [{ key: 'pool', brandId: null as number | null, name: 'Branch pool', color: POOL_COLOR }, ...brandCols];
  }, [brandsQ.data, branches, activeBranchId, onHandByBranch]);

  // Aggregate the selected branch's on-hand into per-item buckets.
  const rows = useMemo(() => {
    const onHand = activeBranchId != null ? (onHandByBranch.get(activeBranchId) ?? []) : [];
    const byItem = new Map<number, { itemId: number; cells: Map<string, number>; total: number; anyNeg: boolean }>();
    for (const r of onHand) {
      const itemId = rowItemKey(r);
      if (!Number.isInteger(itemId) || itemId <= 0) continue;
      const colKey = rowBrand(r) == null ? 'pool' : String(rowBrand(r));
      const qty = Number(r.qty ?? 0);
      let e = byItem.get(itemId);
      if (!e) { e = { itemId, cells: new Map(), total: 0, anyNeg: false }; byItem.set(itemId, e); }
      e.cells.set(colKey, (e.cells.get(colKey) ?? 0) + qty);
      e.total += qty;
      if (qty < 0) e.anyNeg = true;
    }
    return Array.from(byItem.values())
      .filter((e) => Array.from(e.cells.values()).some((v) => v !== 0))
      .map((e) => {
        const status = e.total <= 0 ? 'out' : lowStockIds.has(e.itemId) ? 'low' : 'in';
        return { ...e, status };
      })
      .sort((a, b) => (itemById.get(a.itemId)?.name ?? '').localeCompare(itemById.get(b.itemId)?.name ?? ''));
  }, [activeBranchId, onHandByBranch, lowStockIds, itemById]);

  const filteredRows = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => { const it = itemById.get(r.itemId); return String(it?.name ?? '').toLowerCase().includes(q) || String(it?.code ?? '').toLowerCase().includes(q); });
  }, [rows, search, itemById]);

  const totalPages = Math.max(1, Math.ceil(filteredRows.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filteredRows.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  const stats = useMemo(() => {
    const onHand = activeBranchId != null ? (onHandByBranch.get(activeBranchId) ?? []) : [];
    const totalStock = onHand.reduce((s: number, r: any) => s + Number(r.qty ?? 0), 0);
    // Derive low/out from the SAME per-item statuses as the matrix so the cards
    // always agree with it. (The backend low-stock list also includes out-of-stock
    // items, which would otherwise double-count them as "low".)
    return {
      totalItems: (itemsQ.data ?? []).length,
      totalStock,
      lowStock: rows.filter((r) => r.status === 'low').length,
      outOfStock: rows.filter((r) => r.status === 'out').length,
      expiringSoon: (nearExpiryQ.data ?? []).length,
    };
  }, [activeBranchId, onHandByBranch, rows, itemsQ.data, nearExpiryQ.data]);

  const branchSummary = (b: any) => {
    const rs = onHandByBranch.get(Number(b.id)) ?? [];
    const items = new Set(rs.filter((r: any) => Number(r.qty ?? 0) !== 0).map((r: any) => rowItemKey(r))).size;
    const stock = rs.reduce((s: number, r: any) => s + Number(r.qty ?? 0), 0);
    return { items, stock };
  };

  const fmtNum = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

  const refresh = async () => {
    setRefreshing(true);
    try {
      await Promise.all([
        branchesQ.refetch(), brandsQ.refetch(), itemsQ.refetch(), uomsQ.refetch(),
        lowStockQ.refetch(), nearExpiryQ.refetch(),
        ...onHandQs.map((q) => q.refetch()),
      ]);
      toast.success('Inventory refreshed');
    } finally {
      setRefreshing(false);
    }
  };

  const gridTemplate = `minmax(200px,2.2fr) repeat(${columns.length}, minmax(82px,1fr)) minmax(90px,1fr) 150px 96px`;

  const StatCard = ({ Icon, iconColor, iconBg, label, value, sub }: any) => (
    <div className={`${card} p-4`}>
      <div className="flex items-center gap-3">
        <span className="w-10 h-10 rounded-lg flex items-center justify-center" style={{ background: iconBg, color: iconColor }}><Icon className="w-5 h-5" /></span>
        <span className="text-[13px] font-semibold text-slate-500 dark:text-slate-400">{label}</span>
      </div>
      <div className="text-[28px] font-bold text-slate-900 dark:text-slate-100 mt-3 leading-none">{value}</div>
      <div className="text-xs text-slate-400 dark:text-slate-500 mt-1.5">{sub}</div>
    </div>
  );

  const loading = branchesQ.isLoading || (activeBranchId != null && onHandQs.some((q) => q.isLoading));

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-[26px] font-bold text-slate-900 dark:text-slate-100">Inventory</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5">Track on-hand stock as it flows from the branch into each brand.</p>
        </div>
        <button onClick={refresh} disabled={refreshing} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2.5 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-60">
          <LuRefreshCw className={`w-4 h-4 ${refreshing ? 'animate-spin' : ''}`} /> Refresh
        </button>
      </div>

      {/* stat cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-5 gap-4">
        <StatCard Icon={LuBox} iconColor="#3B82F6" iconBg="#EAF1FE" label="Total items" value={stats.totalItems} sub="Active inventory items" />
        <StatCard Icon={LuDatabase} iconColor="#16A34A" iconBg="#E9F8F0" label="Total stock" value={fmtNum(stats.totalStock)} sub="Across all brand buckets" />
        <StatCard Icon={LuTriangleAlert} iconColor="#D97706" iconBg="#FCEFD9" label="Low stock items" value={stats.lowStock} sub="Reorder recommended" />
        <StatCard Icon={LuCircleX} iconColor="#DC2626" iconBg="#FCE9E9" label="Out of stock" value={stats.outOfStock} sub="Currently unavailable" />
        <StatCard Icon={LuCalendar} iconColor="#8B5CF6" iconBg="#F3ECFD" label="Expiring soon" value={stats.expiringSoon} sub="Within 7 days" />
      </div>

      {/* branch selector */}
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2.5">Branches · select one to view its stock</div>
        <div className="flex flex-wrap gap-3.5">
          {branches.map((b: any) => {
            const active = Number(b.id) === Number(activeBranchId);
            const sum = branchSummary(b);
            return (
              <button key={b.id} onClick={() => { setBranchId(Number(b.id)); setPage(1); }}
                className={`flex-1 min-w-[240px] max-w-[360px] text-left rounded-xl px-4 py-4 border-[1.5px] transition ${active ? 'border-red-500 bg-red-50 dark:bg-red-900/15' : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-slate-300'}`}>
                <div className="flex items-center justify-between">
                  <span className="text-[15px] font-bold text-slate-900 dark:text-slate-100">{b.name}</span>
                  <span className={`text-xs font-semibold ${active ? 'text-red-600' : 'text-slate-400'}`}>{b.code}</span>
                </div>
                <div className="flex items-end justify-between mt-3.5">
                  <div><div className="text-xl font-bold text-slate-900 dark:text-slate-100">{fmtNum(sum.stock)}</div><div className="text-[11.5px] text-slate-500">Total Stock</div></div>
                  <div className="text-right"><div className="text-xl font-bold text-slate-900 dark:text-slate-100">{sum.items}</div><div className="text-[11.5px] text-slate-500">Items</div></div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* info banner */}
      <div className="flex items-start gap-3 rounded-lg bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 px-4 py-3 text-[13.5px] text-blue-900/80 dark:text-blue-200 leading-relaxed">
        <span className="w-[18px] h-[18px] flex-none rounded-full bg-blue-500 text-white flex items-center justify-center text-[11px] font-bold mt-0.5">i</span>
        <span>Stock is received into the <strong>Branch pool</strong> → transferred to a <strong>brand bucket</strong> → consumed by that brand’s orders. Below shows exactly what each brand currently holds at the selected branch.</span>
      </div>

      {/* allocation matrix */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex items-center justify-between gap-4 px-4 py-4 border-b border-slate-100 dark:border-slate-700">
          <div className="relative flex-1 max-w-[420px]">
            <LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search by item name or code…"
              className="w-full pl-9 pr-3 py-2.5 border border-slate-200 dark:border-slate-700 rounded-lg text-[13.5px] bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30" />
          </div>
          <div className="text-[13px] text-slate-400 dark:text-slate-500 hidden md:block">Each column = a brand bucket. Read across a row to see who holds what.</div>
        </div>

        {loading ? <div className="p-10"><Loader /></div> : (
          <div className="overflow-x-auto">
            {/* header row */}
            <div className="grid items-end px-4 py-3.5 border-b border-slate-100 dark:border-slate-700 bg-slate-50/70 dark:bg-slate-900/40 min-w-[760px]" style={{ gridTemplateColumns: gridTemplate }}>
              <div className="text-[12px] font-semibold uppercase tracking-wide text-slate-400">Item</div>
              {columns.map((c) => {
                const n = rows.filter((r) => (r.cells.get(c.key) ?? 0) !== 0).length;
                return (
                  <div key={c.key} className="text-right">
                    <div className="flex items-center justify-end gap-1.5 text-[12.5px] font-bold text-slate-900 dark:text-slate-100"><span className="w-2 h-2 rounded-full" style={{ background: c.color }} />{c.name}</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">{n} {n === 1 ? 'item' : 'items'}</div>
                  </div>
                );
              })}
              <div className="text-right pr-2 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Total</div>
              <div className="pl-3 text-[12px] font-semibold uppercase tracking-wide text-slate-400">Status</div>
              <div />
            </div>

            {/* item rows */}
            {pageRows.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-400">{activeBranchId == null ? 'Select a branch.' : 'No stock found at this branch.'}</div>
            ) : pageRows.map((r) => {
              const it = itemById.get(r.itemId);
              const uc = unitCode(r.itemId);
              const st = STATUS[r.status];
              return (
                <div key={r.itemId} className="grid items-center px-4 py-2.5 border-b border-slate-100 dark:border-slate-700 hover:bg-slate-50/70 dark:hover:bg-slate-700/30 min-w-[760px]" style={{ gridTemplateColumns: gridTemplate }}>
                  <div className="flex items-center gap-3">
                    <div className="w-[34px] h-[34px] rounded-lg bg-slate-100 dark:bg-slate-700 flex items-center justify-center text-sm font-bold text-slate-500 dark:text-slate-300 flex-none uppercase">{(it?.name ?? '?')[0]}</div>
                    <div className="min-w-0"><div className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">{it?.name ?? `Item #${r.itemId}`}</div><div className="text-[11.5px] text-slate-400 truncate">{it?.code ?? ''}</div></div>
                  </div>
                  {columns.map((c) => {
                    const v = r.cells.get(c.key) ?? 0;
                    if (v === 0) return <div key={c.key} className="ml-2 text-right px-2.5 py-1.5 text-[13.5px] text-slate-300 dark:text-slate-600">—</div>;
                    const neg = v < 0;
                    const bg = neg ? '#FCE9E9' : c.key === 'pool' ? '#F4F6F8' : tint(c.color);
                    return <div key={c.key} className="ml-2 text-right px-2.5 py-1.5 rounded-lg text-[13.5px] font-semibold" style={{ background: bg, color: neg ? '#DC2626' : '#1F2430' }}>{fmtNum(v)} {uc}</div>;
                  })}
                  <div className="text-right text-sm font-bold pl-2.5" style={{ color: r.total < 0 ? '#DC2626' : undefined }}>{fmtNum(r.total)} {uc}</div>
                  <div className="pl-2.5">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ color: st.color, background: st.bg }}>{st.label}</span>
                    <div className="text-[11px] text-slate-400 mt-0.5">{st.sub}</div>
                  </div>
                  <div className="text-right"><button onClick={() => setHistoryItemId(r.itemId)} className="rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">History</button></div>
                </div>
              );
            })}

            {/* footer */}
            <div className="flex items-center justify-between px-4 py-3.5 text-[13px] text-slate-500 dark:text-slate-400">
              <span>{filteredRows.length === 0 ? 'No items' : `Showing ${(safePage - 1) * PAGE_SIZE + 1}–${Math.min(safePage * PAGE_SIZE, filteredRows.length)} of ${filteredRows.length} items`}</span>
              <div className="flex items-center gap-1.5">
                <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-md disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700">‹</button>
                {Array.from({ length: totalPages }, (_, i) => i + 1).slice(0, 5).map((p) => (
                  <button key={p} onClick={() => setPage(p)} className={`px-3 py-1.5 rounded-md font-semibold ${p === safePage ? 'bg-red-600 text-white' : 'border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'}`}>{p}</button>
                ))}
                <button disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-md disabled:opacity-40 hover:bg-slate-50 dark:hover:bg-slate-700">›</button>
              </div>
              <span>{PAGE_SIZE} per page</span>
            </div>
          </div>
        )}
      </div>

      {/* History (stock-movement ledger) modal */}
      <Modal isOpen={historyItemId != null} onClose={() => setHistoryItemId(null)} title={historyItemId != null ? `Stock history — ${itemById.get(historyItemId)?.name ?? `Item #${historyItemId}`}` : ''} size="large">
        <div className="space-y-3">
          <div className="text-xs text-slate-500 dark:text-slate-400">
            Every increase/decrease at <span className="font-medium">{branches.find((b: any) => Number(b.id) === Number(activeBranchId))?.name ?? 'this branch'}</span> — receipts, transfers, sales, wastage and adjustments.
          </div>
          {historyQ.isLoading ? <Loader /> : historyGroups.length === 0 ? (
            <div className="py-8 text-center text-slate-400">No movements recorded yet.</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-slate-500 dark:text-slate-400 sticky top-0">
                  <tr>
                    <th className="py-2 px-3 font-medium">Date</th>
                    <th className="py-2 px-3 font-medium">Movement</th>
                    <th className="py-2 px-3 font-medium">Brand bucket</th>
                    <th className="py-2 px-3 font-medium text-right">Change</th>
                    <th className="py-2 px-3 font-medium">Reference</th>
                  </tr>
                </thead>
                <tbody className="text-slate-700 dark:text-slate-200">
                  {historyGroups.map((e: any) => {
                    const delta = Number(e.qtyDelta ?? 0);
                    const bId = e.brandId ?? null;
                    const uc = unitCode(historyItemId as number);
                    return (
                      <tr key={e.id} className="border-t border-slate-100 dark:border-slate-700">
                        <td className="py-2 px-3 whitespace-nowrap text-slate-500 dark:text-slate-400">{e.createdAt ? new Date(e.createdAt).toLocaleString() : '—'}</td>
                        <td className="py-2 px-3">
                          {EVENT_LABEL[e.eventType] ?? e.eventType}
                          {e.batches > 1 && <span className="text-slate-400"> · {e.batches} batches</span>}
                        </td>
                        <td className="py-2 px-3">{bId == null ? <span className="text-slate-400">Branch pool</span> : (brandNameById.get(Number(bId)) ?? `Brand #${bId}`)}</td>
                        <td className={`py-2 px-3 text-right font-semibold ${delta < 0 ? 'text-red-600' : 'text-green-600'}`}>{delta > 0 ? '+' : ''}{fmtNum(delta)} {uc}</td>
                        <td className="py-2 px-3 text-slate-500 dark:text-slate-400">{e.eventRefType ? `${e.eventRefType} #${e.eventRefId ?? ''}` : '—'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </Modal>
    </div>
  );
};

export default OnHandInventory;
