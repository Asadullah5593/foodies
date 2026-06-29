import { MenuItem, MenuModifierGroup } from '../types';

/**
 * Client mirror of the backend's size-aware modifier pricing (backend/src/menu/modifier-pricing.ts).
 * The backend reprices authoritatively at quote/order time; this keeps POS/consumer live
 * totals in sync so what the customer sees matches what is charged.
 *
 * Rules:
 *  - A modifier's `price_by_size[sizeKey]` overrides its flat `price` when the line's variant
 *    has that size.
 *  - A group's `included_by_size[sizeKey]` (or flat `included_quantity`) units are free; the
 *    cheapest selected units are zeroed first. "Double meat" = same modifier with quantity 2.
 */

export interface ModifierSelection {
  modifierId: number;
  quantity: number;
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function resolveModifierUnitPrice(
  mod: { price: number; price_by_size?: Record<string, number> | null },
  sizeKey: string | null | undefined,
): number {
  if (sizeKey && mod.price_by_size && mod.price_by_size[sizeKey] != null) {
    return Number(mod.price_by_size[sizeKey]) || 0;
  }
  return Number(mod.price) || 0;
}

function resolveIncludedQuantity(
  group: MenuModifierGroup,
  sizeKey: string | null | undefined,
): number {
  if (sizeKey && group.included_by_size && group.included_by_size[sizeKey] != null) {
    return Math.max(0, Number(group.included_by_size[sizeKey]) || 0);
  }
  return Math.max(0, Number(group.included_quantity) || 0);
}

/** Resolve the size_key for a chosen variant of an item (null when none/sizeless). */
export function sizeKeyForSelection(
  item: Pick<MenuItem, 'variants'>,
  variantId: number | undefined,
): string | null {
  if (!variantId || !item.variants?.length) return null;
  const v = item.variants.find((x) => x.id === variantId);
  return v?.size_key ?? null;
}

/**
 * Total charge for the selected modifiers on a line (size-aware + first-N-free).
 * Falls back to flat `sum(price*qty)` when no per-size or included data is present.
 */
export function computeModifiersPrice(
  modifierGroups: MenuModifierGroup[] | undefined | null,
  selections: ModifierSelection[] | undefined | null,
  sizeKey: string | null | undefined,
): number {
  if (!selections?.length || !modifierGroups?.length) return 0;

  const modIndex = new Map<number, { price: number; price_by_size?: Record<string, number> | null }>();
  const groupOf = new Map<number, MenuModifierGroup>();
  for (const g of modifierGroups) {
    for (const m of g.modifiers ?? []) {
      modIndex.set(m.id, m);
      groupOf.set(m.id, g);
    }
  }

  // Build per-group unit lists (each unit carries its size-aware price).
  const groupUnits = new Map<MenuModifierGroup, number[]>();
  for (const sel of selections) {
    const mod = modIndex.get(sel.modifierId);
    const group = groupOf.get(sel.modifierId);
    if (!mod || !group) continue;
    const qty = Math.max(0, Math.floor(Number(sel.quantity ?? 1)) || 0);
    if (qty === 0) continue;
    const unit = resolveModifierUnitPrice(mod, sizeKey);
    const arr = groupUnits.get(group) ?? [];
    for (let i = 0; i < qty; i++) arr.push(unit);
    groupUnits.set(group, arr);
  }

  let total = 0;
  for (const [group, units] of groupUnits) {
    const free = resolveIncludedQuantity(group, sizeKey);
    const chargedCount = Math.max(0, units.length - free);
    const tiers = group.price_tiers;
    if (tiers && Object.keys(tiers).length > 0) {
      // Quantity-tiered bundle price for the charged units (e.g. dips 99/169/249).
      total += resolveTierCharge(tiers, chargedCount);
      continue;
    }
    const sorted = [...units].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (i < free) continue; // cheapest `free` units are free
      total += sorted[i];
    }
  }
  return round2(total);
}

/** Total charge for `n` charged units given a tier table (e.g. {1:99,2:169,3:249}). */
export function resolveTierCharge(tiers: Record<string, number>, n: number): number {
  if (n <= 0) return 0;
  if (tiers[String(n)] != null) return round2(Number(tiers[String(n)]));
  const keys = Object.keys(tiers).map(Number).filter((k) => Number.isFinite(k) && k > 0).sort((a, b) => a - b);
  if (!keys.length) return 0;
  const maxKey = keys[keys.length - 1];
  if (n > maxKey) {
    const lastVal = Number(tiers[String(maxKey)]);
    const prevKey = keys.length > 1 ? keys[keys.length - 2] : 0;
    const prevVal = prevKey > 0 ? Number(tiers[String(prevKey)]) : 0;
    const marginal = (lastVal - prevVal) / (maxKey - prevKey || 1);
    return round2(lastVal + (n - maxKey) * marginal);
  }
  let baseKey = 0;
  let baseVal = 0;
  for (const k of keys) {
    if (k <= n) { baseKey = k; baseVal = Number(tiers[String(k)]); }
  }
  const perUnit = baseKey > 0 ? baseVal / baseKey : 0;
  return round2(baseVal + (n - baseKey) * perUnit);
}
