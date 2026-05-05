import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import Card from '../../../components/Card';
import Loader from '../../../components/Loader';
import Button from '../../../components/Button';
import apiClient from '../../../utils/apiClient';
import { recipesService } from '../../../services/api/recipesService';
import { inventoryService } from '../../../services/api/inventoryService';

export type RecipesTabKey = 'manage' | 'costing';

const Recipes: React.FC<{ initialTab?: RecipesTabKey; showTabs?: boolean }> = ({
  initialTab = 'manage',
  showTabs = true,
}) => {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<RecipesTabKey>(initialTab);
  const [form, setForm] = useState<any>({});

  const branchesQ = useQuery({
    queryKey: ['branches'],
    queryFn: async () => (await apiClient.get('/admin/branches')).data ?? [],
  });
  const menuItemsQ = useQuery({
    queryKey: ['menu-items'],
    queryFn: async () => {
      const res = await apiClient.get('/admin/menu/items');
      return res.data ?? [];
    },
  });
  const itemsQ = useQuery({
    queryKey: ['inventory-items'],
    queryFn: inventoryService.listItems,
  });
  const uomsQ = useQuery({
    queryKey: ['inventory-uoms'],
    queryFn: inventoryService.listUoms,
  });

  const recipesQ = useQuery({
    queryKey: ['recipes', form.menu_item_id || null],
    queryFn: () => recipesService.listRecipes(form.menu_item_id ? { menu_item_id: Number(form.menu_item_id) } : undefined),
  });

  const createRecipeM = useMutation({
    mutationFn: (data: { menu_item_id: number; variant_id?: number | null; notes?: string }) => recipesService.createRecipe(data),
    onSuccess: async () => {
      toast.success('Recipe created');
      await queryClient.invalidateQueries({ queryKey: ['recipes'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to create recipe'),
  });

  const addLineM = useMutation({
    mutationFn: (data: { recipeId: number; line: any }) => recipesService.addLine(data.recipeId, data.line),
    onSuccess: async () => {
      toast.success('Line added');
      await queryClient.invalidateQueries({ queryKey: ['recipes'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to add line'),
  });

  const activateM = useMutation({
    mutationFn: (recipeId: number) => recipesService.activate(recipeId),
    onSuccess: async () => {
      toast.success('Recipe activated');
      await queryClient.invalidateQueries({ queryKey: ['recipes'] });
    },
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to activate recipe'),
  });

  const computeCostM = useMutation({
    mutationFn: (data: { recipeId: number; branch_id: number }) => recipesService.computeCost(data.recipeId, { branch_id: data.branch_id }),
    onSuccess: () => toast.success('Cost computed'),
    onError: (e: any) => toast.error(e?.response?.data?.message ?? 'Failed to compute cost'),
  });

  const selectedRecipeId = form.recipe_id ? Number(form.recipe_id) : null;
  const selectedRecipe = useMemo(() => (recipesQ.data ?? []).find((r: any) => r.id === selectedRecipeId) ?? null, [recipesQ.data, selectedRecipeId]);
  const itemById = useMemo(() => {
    const m = new Map<number, any>();
    for (const it of itemsQ.data ?? []) m.set(Number(it.id), it);
    return m;
  }, [itemsQ.data]);
  const uomById = useMemo(() => {
    const m = new Map<number, any>();
    for (const u of uomsQ.data ?? []) m.set(Number(u.id), u);
    return m;
  }, [uomsQ.data]);
  const selectedLineItem = useMemo(
    () => itemById.get(Number(form.line_item_id)),
    [itemById, form.line_item_id],
  );

  const getItemAllowedUomIds = (item: any): number[] => {
    if (!item) return [];
    const configured = Array.isArray(item.baseUomIds) && item.baseUomIds.length > 0
      ? item.baseUomIds
      : [item.baseUomId];
    const normalized = configured
      .map((id: any) => Number(id))
      .filter((id: number) => Number.isInteger(id) && id > 0);
    const unique: number[] = [];
    const seen = new Set<number>();
    for (const id of normalized) {
      if (!seen.has(id)) {
        seen.add(id);
        unique.push(id);
      }
    }
    const primary = Number(item.baseUomId);
    if (Number.isInteger(primary) && primary > 0 && !seen.has(primary)) {
      unique.unshift(primary);
    }
    return unique;
  };

  const getItemAllowedUoms = (item: any, currentUomId?: number | string | null) => {
    const ids = getItemAllowedUomIds(item);
    const current = Number(currentUomId);
    if (Number.isInteger(current) && current > 0 && !ids.includes(current)) {
      ids.push(current);
    }
    const options = ids.map((id) => uomById.get(id)).filter(Boolean);
    return options.length > 0 ? options : (uomsQ.data ?? []);
  };

  const getDefaultItemUomId = (item: any): string => {
    const ids = getItemAllowedUomIds(item);
    return ids.length > 0 ? String(ids[0]) : '';
  };

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-800 dark:text-slate-100">Recipes</h1>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Define ingredient consumption per menu item and compute cost and gross margin.
        </p>
      </div>

      {showTabs && (
        <div className="flex flex-wrap gap-2">
          {[
            { k: 'manage', label: 'Recipe builder' },
            { k: 'costing', label: 'Costing & margin' },
          ].map((t) => (
            <button
              key={t.k}
              onClick={() => setTab(t.k as RecipesTabKey)}
              className={`px-3 py-2 rounded-lg text-sm font-medium border ${
                tab === (t.k as RecipesTabKey)
                  ? 'bg-red-600 text-white border-red-600'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {tab === 'manage' && (
        <>
          <Card>
            <div className="space-y-2 text-sm text-slate-700 dark:text-slate-200">
              <div className="font-semibold text-slate-800 dark:text-slate-100">How this module works</div>
              <ol className="list-decimal pl-5 space-y-1 text-slate-600 dark:text-slate-300">
                <li>Select a <span className="font-medium">menu item</span> and create a recipe version.</li>
                <li>Add <span className="font-medium">recipe lines</span> (ingredients + quantities).</li>
                <li>Activate the recipe so new orders consume inventory using <span className="font-medium">earliest-expiry-first</span> batches.</li>
              </ol>
            </div>
          </Card>

          <Card>
        <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Create recipe</h2>
        {menuItemsQ.isLoading ? <Loader /> : (
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
            <select className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              value={form.menu_item_id ?? ''} onChange={(e) => setForm({ ...form, menu_item_id: e.target.value })}>
              <option value="">Menu item (what customer buys)…</option>
              {(menuItemsQ.data ?? []).map((m: any) => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
            <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              placeholder="Menu variant ID (optional)" value={form.variant_id ?? ''} onChange={(e) => setForm({ ...form, variant_id: e.target.value })} />
            <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              placeholder="Notes (optional)" value={form.recipe_notes ?? ''} onChange={(e) => setForm({ ...form, recipe_notes: e.target.value })} />
            <Button onClick={() => createRecipeM.mutate({ menu_item_id: Number(form.menu_item_id), variant_id: form.variant_id ? Number(form.variant_id) : null, notes: form.recipe_notes })}>
              Create
            </Button>
          </div>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Recipes</h2>
          {recipesQ.isLoading ? <Loader /> : (
            <>
              <div className="mb-3">
                <select className="border rounded-lg p-2 w-full bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                  value={form.recipe_id ?? ''} onChange={(e) => setForm({ ...form, recipe_id: e.target.value })}>
                  <option value="">Select recipe…</option>
                  {(recipesQ.data ?? []).map((r: any) => (
                    <option key={r.id} value={r.id}>
                      #{r.id} · item {r.menuItemId} · v{r.version} · {r.status} {r.variantId ? `(variant ${r.variantId})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              {selectedRecipe && (
                <div className="space-y-2">
                  <div className="flex gap-2">
                    <Button onClick={() => activateM.mutate(selectedRecipe.id)}>Activate</Button>
                  </div>
                  <div className="text-sm text-slate-600 dark:text-slate-300">
                    Lines: {selectedRecipe.lines?.length ?? 0}
                  </div>
                </div>
              )}
            </>
          )}
        </Card>

        <Card>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Add recipe line</h2>
          {!selectedRecipe ? (
            <div className="text-slate-500 dark:text-slate-400">Select a recipe first.</div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-4 gap-2">
              <select className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                value={form.line_item_id ?? ''}
                onChange={(e) => {
                  const itemId = Number(e.target.value);
                  const selected = itemById.get(itemId);
                  setForm({
                    ...form,
                    line_item_id: e.target.value,
                    line_uom_id: getDefaultItemUomId(selected),
                  });
                }}
              >
                <option value="">Ingredient…</option>
                {(itemsQ.data ?? []).map((it: any) => <option key={it.id} value={it.id}>{it.name}</option>)}
              </select>
              <input className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                placeholder="Qty" value={form.line_qty ?? ''} onChange={(e) => setForm({ ...form, line_qty: e.target.value })} />
              <select className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
                value={form.line_uom_id ?? ''}
                onChange={(e) => setForm({ ...form, line_uom_id: e.target.value })}
                disabled={!selectedLineItem}
              >
                <option value="">UOM…</option>
                {getItemAllowedUoms(selectedLineItem, form.line_uom_id).map((u: any) => <option key={u.id} value={u.id}>{u.code}</option>)}
              </select>
              <Button onClick={() => addLineM.mutate({ recipeId: selectedRecipe.id, line: {
                inventory_item_id: Number(form.line_item_id),
                qty: Number(form.line_qty),
                uom_id: Number(form.line_uom_id),
                wastage_factor: null,
              }})}>
                Add
              </Button>
            </div>
          )}
        </Card>
      </div>
        </>
      )}

      {tab === 'costing' && (
        <Card>
          <h2 className="text-lg font-semibold text-slate-800 dark:text-slate-100 mb-3">Compute cost and margin</h2>
        {!selectedRecipe ? (
          <div className="text-slate-500 dark:text-slate-400">Select a recipe first.</div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-2">
            <select className="border rounded-lg p-2 bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700"
              value={form.cost_branch_id ?? ''} onChange={(e) => setForm({ ...form, cost_branch_id: e.target.value })}>
              <option value="">Branch…</option>
              {(branchesQ.data ?? []).map((b: any) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
            <Button onClick={() => computeCostM.mutate({ recipeId: selectedRecipe.id, branch_id: Number(form.cost_branch_id) })}>
              Compute
            </Button>
            <div />
            {computeCostM.data && (
              <div className="lg:col-span-3 text-sm text-slate-700 dark:text-slate-200">
                <div>Total cost: <span className="font-semibold">{computeCostM.data.snapshot?.totalCost ?? computeCostM.data.snapshot?.total_cost ?? '—'}</span></div>
                <div>Sell price: {computeCostM.data.sell_price}</div>
                <div>Gross margin: {computeCostM.data.gross_margin != null ? `${Math.round(computeCostM.data.gross_margin * 100)}%` : '—'}</div>
                <div className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                  Cost is based on the latest received costs (from posted goods receipts) converted into each item’s base unit.
                </div>
              </div>
            )}
          </div>
        )}
      </Card>
      )}
    </div>
  );
};

export default Recipes;

