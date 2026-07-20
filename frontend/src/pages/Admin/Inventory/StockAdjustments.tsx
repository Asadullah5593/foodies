import React, { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { LuArrowUp, LuArrowDown, LuArrowDownUp, LuCheck, LuPlus, LuSearch, LuPencil, LuTrash2 } from 'react-icons/lu';
import Modal from '../../../components/Modal';
import Loader from '../../../components/Loader';
import SearchableSelect from '../../../components/SearchableSelect';
import apiClient from '../../../utils/apiClient';
import { inventoryService } from '../../../services/api/inventoryService';
import { useHasPermission } from '../../../hooks/useHasPermission';

const card = 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl';
const field = 'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400';

const prettyReason = (r: string) => {
  const s = String(r ?? '').trim();
  if (!s || s === 'multiple') return s === 'multiple' ? 'Multiple' : '—';
  const spaced = s.replace(/_/g, ' ');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
};

const fmtNum = (n: number) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });

const StockAdjustments: React.FC = () => {
  const queryClient = useQueryClient();
  const canAdjust = useHasPermission('inventory:adjust');
  const [branchId, setBranchId] = useState<number | null>(null);
  const [status, setStatus] = useState<'all' | 'draft' | 'posted'>('all');
  const [typeFilter, setTypeFilter] = useState<'all' | 'in' | 'out' | 'in+out'>('all');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const PAGE_SIZE = 10;

  const [modalOpen, setModalOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<any | null>(null);
  const [viewGroup, setViewGroup] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  // create/edit form
  const [f, setF] = useState<any>({ type: 'out', reason: 'manual_correction', item: '', qty: '', uom: '', lot: '', expiry: '', lines: [] as any[] });

  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: async () => (await apiClient.get('/admin/branches')).data ?? [] });
  const branches = branchesQ.data ?? [];
  const activeBranchId = branchId ?? (branches[0]?.id ?? null);

  const itemsQ = useQuery({ queryKey: ['inventory-items'], queryFn: inventoryService.listItems });
  const uomsQ = useQuery({ queryKey: ['inventory-uoms'], queryFn: inventoryService.listUoms });
  const adjustmentsQ = useQuery({ queryKey: ['inventory-adjustments', activeBranchId], queryFn: () => inventoryService.listAdjustments(activeBranchId as number), enabled: activeBranchId != null });

  const itemById = useMemo(() => { const m = new Map<number, any>(); for (const it of itemsQ.data ?? []) m.set(Number(it.id), it); return m; }, [itemsQ.data]);
  const uomById = useMemo(() => { const m = new Map<number, any>(); for (const u of uomsQ.data ?? []) m.set(Number(u.id), u); return m; }, [uomsQ.data]);
  const itemOptions = useMemo(() => (itemsQ.data ?? []).map((it: any) => ({ value: String(it.id), label: it.name })), [itemsQ.data]);
  const selectedFormItem = itemById.get(Number(f.item));

  const invalidate = async () => {
    await queryClient.invalidateQueries({ queryKey: ['inventory-adjustments', activeBranchId] });
    await queryClient.invalidateQueries({ queryKey: ['onhand'] });
    await queryClient.invalidateQueries({ queryKey: ['onhand-history'] });
  };

  // --- UOM conversion helpers (ported) ---
  const uomToRoot = (uomIdRaw: any): number | null => {
    let current = Number(uomIdRaw); let multiplier = 1;
    if (!Number.isInteger(current) || current <= 0) return null;
    for (let hop = 0; hop < 8; hop += 1) {
      const u = uomById.get(current);
      if (!u) return null;
      const baseId = u.baseUomId != null ? Number(u.baseUomId) : null;
      const step = u.multiplierToBase != null ? Number(u.multiplierToBase) : null;
      if (baseId == null || step == null || !(baseId > 0) || !(step > 0)) return multiplier;
      multiplier *= step; current = baseId;
    }
    return null;
  };
  const toItemBase = (line: any, item: any): number | null => {
    const qty = Number(line?.qty ?? 0);
    const from = Number(line?.qtyUomId ?? line?.qty_uom_id);
    const to = Number(item?.baseUomId);
    if (!Number.isFinite(qty) || !Number.isInteger(from) || !Number.isInteger(to)) return null;
    if (from === to) return qty;
    const fr = uomToRoot(from), tr = uomToRoot(to);
    if (fr == null || tr == null || tr === 0) return null;
    return qty * (fr / tr);
  };
  const getItemAllowedUoms = (item: any) => {
    if (!item) return uomsQ.data ?? [];
    const ids = (Array.isArray(item.baseUomIds) && item.baseUomIds.length ? item.baseUomIds : [item.baseUomId]).map((x: any) => Number(x)).filter((x: number) => x > 0);
    if (item.baseUomId && !ids.includes(Number(item.baseUomId))) ids.unshift(Number(item.baseUomId));
    const opts = ids.map((id: number) => uomById.get(id)).filter(Boolean);
    return opts.length ? opts : (uomsQ.data ?? []);
  };
  const defaultUom = (item: any) => { const o = getItemAllowedUoms(item); return o[0] ? String(o[0].id) : ''; };

  const extractRef = (notes: any): string | null => { const m = String(notes ?? '').match(/\[GROUP_REF:([A-Z0-9-]+)\]/i); return m?.[1] ? m[1].toUpperCase() : null; };
  const makeRef = () => `ADJGRP-${new Date().toISOString().replace(/\D/g, '').slice(0, 14)}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;

  // --- grouping ---
  const groups = useMemo(() => {
    const map = new Map<string, any>();
    for (const adj of adjustmentsQ.data ?? []) {
      const ref = extractRef(adj?.notes) ?? `ADJ-${adj.id}`;
      if (!map.has(ref)) map.set(ref, { reference: ref, adjustments: [], lines: [], createdAt: adj?.createdAt ?? null, status: String(adj?.status ?? 'draft'), reason: String(adj?.reasonCode ?? '—'), types: new Set<string>(), itemIds: new Set<number>(), totalQtyBase: 0 });
      const g = map.get(ref);
      g.adjustments.push(adj);
      g.types.add(String(adj?.adjustmentType ?? ''));
      if (!g.createdAt || (adj?.createdAt && new Date(adj.createdAt).getTime() > new Date(g.createdAt).getTime())) g.createdAt = adj.createdAt;
      if (String(adj?.status ?? '') !== 'posted') g.status = 'draft';
      if (String(g.reason) !== String(adj?.reasonCode ?? '')) g.reason = g.adjustments.length > 1 ? 'multiple' : String(adj?.reasonCode ?? '—');
      for (const line of adj?.lines ?? []) {
        const itemId = Number(line?.inventoryItemId);
        if (Number.isInteger(itemId) && itemId > 0) g.itemIds.add(itemId);
        const conv = toItemBase(line, itemById.get(itemId));
        g.totalQtyBase += Math.abs(conv != null ? conv : Number(line?.qty ?? 0));
        g.lines.push({ ...line, adjustmentType: String(adj?.adjustmentType ?? ''), parentAdjustmentId: Number(adj?.id) });
      }
    }
    return Array.from(map.values())
      .sort((a, b) => (b.createdAt ? new Date(b.createdAt).getTime() : 0) - (a.createdAt ? new Date(a.createdAt).getTime() : 0))
      .map((g) => ({ ...g, typeLabel: g.types.size > 1 ? 'in+out' : (Array.from(g.types)[0] ?? '—'), itemCount: g.itemIds.size }));
  }, [adjustmentsQ.data, itemById, uomById]); // eslint-disable-line react-hooks/exhaustive-deps

  const kpi = useMemo(() => {
    let inQty = 0, outQty = 0;
    for (const adj of adjustmentsQ.data ?? []) {
      if (String(adj?.status) !== 'posted') continue;
      let q = 0;
      for (const line of adj?.lines ?? []) { const conv = toItemBase(line, itemById.get(Number(line?.inventoryItemId))); q += Math.abs(conv != null ? conv : Number(line?.qty ?? 0)); }
      if (String(adj?.adjustmentType) === 'in') inQty += q; else if (String(adj?.adjustmentType) === 'out') outQty += q;
    }
    return { total: groups.length, drafts: groups.filter((g) => g.status === 'draft').length, inQty, outQty };
  }, [adjustmentsQ.data, groups, itemById, uomById]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let rows = groups;
    if (status !== 'all') rows = rows.filter((g) => g.status === status);
    if (typeFilter !== 'all') rows = rows.filter((g) => g.typeLabel === typeFilter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((g) => String(g.reference).toLowerCase().includes(q) || prettyReason(g.reason).toLowerCase().includes(q) || Array.from(g.itemIds as Set<number>).some((id) => String(itemById.get(Number(id))?.name ?? '').toLowerCase().includes(q)));
    return rows;
  }, [groups, status, typeFilter, search, itemById]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const pageRows = filtered.slice((safePage - 1) * PAGE_SIZE, safePage * PAGE_SIZE);

  // --- create / edit form actions ---
  const openCreate = () => { setEditingGroup(null); setF({ type: 'out', reason: 'manual_correction', item: '', qty: '', uom: '', lot: '', expiry: '', lines: [] }); setModalOpen(true); };
  const openEdit = (g: any) => {
    if (!(g.adjustments ?? []).every((a: any) => String(a?.status) === 'draft')) { toast.error('Only draft adjustments can be edited'); return; }
    setEditingGroup(g);
    setF({
      type: String(g?.lines?.[0]?.adjustmentType ?? 'out').toLowerCase() === 'in' ? 'in' : 'out',
      reason: String(g?.reason && g.reason !== 'multiple' ? g.reason : 'manual_correction'),
      item: '', qty: '', uom: '', lot: '', expiry: '',
      lines: (g?.lines ?? []).map((l: any) => ({ line_type: String(l.adjustmentType).toLowerCase() === 'in' ? 'in' : 'out', inventory_item_id: Number(l.inventoryItemId), qty: Number(l.qty), qty_uom_id: Number(l.qtyUomId ?? l.qty_uom_id), lot_code: l.lotCode ?? null, expiry_date: l.expiryDate ?? null })),
    });
    setModalOpen(true);
  };
  const addLine = () => {
    const t = f.type as 'in' | 'out';
    const itemId = Number(f.item), qty = Number(f.qty), uomId = Number(f.uom);
    if (!itemId || !uomId || !(qty > 0)) { toast.error('Select item, unit and quantity > 0'); return; }
    if (t === 'in' && !f.expiry) { toast.error('Expiry date is required for IN lines'); return; }
    setF((p: any) => ({ ...p, lines: [...p.lines, { line_type: t, inventory_item_id: itemId, qty, qty_uom_id: uomId, lot_code: t === 'in' && f.lot ? String(f.lot) : null, expiry_date: t === 'in' && f.expiry ? String(f.expiry) : null }], item: '', qty: '', uom: '', lot: '', expiry: '' }));
  };
  const removeLine = (i: number) => setF((p: any) => ({ ...p, lines: p.lines.filter((_: any, j: number) => j !== i) }));

  const buildPayloads = (refOverride?: string) => {
    if (!activeBranchId) { toast.error('Select a branch'); return null; }
    if (!f.lines.length) { toast.error('Add at least one line'); return null; }
    const ref = refOverride ?? makeRef();
    const notes = `[GROUP_REF:${ref}]`;
    const grouped: Record<'in' | 'out', any[]> = { in: [], out: [] };
    for (const l of f.lines) {
      const t = l.line_type === 'in' ? 'in' : 'out';
      // Re-validate here (not just at add-line) so legacy/edited IN lines without an
      // expiry for an expiry-tracked item are caught before the API bounces.
      if (t === 'in' && !l.expiry_date && itemById.get(Number(l.inventory_item_id))?.trackExpiry) {
        toast.error(`Expiry date is required for ${itemById.get(Number(l.inventory_item_id))?.name ?? 'an IN item'}`);
        return null;
      }
      grouped[t].push({ inventory_item_id: Number(l.inventory_item_id), qty: Number(l.qty), qty_uom_id: Number(l.qty_uom_id), lot_code: t === 'in' ? (l.lot_code ?? null) : null, expiry_date: t === 'in' ? (l.expiry_date ?? null) : null });
    }
    const payloads: any[] = [];
    if (grouped.out.length) payloads.push({ branch_id: activeBranchId, adjustment_type: 'out', reason_code: String(f.reason || 'manual_correction'), notes, lines: grouped.out });
    if (grouped.in.length) payloads.push({ branch_id: activeBranchId, adjustment_type: 'in', reason_code: String(f.reason || 'manual_correction'), notes, lines: grouped.in });
    return payloads;
  };

  const submitCreate = async (post: boolean) => {
    const payloads = buildPayloads();
    if (!payloads) return;
    setBusy(true);
    try {
      for (const p of payloads) {
        const created = await inventoryService.createAdjustment(p);
        if (post && created?.id) await inventoryService.postAdjustment(Number(created.id));
      }
      toast.success(post ? 'Adjustment posted and stock updated' : 'Adjustment saved as draft');
      await invalidate(); setModalOpen(false);
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to save adjustment'); }
    finally { setBusy(false); }
  };

  const submitEdit = async (post: boolean) => {
    if (!editingGroup) return;
    const ref = String(editingGroup.reference ?? '').trim();
    const payloads = buildPayloads(ref || undefined);
    if (!payloads) return;
    setBusy(true);
    try {
      const byType = new Map<string, any>(); for (const p of payloads) byType.set(p.adjustment_type, p);
      const draftByType = new Map<string, any>();
      for (const a of editingGroup.adjustments ?? []) { if (String(a?.status) !== 'draft') continue; draftByType.set(String(a?.adjustmentType).toLowerCase() === 'in' ? 'in' : 'out', a); }
      const touched: number[] = [];
      for (const [t, p] of byType.entries()) {
        const existing = draftByType.get(t);
        if (existing?.id) { await inventoryService.updateAdjustment(Number(existing.id), { reason_code: p.reason_code, notes: p.notes ?? null, lines: p.lines }); touched.push(Number(existing.id)); }
        else { const c = await inventoryService.createAdjustment(p); if (c?.id) touched.push(Number(c.id)); }
      }
      for (const [t, a] of draftByType.entries()) { if (!byType.has(t) && a?.id) await inventoryService.deleteAdjustment(Number(a.id)); }
      if (post) for (const id of touched) await inventoryService.postAdjustment(id);
      toast.success(post ? 'Adjustment updated and posted' : 'Draft updated');
      await invalidate(); setModalOpen(false); setEditingGroup(null);
    } catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to update adjustment'); }
    finally { setBusy(false); }
  };

  const postGroup = async (g: any) => {
    const ids = (g.adjustments ?? []).filter((a: any) => String(a?.status) === 'draft').map((a: any) => Number(a.id)).filter((id: number) => id > 0);
    if (!ids.length) return;
    setBusy(true);
    try { for (const id of ids) await inventoryService.postAdjustment(id); toast.success('Adjustment posted'); await invalidate(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to post'); }
    finally { setBusy(false); }
  };
  const deleteGroup = async (g: any) => {
    const ids = (g.adjustments ?? []).filter((a: any) => String(a?.status) === 'draft').map((a: any) => Number(a.id)).filter((id: number) => id > 0);
    if (!ids.length) return;
    setBusy(true);
    try { for (const id of ids) await inventoryService.deleteAdjustment(id); toast.success('Draft deleted'); await invalidate(); }
    catch (e: any) { toast.error(e?.response?.data?.message ?? 'Failed to delete'); }
    finally { setBusy(false); }
  };

  const TypeBadge = ({ t }: { t: string }) => {
    if (t === 'in') return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold" style={{ color: '#16A34A', background: '#E9F8F0' }}><LuArrowUp className="w-3 h-3" /> IN</span>;
    if (t === 'out') return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold" style={{ color: '#DC2626', background: '#FCE9E9' }}><LuArrowDown className="w-3 h-3" /> OUT</span>;
    if (t === 'in+out') return <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-bold" style={{ color: '#6D5BD0', background: '#EFEDFB' }}><LuArrowDownUp className="w-3 h-3" /> IN + OUT</span>;
    return <span className="text-slate-400">—</span>;
  };

  const Tab = ({ id, label, count }: any) => {
    const on = status === id;
    return <button onClick={() => { setStatus(id); setPage(1); }} className={`px-3.5 py-1.5 rounded-lg text-sm font-semibold flex items-center gap-2 ${on ? 'bg-white dark:bg-slate-700 shadow-sm text-slate-900 dark:text-slate-100' : 'text-slate-500 dark:text-slate-400'}`}>{label}<span className={`text-[11px] font-bold px-1.5 py-0.5 rounded-full ${on ? 'bg-red-100 text-red-600' : 'bg-slate-200 dark:bg-slate-600 text-slate-500 dark:text-slate-300'}`}>{count}</span></button>;
  };

  const loading = branchesQ.isLoading || adjustmentsQ.isLoading;

  return (
    <div className="space-y-5">
      {/* header */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-[12.5px] text-slate-400 font-medium mb-1.5"><span>Inventory</span><span className="text-slate-300">/</span><span className="text-slate-600 dark:text-slate-300 font-semibold">Adjustments</span></div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Stock Adjustments</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400 mt-1.5 max-w-xl leading-relaxed">Correct stock mismatches at this branch. <strong className="text-green-600">IN</strong> increases stock, <strong className="text-red-600">OUT</strong> decreases it. Drafts don&apos;t touch inventory until posted.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 w-2.5 h-2.5 rounded-full bg-red-500 pointer-events-none" />
            <select value={activeBranchId ?? ''} onChange={(e) => { setBranchId(Number(e.target.value)); setPage(1); }} className="appearance-none pl-7 pr-9 py-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-semibold text-slate-900 dark:text-slate-100 min-w-[210px]">
              {branches.map((b: any) => <option key={b.id} value={b.id}>{b.name} ({b.code})</option>)}
            </select>
          </div>
          {canAdjust && <button onClick={openCreate} className="inline-flex items-center gap-2 rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2.5 text-sm font-semibold shadow-sm"><LuPlus className="w-4 h-4" /> Create adjustment</button>}
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${card} p-4`}><div className="text-[13px] font-semibold text-slate-500">Total adjustments</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">{kpi.total}</div><div className="text-xs text-slate-400 mt-0.5">At this branch</div></div>
        <div className="bg-white dark:bg-slate-800 border border-amber-200 dark:border-amber-800 rounded-xl p-4"><div className="flex items-center gap-1.5 text-[13px] font-semibold text-amber-700 dark:text-amber-400"><span className="w-2 h-2 rounded-full bg-amber-500" />Drafts pending</div><div className="text-2xl font-bold text-amber-700 dark:text-amber-400 mt-2">{kpi.drafts}</div><div className="text-xs text-amber-600/70 mt-0.5">Need posting to apply</div></div>
        <div className={`${card} p-4`}><div className="flex items-center gap-1.5 text-[13px] font-semibold text-green-600"><LuArrowUp className="w-3.5 h-3.5" />Stock added (IN)</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">+{fmtNum(kpi.inQty)}</div><div className="text-xs text-slate-400 mt-0.5">Posted units</div></div>
        <div className={`${card} p-4`}><div className="flex items-center gap-1.5 text-[13px] font-semibold text-red-600"><LuArrowDown className="w-3.5 h-3.5" />Stock removed (OUT)</div><div className="text-2xl font-bold text-slate-900 dark:text-slate-100 mt-2">−{fmtNum(kpi.outQty)}</div><div className="text-xs text-slate-400 mt-0.5">Posted units</div></div>
      </div>

      {/* table */}
      <div className={`${card} overflow-hidden`}>
        <div className="flex flex-wrap items-center justify-between gap-4 px-4 py-3.5 border-b border-slate-100 dark:border-slate-700">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex bg-slate-100 dark:bg-slate-900/50 rounded-lg p-1 gap-1">
              <Tab id="all" label="All" count={groups.length} />
              <Tab id="draft" label="Drafts" count={kpi.drafts} />
              <Tab id="posted" label="Posted" count={groups.length - kpi.drafts} />
            </div>
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-slate-400 font-medium">Type</span>
              <div className="flex gap-1.5">
                {([['all', 'All'], ['in', 'IN'], ['out', 'OUT'], ['in+out', 'IN + OUT']] as [any, string][]).map(([k, lbl]) => (
                  <button key={k} onClick={() => { setTypeFilter(k); setPage(1); }} className={`px-3 py-1.5 rounded-lg text-[12.5px] font-semibold border ${typeFilter === k ? 'bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 border-slate-900 dark:border-slate-100' : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>{lbl}</button>
                ))}
              </div>
            </div>
          </div>
          <div className="relative flex-1 min-w-[240px] max-w-[360px]">
            <LuSearch className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} placeholder="Search reference, reason or item…" className={`${field} pl-9`} />
          </div>
        </div>

        {loading ? <div className="p-10"><Loader /></div> : (
          <div className="overflow-x-auto">
            <div className="grid items-center px-4 py-3 bg-slate-50/70 dark:bg-slate-900/40 border-b border-slate-100 dark:border-slate-700 text-[11.5px] font-bold uppercase tracking-wide text-slate-400 min-w-[920px]" style={{ gridTemplateColumns: '40px minmax(200px,1.7fr) 116px minmax(150px,1.3fr) 120px 64px 84px 150px 180px' }}>
              <div>#</div><div>Reference</div><div>Type</div><div>Reason</div><div>Status</div><div className="text-right">Items</div><div className="text-right pr-3">Qty</div><div className="pl-3">Created</div><div className="text-right">Actions</div>
            </div>
            {pageRows.length === 0 ? (
              <div className="px-4 py-12 text-center text-slate-400">No adjustments found.</div>
            ) : pageRows.map((g, i) => {
              const draft = g.status === 'draft';
              const d = g.createdAt ? new Date(g.createdAt) : null;
              return (
                <div key={g.reference} className="grid items-center px-4 py-3 border-b border-slate-100 dark:border-slate-700 min-w-[920px]" style={{ gridTemplateColumns: '40px minmax(200px,1.7fr) 116px minmax(150px,1.3fr) 120px 64px 84px 150px 180px', borderLeft: `3px solid ${draft ? '#D97706' : 'transparent'}` }}>
                  <div className="text-[13px] text-slate-400 font-semibold">{(safePage - 1) * PAGE_SIZE + i + 1}</div>
                  <div className="pr-3 min-w-0"><button onClick={() => setViewGroup(g)} className="text-[13px] font-bold text-red-600 hover:underline font-mono truncate block max-w-full text-left">{g.reference}</button></div>
                  <div><TypeBadge t={g.typeLabel} /></div>
                  <div className="text-[13.5px] text-slate-700 dark:text-slate-200 pr-3 truncate">{prettyReason(g.reason)}</div>
                  <div>
                    {draft
                      ? <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ color: '#B45309', background: '#FCF1DC' }}><span className="w-1.5 h-1.5 rounded-full bg-amber-500" />Draft</span>
                      : <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold" style={{ color: '#0F8A4F', background: '#E6F6EE' }}><span className="w-1.5 h-1.5 rounded-full bg-green-500" />Posted</span>}
                  </div>
                  <div className="text-right text-[13.5px] font-semibold text-slate-700 dark:text-slate-200">{g.itemCount}</div>
                  <div className="text-right pr-3 text-[13.5px] font-bold text-slate-900 dark:text-slate-100">{fmtNum(g.totalQtyBase)}</div>
                  <div className="text-[12.5px] text-slate-500 leading-tight pl-3">{d ? d.toLocaleDateString() : '—'}<br /><span className="text-slate-400">{d ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}</span></div>
                  <div className="flex gap-2 justify-end items-center">
                    <button onClick={() => setViewGroup(g)} className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700">View</button>
                    {draft ? (
                      <>
                        <button onClick={() => openEdit(g)} className="px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[12.5px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700"><LuPencil className="w-3.5 h-3.5" /></button>
                        {canAdjust && <button disabled={busy} onClick={() => postGroup(g)} className="px-3.5 py-1.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-[12.5px] font-bold disabled:opacity-50">Post</button>}
                      </>
                    ) : <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-[12.5px] font-semibold text-green-600"><LuCheck className="w-3.5 h-3.5" />Posted</span>}
                  </div>
                </div>
              );
            })}
            <div className="flex items-center justify-between px-4 py-3.5 text-[13px] text-slate-500">
              <span>Showing <strong className="text-slate-700 dark:text-slate-200">{pageRows.length}</strong> of {filtered.length} adjustments</span>
              <div className="flex items-center gap-1.5">
                <button disabled={safePage <= 1} onClick={() => setPage(safePage - 1)} className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-md disabled:opacity-40">‹</button>
                {Array.from({ length: totalPages }, (_, k) => k + 1).slice(0, 5).map((p) => <button key={p} onClick={() => setPage(p)} className={`px-3 py-1.5 rounded-md font-semibold ${p === safePage ? 'bg-red-600 text-white' : 'border border-slate-200 dark:border-slate-700'}`}>{p}</button>)}
                <button disabled={safePage >= totalPages} onClick={() => setPage(safePage + 1)} className="px-2.5 py-1.5 border border-slate-200 dark:border-slate-700 rounded-md disabled:opacity-40">›</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* create / edit modal */}
      <Modal isOpen={modalOpen} onClose={() => { setModalOpen(false); setEditingGroup(null); }} title={editingGroup ? 'Edit draft adjustment' : 'Create adjustment'} size="large">
        <div className="space-y-4">
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
            <div><div className="text-xs font-medium text-slate-500 mb-1">Line type</div>
              <SearchableSelect value={f.type} onChange={(v) => setF({ ...f, type: v })} options={[{ value: 'out', label: 'OUT — remove stock' }, { value: 'in', label: 'IN — add stock' }]} minWidth="w-full" className="w-full" /></div>
            <div className="lg:col-span-2"><div className="text-xs font-medium text-slate-500 mb-1">Item</div>
              <SearchableSelect value={String(f.item)} onChange={(v) => setF({ ...f, item: v, uom: defaultUom(itemById.get(Number(v))) })} options={itemOptions} placeholder="Select item…" searchPlaceholder="Search items…" minWidth="w-full" className="w-full" /></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Quantity</div><input className={field} value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value })} placeholder="e.g. 2" /></div>
            <div><div className="text-xs font-medium text-slate-500 mb-1">Unit</div>
              <SearchableSelect value={String(f.uom)} onChange={(v) => setF({ ...f, uom: v })} options={getItemAllowedUoms(selectedFormItem).map((u: any) => ({ value: String(u.id), label: u.code }))} placeholder="Unit…" minWidth="w-full" className="w-full" disabled={!selectedFormItem} /></div>
            <div className="grid grid-cols-2 gap-2">
              <div><div className="text-xs font-medium text-slate-500 mb-1">Lot {f.type === 'in' ? '(opt)' : '(IN only)'}</div><input className={field} value={f.lot} onChange={(e) => setF({ ...f, lot: e.target.value })} disabled={f.type !== 'in'} /></div>
              <div><div className="text-xs font-medium text-slate-500 mb-1">Expiry {f.type === 'in' ? '(req)' : '(IN only)'}</div><input type="date" className={field} value={f.expiry} onChange={(e) => setF({ ...f, expiry: e.target.value })} disabled={f.type !== 'in'} /></div>
            </div>
          </div>
          <button onClick={addLine} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">+ Add line</button>

          {f.lines.length > 0 && (
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-slate-500"><tr><th className="py-2 px-3 font-medium">Type</th><th className="py-2 px-3 font-medium">Item</th><th className="py-2 px-3 font-medium">Qty</th><th className="py-2 px-3 font-medium">Unit</th><th className="py-2 px-3 font-medium">Expiry</th><th className="py-2 px-3" /></tr></thead>
                <tbody>
                  {f.lines.map((l: any, i: number) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 px-3"><TypeBadge t={l.line_type} /></td>
                      <td className="py-2 px-3">{itemById.get(Number(l.inventory_item_id))?.name ?? `#${l.inventory_item_id}`}</td>
                      <td className="py-2 px-3">{l.qty}</td>
                      <td className="py-2 px-3">{uomById.get(Number(l.qty_uom_id))?.code ?? ''}</td>
                      <td className="py-2 px-3">{l.expiry_date || '—'}</td>
                      <td className="py-2 px-3 text-right"><button onClick={() => removeLine(i)} className="text-red-600 hover:text-red-700"><LuTrash2 className="w-4 h-4" /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div><div className="text-xs font-medium text-slate-500 mb-1">Reason</div><input className={field} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="e.g. Manual correction" /></div>

          <div className="flex justify-end gap-2 pt-1">
            <button onClick={() => { setModalOpen(false); setEditingGroup(null); }} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm">Cancel</button>
            <button disabled={busy} onClick={() => (editingGroup ? submitEdit(false) : submitCreate(false))} className="rounded-lg border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-50">Save as draft</button>
            <button disabled={busy} onClick={() => (editingGroup ? submitEdit(true) : submitCreate(true))} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold disabled:opacity-50">Save &amp; post</button>
          </div>
        </div>
      </Modal>

      {/* view modal */}
      <Modal isOpen={viewGroup != null} onClose={() => setViewGroup(null)} title={viewGroup ? viewGroup.reference : ''} size="large">
        {viewGroup && (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div><div className="text-xs text-slate-500">Type</div><div className="mt-1"><TypeBadge t={viewGroup.typeLabel} /></div></div>
              <div><div className="text-xs text-slate-500">Status</div><div className="font-medium capitalize">{viewGroup.status}</div></div>
              <div><div className="text-xs text-slate-500">Reason</div><div className="font-medium">{prettyReason(viewGroup.reason)}</div></div>
              <div><div className="text-xs text-slate-500">Created</div><div>{viewGroup.createdAt ? new Date(viewGroup.createdAt).toLocaleString() : '—'}</div></div>
            </div>
            <div className="rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
              <table className="min-w-full text-sm">
                <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-slate-500"><tr><th className="py-2 px-3 font-medium">Type</th><th className="py-2 px-3 font-medium">Item</th><th className="py-2 px-3 font-medium">Qty</th><th className="py-2 px-3 font-medium">Unit</th></tr></thead>
                <tbody>
                  {(viewGroup.lines ?? []).map((l: any, i: number) => (
                    <tr key={i} className="border-t border-slate-100 dark:border-slate-700">
                      <td className="py-2 px-3"><TypeBadge t={String(l.adjustmentType).toLowerCase()} /></td>
                      <td className="py-2 px-3">{itemById.get(Number(l.inventoryItemId))?.name ?? `#${l.inventoryItemId}`}</td>
                      <td className="py-2 px-3">{Number(l.qty)}</td>
                      <td className="py-2 px-3">{uomById.get(Number(l.qtyUomId ?? l.qty_uom_id))?.code ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {viewGroup.status === 'draft' && (
              <div className="flex justify-end gap-2">
                <button onClick={() => { const g = viewGroup; setViewGroup(null); deleteGroup(g); }} className="rounded-lg border border-red-200 text-red-600 px-4 py-2 text-sm font-medium hover:bg-red-50">Delete draft</button>
                <button onClick={() => { const g = viewGroup; setViewGroup(null); openEdit(g); }} className="rounded-lg border border-slate-200 dark:border-slate-700 px-4 py-2 text-sm font-medium">Edit</button>
                <button onClick={() => { const g = viewGroup; setViewGroup(null); postGroup(g); }} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-semibold">Post</button>
              </div>
            )}
          </div>
        )}
      </Modal>
    </div>
  );
};

export default StockAdjustments;
