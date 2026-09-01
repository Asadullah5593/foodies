import React, { useEffect, useMemo, useState } from 'react';
import { isEntityInactive } from '../../../utils/entityStatus';
import { useMutation, useQuery, useQueryClient, keepPreviousData } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import {
  LuConciergeBell,
  LuCirclePlus,
  LuSlidersHorizontal,
  LuInfo,
  LuSoup,
  LuLock,
  LuArrowLeft,
} from 'react-icons/lu';
import Loader from '../../../components/Loader';
import SearchableSelect from '../../../components/SearchableSelect';
import FetchingOverlay from '../../../components/FetchingOverlay';
import apiClient from '../../../utils/apiClient';
import { recipesService } from '../../../services/api/recipesService';
import { inventoryService } from '../../../services/api/inventoryService';
import { useHasPermission } from '../../../hooks/useHasPermission';
import { useResultsRefreshing } from '../../../components/useResultsRefreshing';

export type RecipesTabKey = 'manage' | 'costing';
type TargetType = 'dish' | 'addon' | 'modifier';

const card = 'bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 shadow-sm';
const field = 'w-full border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 bg-white dark:bg-slate-800 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-red-500/30 focus:border-red-400';

const Recipes: React.FC<{ initialTab?: RecipesTabKey; showTabs?: boolean }> = ({
  initialTab = 'manage',
  showTabs = true,
}) => {
  const queryClient = useQueryClient();
  const canCreate = useHasPermission('recipes:create');
  const canEditRecipe = useHasPermission('recipes:edit');
  const canActivate = useHasPermission('recipes:activate');
  const [tab, setTab] = useState<RecipesTabKey>(initialTab);

  const [targetType, setTargetType] = useState<TargetType>('dish');
  const [selItem, setSelItem] = useState<string>('');
  const [selVariant, setSelVariant] = useState<string>('');
  const [selBrand, setSelBrand] = useState<string>('');
  const [selAddon, setSelAddon] = useState<string>('');
  const [selModifier, setSelModifier] = useState<string>('');
  const [lineItem, setLineItem] = useState<string>('');
  const [lineQty, setLineQty] = useState<string>('');
  const [lineUom, setLineUom] = useState<string>('');
  const [lineWastage, setLineWastage] = useState<string>('');
  const [costBranch, setCostBranch] = useState<string>('');

  const branchesQ = useQuery({ queryKey: ['branches'], queryFn: async () => (await apiClient.get('/admin/branches')).data ?? [] });
  const brandsQ = useQuery({ queryKey: ['brands'], queryFn: async () => (await apiClient.get('/admin/brands')).data ?? [] });
  const menuItemsQ = useQuery({ queryKey: ['menu-items'], queryFn: async () => (await apiClient.get('/admin/menu/items')).data ?? [] });
  const itemsQ = useQuery({ queryKey: ['inventory-items'], queryFn: inventoryService.listItems });
  const uomsQ = useQuery({ queryKey: ['inventory-uoms'], queryFn: inventoryService.listUoms });
  const addonsQ = useQuery({
    queryKey: ['menu-addons', selBrand || null],
    queryFn: async () => (await apiClient.get('/admin/menu/addons', { params: { brand_id: Number(selBrand) } })).data ?? [],
    enabled: targetType === 'addon' && !!selBrand,
  });
  const modGroupsQ = useQuery({
    queryKey: ['modifier-groups', selBrand || null],
    queryFn: async () => (await apiClient.get('/admin/menu/modifier-groups', { params: { brand_id: Number(selBrand) } })).data ?? [],
    enabled: targetType === 'modifier' && !!selBrand,
  });

  const itemById = useMemo(() => { const m = new Map<number, any>(); for (const it of itemsQ.data ?? []) m.set(Number(it.id), it); return m; }, [itemsQ.data]);
  const uomById = useMemo(() => { const m = new Map<number, any>(); for (const u of uomsQ.data ?? []) m.set(Number(u.id), u); return m; }, [uomsQ.data]);
  const menuItemById = useMemo(() => { const m = new Map<number, any>(); for (const mi of menuItemsQ.data ?? []) m.set(Number(mi.id), mi); return m; }, [menuItemsQ.data]);
  const allModifiers = useMemo(() => (modGroupsQ.data ?? []).flatMap((g: any) => (g.modifiers ?? []).map((m: any) => ({ ...m, groupName: g.name }))), [modGroupsQ.data]);

  const selMenuItem = menuItemById.get(Number(selItem));
  const selVariantNum = selVariant ? Number(selVariant) : null;
  const dishHasVariants = (selMenuItem?.variants ?? []).length > 0;

  const targetReady = targetType === 'dish' ? !!selItem && (!dishHasVariants || !!selVariant) : targetType === 'addon' ? !!selAddon : !!selModifier;
  const targetPayload = () => {
    if (targetType === 'dish') return { menu_item_id: Number(selItem), variant_id: selVariantNum };
    if (targetType === 'addon') return { addon_id: Number(selAddon) };
    return { modifier_id: Number(selModifier) };
  };
  const targetLabel = () => {
    if (targetType === 'dish') { if (!selMenuItem) return ''; const v = (selMenuItem.variants ?? []).find((x: any) => Number(x.id) === selVariantNum); return `${selMenuItem.name}${v ? ` — ${v.name}` : ''}`; }
    if (targetType === 'addon') { const a = (addonsQ.data ?? []).find((x: any) => Number(x.id) === Number(selAddon)); return a ? a.name : ''; }
    const m = allModifiers.find((x: any) => Number(x.id) === Number(selModifier)); return m ? `${m.groupName} → ${m.name}` : '';
  };

  const recipesKey = ['recipes', targetType, selItem || null, selAddon || null, selModifier || null];
  const recipesQ = useQuery({
    queryKey: recipesKey,
    queryFn: () => {
      if (targetType === 'dish' && selItem) return recipesService.listRecipes({ menu_item_id: Number(selItem) });
      if (targetType === 'addon' && selAddon) return recipesService.listRecipes({ addon_id: Number(selAddon) });
      if (targetType === 'modifier' && selModifier) return recipesService.listRecipes({ modifier_id: Number(selModifier) });
      return Promise.resolve([]);
    },
    enabled: targetReady,
    placeholderData: keepPreviousData,
  });
  const recipesRefreshing = useResultsRefreshing(recipesKey, recipesQ.isFetching);
  const recipesForTarget = useMemo(() => (recipesQ.data ?? []).filter((r: any) => {
    if (targetType === 'dish') return Number(r.menuItemId) === Number(selItem) && (r.variantId ?? null) === selVariantNum;
    if (targetType === 'addon') return Number(r.addonId) === Number(selAddon);
    return Number(r.modifierId) === Number(selModifier);
  }), [recipesQ.data, targetType, selItem, selVariantNum, selAddon, selModifier]);
  const draftRecipe = recipesForTarget.find((r: any) => r.status === 'draft') ?? null;
  const liveRecipe = recipesForTarget.find((r: any) => r.status === 'active') ?? null;
  const editing = !!draftRecipe;
  const editRecipe = draftRecipe;
  const shownLines: any[] = (editing ? draftRecipe?.lines : liveRecipe?.lines) ?? [];
  const selectedLineItem = itemById.get(Number(lineItem));

  const opt = (id: any, label: string, entity?: unknown) => ({
    value: String(id),
    label,
    inactive: entity === undefined ? undefined : isEntityInactive(entity),
  });
  const menuItemOptions = useMemo(() => (menuItemsQ.data ?? []).map((m: any) => opt(m.id, m.name, m)), [menuItemsQ.data]);
  const variantOptions = useMemo(() => (selMenuItem?.variants ?? []).map((v: any) => opt(v.id, v.name, v)), [selMenuItem]);
  const brandOptions = useMemo(() => (brandsQ.data ?? []).map((b: any) => opt(b.id, b.name, b)), [brandsQ.data]);
  const addonOptions = useMemo(() => (addonsQ.data ?? []).map((a: any) => opt(a.id, a.name, a)), [addonsQ.data]);
  const modifierOptions = useMemo(() => allModifiers.map((m: any) => opt(m.id, `${m.groupName} → ${m.name}`, m)), [allModifiers]);
  const ingredientOptions = useMemo(() => (itemsQ.data ?? []).map((it: any) => opt(it.id, it.name)), [itemsQ.data]);
  const branchOptions = useMemo(() => (branchesQ.data ?? []).map((b: any) => opt(b.id, b.name, b)), [branchesQ.data]);

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['recipes'] });
  const getItemAllowedUomIds = (item: any): number[] => {
    if (!item) return [];
    const configured = Array.isArray(item.baseUomIds) && item.baseUomIds.length > 0 ? item.baseUomIds : [item.baseUomId];
    const ids = configured.map((id: any) => Number(id)).filter((id: number) => Number.isInteger(id) && id > 0);
    const seen = new Set<number>(); const unique: number[] = [];
    for (const id of ids) if (!seen.has(id)) { seen.add(id); unique.push(id); }
    const primary = Number(item.baseUomId);
    if (Number.isInteger(primary) && primary > 0 && !seen.has(primary)) unique.unshift(primary);
    return unique;
  };
  const getItemAllowedUoms = (item: any, cur?: number | string | null) => {
    const ids = getItemAllowedUomIds(item); const c = Number(cur);
    if (Number.isInteger(c) && c > 0 && !ids.includes(c)) ids.push(c);
    const opts = ids.map((id) => uomById.get(id)).filter(Boolean);
    return opts.length > 0 ? opts : (uomsQ.data ?? []);
  };
  const getDefaultItemUomId = (item: any): string => { const ids = getItemAllowedUomIds(item); return ids.length > 0 ? String(ids[0]) : ''; };

  const startRecipeM = useMutation({ mutationFn: () => recipesService.createRecipe(targetPayload()), onSuccess: async () => { await invalidate(); toast.success('Recipe started — add its ingredients'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to start recipe') });
  const editLiveM = useMutation({
    mutationFn: async () => {
      const draft = await recipesService.createRecipe(targetPayload());
      for (const ln of liveRecipe?.lines ?? []) await recipesService.addLine(draft.id, { inventory_item_id: ln.inventoryItemId, qty: Number(ln.qty), uom_id: ln.uomId, wastage_factor: ln.wastageFactor ?? null });
      return draft;
    },
    onSuccess: async () => { await invalidate(); toast.success('Editing a new version — activate to apply'); },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to start editing'),
  });
  const clearLineInputs = () => { setLineItem(''); setLineQty(''); setLineUom(''); setLineWastage(''); };
  const addLineM = useMutation({ mutationFn: (line: any) => recipesService.addLine(editRecipe!.id, line), onSuccess: async () => { await invalidate(); clearLineInputs(); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add ingredient') });
  const updateLineM = useMutation({ mutationFn: ({ lineId, qty }: { lineId: number; qty: number }) => recipesService.updateLine(editRecipe!.id, lineId, { qty }), onSuccess: async () => { await invalidate(); clearLineInputs(); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update ingredient') });
  // Inline qty edit on an existing row — does NOT clear the "add ingredient" inputs.
  const setLineQtyM = useMutation({ mutationFn: ({ lineId, qty }: { lineId: number; qty: number }) => recipesService.updateLine(editRecipe!.id, lineId, { qty }), onSuccess: async () => { await invalidate(); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to update quantity') });
  const changeQty = (ln: any, raw: number | string) => {
    const q = Math.max(0, Number(raw));
    if (!Number.isFinite(q) || q === Number(ln.qty)) return;
    setLineQtyM.mutate({ lineId: ln.id, qty: q });
  };
  // Adding an ingredient that's already in the recipe (same item + unit) increments
  // the existing row's quantity instead of creating a duplicate row.
  const upsertLine = () => {
    const itemId = Number(lineItem), uomId = Number(lineUom), qty = Number(lineQty);
    if (!itemId || !uomId || !qty) return;
    const existing = (editRecipe?.lines ?? []).find((l: any) => Number(l.inventoryItemId) === itemId && Number(l.uomId) === uomId);
    if (existing) {
      updateLineM.mutate({ lineId: existing.id, qty: Number(existing.qty) + qty });
    } else {
      addLineM.mutate({ inventory_item_id: itemId, qty, uom_id: uomId, wastage_factor: lineWastage ? Number(lineWastage) / 100 : null });
    }
  };
  const deleteLineM = useMutation({ mutationFn: (lineId: number) => recipesService.deleteLine(editRecipe!.id, lineId), onSuccess: async () => { await invalidate(); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to remove ingredient') });
  const activateM = useMutation({ mutationFn: () => recipesService.activate(editRecipe!.id), onSuccess: async () => { await invalidate(); toast.success('Recipe is live — sales now deduct stock'); }, onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to activate') });
  const computeCostM = useMutation({ mutationFn: (recipeId: number) => recipesService.computeCost(recipeId, { branch_id: Number(costBranch) }), onSuccess: () => toast.success('Cost computed'), onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to compute cost') });
  // Clear any prior result when the costing inputs change, so we never show a
  // computed cost mis-attributed to a different target/branch.
  useEffect(() => { computeCostM.reset(); }, [targetType, selItem, selVariant, selAddon, selModifier, costBranch]); // eslint-disable-line react-hooks/exhaustive-deps

  const costRecipe = liveRecipe ?? draftRecipe;
  const costLines: any[] = computeCostM.data?.snapshot?.costBreakdown?.lines ?? [];

  const resetTarget = () => { setSelItem(''); setSelVariant(''); setSelBrand(''); setSelAddon(''); setSelModifier(''); };

  const TARGETS: { k: TargetType; label: string; Icon: React.ComponentType<{ className?: string }> }[] = [
    { k: 'dish', label: 'A dish', Icon: LuConciergeBell },
    { k: 'addon', label: 'An add-on', Icon: LuCirclePlus },
    { k: 'modifier', label: 'A modifier (option)', Icon: LuSlidersHorizontal },
  ];

  const TargetButtons = (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
      {TARGETS.map(({ k, label, Icon }) => {
        const active = targetType === k;
        return (
          <button key={k} onClick={() => { setTargetType(k); resetTarget(); }}
            className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm font-medium transition ${active ? 'bg-red-600 text-white border-red-600 shadow-sm' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:border-slate-300'}`}>
            <Icon className="w-5 h-5" />
            {label}
          </button>
        );
      })}
    </div>
  );

  const TargetSelectors = (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 items-start">
      {targetType === 'dish' && (
        <>
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Select recipe</div>
            <SearchableSelect value={selItem} onChange={(v) => { setSelItem(v); setSelVariant(''); }} options={menuItemOptions} placeholder="Choose a menu item…" searchPlaceholder="Search menu items…" minWidth="w-full" className="w-full" />
            {dishHasVariants && (
              <div className="mt-2">
                <SearchableSelect value={selVariant} onChange={setSelVariant} options={variantOptions} placeholder="Select a variant… (required)" searchPlaceholder="Search variants…" minWidth="w-full" className="w-full" />
              </div>
            )}
          </div>
          <div className="rounded-lg bg-slate-50 dark:bg-slate-900/40 border border-slate-200 dark:border-slate-700 px-3 py-3 flex items-start gap-2 text-sm text-slate-600 dark:text-slate-300">
            <LuInfo className="w-4 h-4 mt-0.5 text-green-600 shrink-0" />
            {!selItem ? 'Pick a menu item to build its recipe.' : dishHasVariants ? (selVariant ? 'Variant selected — this recipe applies to that variant only.' : 'This item has variants — choose one (you sell per-variant).') : 'This item has no variants — one recipe covers it.'}
          </div>
        </>
      )}
      {(targetType === 'addon' || targetType === 'modifier') && (
        <>
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">Brand</div>
            <SearchableSelect value={selBrand} onChange={(v) => { setSelBrand(v); setSelAddon(''); setSelModifier(''); }} options={brandOptions} placeholder="Choose a brand…" searchPlaceholder="Search brands…" minWidth="w-full" className="w-full" />
          </div>
          <div>
            <div className="text-xs font-medium text-slate-500 dark:text-slate-400 mb-1">{targetType === 'addon' ? 'Add-on' : 'Modifier'}</div>
            {targetType === 'addon' ? (
              <SearchableSelect value={selAddon} onChange={setSelAddon} options={addonOptions} placeholder={selBrand ? 'Choose an add-on…' : 'Pick a brand first'} searchPlaceholder="Search add-ons…" minWidth="w-full" className="w-full" disabled={!selBrand} />
            ) : (
              <SearchableSelect value={selModifier} onChange={setSelModifier} options={modifierOptions} placeholder={selBrand ? 'Choose a modifier…' : 'Pick a brand first'} searchPlaceholder="Search modifiers…" minWidth="w-full" className="w-full" disabled={!selBrand} />
            )}
          </div>
        </>
      )}
    </div>
  );

  const stepBadge = (n: number, done: boolean) => (
    <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-sm font-semibold ${done ? 'bg-green-600 text-white' : 'bg-red-600 text-white'}`}>{n}</span>
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 dark:text-slate-100">Recipes</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Create and manage recipes to automate ingredient deductions and control food costs.</p>
        </div>
        {targetReady && (
          <button onClick={resetTarget} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">
            <LuArrowLeft className="w-4 h-4" /> Back to all recipes
          </button>
        )}
      </div>

      {showTabs && (
        <div className="flex flex-wrap gap-2">
          {[{ k: 'manage', label: 'Build recipe' }, { k: 'costing', label: 'Cost & margin' }].map((t) => (
            <button key={t.k} onClick={() => setTab(t.k as RecipesTabKey)} className={`px-3 py-2 rounded-lg text-sm font-medium border ${tab === (t.k as RecipesTabKey) ? 'bg-red-600 text-white border-red-600' : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'}`}>{t.label}</button>
          ))}
        </div>
      )}

      {tab === 'manage' && (
        <>
          {/* STEP 1 */}
          <div className={`${card} p-6`}>
            <div className="flex items-center gap-3 mb-1">
              {stepBadge(1, targetReady)}
              <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">What is this recipe for?</h2>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400 ml-10 mb-4">Choose whether you&apos;re creating a dish, an add-on, or a modifier.</p>
            {menuItemsQ.isLoading ? <Loader /> : (
              <div className="space-y-4">
                {TargetButtons}
                {TargetSelectors}
              </div>
            )}
          </div>

          {/* STEP 2 */}
          {targetReady && (
            <div className={`${card} p-6`}>
              <div className="flex items-center gap-3 mb-1">
                {stepBadge(2, shownLines.length > 0 && !!liveRecipe && !editing)}
                <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Ingredients for {targetLabel()}</h2>
              </div>
              <p className="text-sm text-slate-500 dark:text-slate-400 ml-10 mb-4">Add the ingredients and quantities used in this recipe.</p>

              {recipesQ.isLoading ? <Loader /> : <FetchingOverlay active={recipesRefreshing} label="Updating recipe…" className="rounded-lg">{!liveRecipe && !draftRecipe ? (
                <div className="rounded-lg border border-dashed border-slate-300 dark:border-slate-600 p-8 text-center">
                  <LuSoup className="w-10 h-10 mx-auto text-slate-300 dark:text-slate-600" />
                  <div className="mt-2 font-medium text-slate-700 dark:text-slate-200">No recipe yet</div>
                  <p className="text-sm text-slate-500 dark:text-slate-400 mb-3">Create one to start listing its ingredients.</p>
                  {canCreate && <button onClick={() => startRecipeM.mutate()} disabled={startRecipeM.isPending} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Create recipe</button>}
                </div>
              ) : (
                <div className="space-y-4">
                  <div className={`flex items-start gap-2 rounded-lg px-3 py-2 text-sm border ${editing ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-200' : 'bg-green-50 dark:bg-green-900/20 border-green-200 dark:border-green-800 text-green-800 dark:text-green-200'}`}>
                    <LuInfo className="w-4 h-4 mt-0.5 shrink-0" />
                    {editing ? (liveRecipe ? 'You are editing this recipe. The current version keeps deducting stock until you activate your changes.' : 'You are editing this recipe. It is not deducting stock yet.') : 'This recipe is live — each sale deducts these ingredients from the brand’s stock.'}
                  </div>

                  <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-slate-500 dark:text-slate-400">
                        <tr>
                          <th className="py-2.5 px-3 font-medium">Ingredient</th>
                          <th className="py-2.5 px-3 font-medium">Quantity</th>
                          <th className="py-2.5 px-3 font-medium">Unit</th>
                          <th className="py-2.5 px-3 font-medium">Wastage %</th>
                          <th className="py-2.5 px-3 font-medium">Wastage Qty</th>
                          <th className="py-2.5 px-3 font-medium">Total Qty</th>
                          {editing && <th className="py-2.5 px-3" />}
                        </tr>
                      </thead>
                      <tbody className="text-slate-700 dark:text-slate-200">
                        {shownLines.length === 0 ? (
                          <tr><td colSpan={editing ? 7 : 6} className="py-10 text-center">
                            <LuSoup className="w-9 h-9 mx-auto text-slate-300 dark:text-slate-600" />
                            <div className="mt-2 font-medium text-slate-600 dark:text-slate-300">No ingredients added yet</div>
                            <div className="text-xs text-slate-400 dark:text-slate-500">Start building your recipe by adding ingredients.</div>
                          </td></tr>
                        ) : shownLines.map((ln: any) => {
                          const qty = Number(ln.qty); const wf = ln.wastageFactor ? Number(ln.wastageFactor) : 0;
                          const uc = uomById.get(Number(ln.uomId))?.code ?? '';
                          return (
                            <tr key={ln.id} className="border-t border-slate-100 dark:border-slate-700">
                              <td className="py-2.5 px-3 font-medium">{itemById.get(Number(ln.inventoryItemId))?.name ?? `Item #${ln.inventoryItemId}`}</td>
                              <td className="py-2.5 px-3">
                                {editing ? (
                                  <div className="inline-flex items-center rounded-lg border border-slate-200 dark:border-slate-600 overflow-hidden">
                                    <button type="button" aria-label="Decrease" onClick={() => changeQty(ln, qty - 1)} className="px-2.5 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700 disabled:opacity-40" disabled={qty <= 0}>−</button>
                                    <input
                                      key={`${ln.id}:${ln.qty}`}
                                      defaultValue={String(qty)}
                                      inputMode="decimal"
                                      onBlur={(e) => changeQty(ln, e.target.value)}
                                      onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
                                      className="w-14 text-center text-sm bg-transparent border-x border-slate-200 dark:border-slate-600 py-1 focus:outline-none focus:ring-1 focus:ring-red-400"
                                    />
                                    <button type="button" aria-label="Increase" onClick={() => changeQty(ln, qty + 1)} className="px-2.5 py-1 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-700">+</button>
                                  </div>
                                ) : qty}
                              </td>
                              <td className="py-2.5 px-3">{uc}</td>
                              <td className="py-2.5 px-3">{wf ? `${(wf * 100).toFixed(1)}%` : '—'}</td>
                              <td className="py-2.5 px-3">{wf ? `${(qty * wf).toFixed(3)} ${uc}` : '—'}</td>
                              <td className="py-2.5 px-3 font-medium">{(qty * (1 + wf)).toFixed(3)} {uc}</td>
                              {editing && <td className="py-2.5 px-3 text-right"><button className="text-red-600 hover:text-red-700 text-sm font-medium" onClick={() => deleteLineM.mutate(ln.id)}>Remove</button></td>}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>

                  {editing ? (
                    <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-3">
                      <div className="text-sm font-medium text-slate-700 dark:text-slate-200 mb-2">Add ingredient</div>
                      <div className="grid grid-cols-1 lg:grid-cols-[1fr_120px_140px_160px_auto] gap-2">
                        <SearchableSelect value={lineItem} onChange={(v) => { setLineItem(v); setLineUom(getDefaultItemUomId(itemById.get(Number(v)))); }} options={ingredientOptions} placeholder="Select ingredient…" searchPlaceholder="Search ingredients…" minWidth="w-full" className="w-full" />
                        <input className={field} placeholder="Quantity" value={lineQty} onChange={(e) => setLineQty(e.target.value)} />
                        <SearchableSelect value={lineUom} onChange={setLineUom} options={getItemAllowedUoms(selectedLineItem, lineUom).map((u: any) => ({ value: String(u.id), label: u.code }))} placeholder="Select unit…" searchPlaceholder="Search units…" minWidth="w-full" className="w-full" disabled={!selectedLineItem} />
                        <input className={field} placeholder="Wastage % (optional)" value={lineWastage} onChange={(e) => setLineWastage(e.target.value)} />
                        <button disabled={!lineItem || !lineQty || !lineUom} onClick={upsertLine}
                          className="rounded-lg bg-red-100 hover:bg-red-200 text-red-700 px-5 py-2 text-sm font-semibold disabled:opacity-50">Add</button>
                      </div>
                    </div>
                  ) : (
                    canEditRecipe && <button onClick={() => editLiveM.mutate()} disabled={editLiveM.isPending} className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700">Edit ingredients</button>
                  )}
                </div>
              )}</FetchingOverlay>}
            </div>
          )}

          {/* Footer: activate + totals */}
          {targetReady && (liveRecipe || draftRecipe) && (
            <div className="grid grid-cols-1 lg:grid-cols-[1fr_280px] gap-4">
              {editing && canActivate ? (
                <button onClick={() => activateM.mutate()} disabled={shownLines.length === 0 || activateM.isPending}
                  className="flex items-center gap-3 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3 text-left hover:bg-green-100 dark:hover:bg-green-900/30 disabled:opacity-50">
                  <LuLock className="w-5 h-5 text-green-700 dark:text-green-300" />
                  <div>
                    <div className="font-semibold text-green-800 dark:text-green-200">Activate recipe</div>
                    <div className="text-xs text-green-700/80 dark:text-green-300/80">Sales will deduct stock after you activate.</div>
                  </div>
                </button>
              ) : (
                <div className="flex items-center gap-3 rounded-xl border border-green-200 dark:border-green-800 bg-green-50 dark:bg-green-900/20 px-4 py-3">
                  <LuLock className="w-5 h-5 text-green-700 dark:text-green-300" />
                  <div>
                    <div className="font-semibold text-green-800 dark:text-green-200">Recipe is live</div>
                    <div className="text-xs text-green-700/80 dark:text-green-300/80">Sales are deducting these ingredients from stock.</div>
                  </div>
                </div>
              )}
              <div className={`${card} px-4 py-3 flex items-center justify-between`}>
                <span className="text-sm text-slate-500 dark:text-slate-400">Total ingredients</span>
                <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">{shownLines.length}</span>
              </div>
            </div>
          )}
        </>
      )}

      {tab === 'costing' && (
        <div className={`${card} p-6 space-y-4`}>
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100">Cost &amp; margin</h2>
          <div className="space-y-4">{TargetButtons}{TargetSelectors}</div>
          {!targetReady ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">Pick a target to see its cost.</div>
          ) : !costRecipe ? (
            <div className="text-sm text-slate-500 dark:text-slate-400">No recipe yet — build one first.</div>
          ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
                <SearchableSelect value={costBranch} onChange={setCostBranch} options={branchOptions} placeholder="At which branch's prices…" searchPlaceholder="Search branches…" minWidth="w-full" className="w-full" />
                <button disabled={!costBranch} onClick={() => computeCostM.mutate(costRecipe.id)} className="rounded-lg bg-red-600 hover:bg-red-700 text-white px-4 py-2 text-sm font-medium disabled:opacity-50">Compute</button>
              </div>
              {computeCostM.data && (
                <div className="text-sm text-slate-700 dark:text-slate-200 space-y-3">
                  {costLines.length > 0 && (
                    <div className="overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
                      <table className="min-w-full text-sm">
                        <thead className="bg-slate-50 dark:bg-slate-900/40 text-left text-slate-500 dark:text-slate-400">
                          <tr><th className="py-2 px-3 font-medium">Ingredient</th><th className="py-2 px-3 font-medium">Qty (incl. wastage)</th><th className="py-2 px-3 font-medium">Unit cost</th><th className="py-2 px-3 font-medium">Line cost</th></tr>
                        </thead>
                        <tbody>
                          {costLines.map((cl: any, i: number) => (
                            <tr key={i} className="border-t border-slate-100 dark:border-slate-700">
                              <td className="py-2 px-3">{itemById.get(Number(cl.inventory_item_id))?.name ?? `Item #${cl.inventory_item_id}`}</td>
                              <td className="py-2 px-3">{Number(cl.qty_in_base).toFixed(4)}</td>
                              <td className="py-2 px-3">{cl.unit_cost != null ? Number(cl.unit_cost).toFixed(4) : <span className="text-amber-600">no cost</span>}</td>
                              <td className="py-2 px-3">{cl.line_cost != null ? Number(cl.line_cost).toFixed(4) : '—'}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className={`${card} px-4 py-3`}><div className="text-xs text-slate-500">Total cost</div><div className="text-lg font-bold">{computeCostM.data.snapshot?.totalCost ?? '—'}</div></div>
                    <div className={`${card} px-4 py-3`}><div className="text-xs text-slate-500">Sell price</div><div className="text-lg font-bold">{computeCostM.data.sell_price}</div></div>
                    <div className={`${card} px-4 py-3`}><div className="text-xs text-slate-500">Gross margin</div><div className="text-lg font-bold">{computeCostM.data.gross_margin != null ? `${Math.round(computeCostM.data.gross_margin * 100)}%` : '—'}</div></div>
                  </div>
                  {computeCostM.data.snapshot?.costBreakdown?.anyMissing && <div className="text-xs text-amber-600">Some ingredients have no received cost yet, so the total is a partial estimate.</div>}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
};

export default Recipes;
