import type { Modifier, ModifierGroup, Variant } from "@/lib/api/types";

/**
 * Client mirror of the backend's size-aware modifier pricing
 * (backend/src/menu/modifier-pricing.ts). The backend reprices authoritatively at
 * order time; this keeps the product-page live total in sync.
 *
 *  - A modifier's `price_by_size[sizeKey]` overrides its flat `price` for the chosen size.
 *  - A group's `included_by_size[sizeKey]` (or flat `included_quantity`) units are free;
 *    the cheapest selected units are zeroed first. "Double X" = quantity 2 of the same modifier.
 */

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

export function resolveModifierUnitPrice(
  mod: Pick<Modifier, "price" | "price_by_size">,
  sizeKey: string | null | undefined,
): number {
  if (sizeKey && mod.price_by_size && mod.price_by_size[sizeKey] != null) {
    return Number(mod.price_by_size[sizeKey]) || 0;
  }
  return Number(mod.price) || 0;
}

function resolveIncludedQuantity(
  group: ModifierGroup,
  sizeKey: string | null | undefined,
): number {
  if (sizeKey && group.included_by_size && group.included_by_size[sizeKey] != null) {
    return Math.max(0, Number(group.included_by_size[sizeKey]) || 0);
  }
  return Math.max(0, Number(group.included_quantity) || 0);
}

export function sizeKeyForVariant(variant: Variant | null | undefined): string | null {
  return variant?.size_key ?? null;
}

/**
 * Size-aware selection limits: a group's min/max_select_by_size (keyed by variant size_key)
 * overrides its flat min_select/max_select for the chosen size — e.g. WOK&GO Express Box
 * "Large = choose 2 toppings, XL = choose 3".
 */
export function resolveMinSelect(
  group: Pick<ModifierGroup, "min_select" | "min_select_by_size">,
  sizeKey: string | null | undefined,
): number {
  if (sizeKey && group.min_select_by_size && group.min_select_by_size[sizeKey] != null) {
    return Math.max(0, Number(group.min_select_by_size[sizeKey]) || 0);
  }
  return Math.max(0, Number(group.min_select) || 0);
}

/**
 * Returns null when neither a per-size override nor a flat max_select is set, so call
 * sites keep their own fallback semantics (`?? 99` = uncapped, `=== 1` = single-select).
 */
export function resolveMaxSelect(
  group: Pick<ModifierGroup, "max_select" | "max_select_by_size">,
  sizeKey: string | null | undefined,
): number | null {
  if (sizeKey && group.max_select_by_size && group.max_select_by_size[sizeKey] != null) {
    return Math.max(0, Number(group.max_select_by_size[sizeKey]) || 0);
  }
  return group.max_select ?? null;
}

/** Total charge for selected modifiers (size-aware + first-N-free). */
export function computeModifiersPrice(
  modifierGroups: ModifierGroup[] | undefined | null,
  selections: Array<{ modifier_id: number; quantity?: number }> | undefined | null,
  sizeKey: string | null | undefined,
): number {
  if (!selections?.length || !modifierGroups?.length) return 0;

  const modIndex = new Map<number, Modifier>();
  const groupOf = new Map<number, ModifierGroup>();
  for (const g of modifierGroups) {
    for (const m of g.modifiers ?? []) {
      modIndex.set(m.id, m);
      groupOf.set(m.id, g);
    }
  }

  const groupUnits = new Map<ModifierGroup, number[]>();
  for (const sel of selections) {
    const mod = modIndex.get(sel.modifier_id);
    const group = groupOf.get(sel.modifier_id);
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
    const tiers = group.price_tiers;
    if (tiers && Object.keys(tiers).length > 0) {
      total += resolveTierCharge(tiers, Math.max(0, units.length - free));
      continue;
    }
    const sorted = [...units].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (i < free) continue;
      total += sorted[i];
    }
  }
  return round2(total);
}

/**
 * Total charge for `n` charged units given a tier table (e.g. {1:99,2:169,3:249}).
 *
 * Tier values are BUNDLE prices. An exact match returns that bundle's price; otherwise the
 * charge is built by GREEDILY packing the largest bundles first, reusing them as needed —
 * NOT by linear extrapolation. So 4 = 3 (249) + 1 (99) = 348; 7 = 3 + 3 + 1 = 597.
 */
export function resolveTierCharge(tiers: Record<string, number>, n: number): number {
  if (n <= 0) return 0;
  if (tiers[String(n)] != null) return round2(Number(tiers[String(n)]));
  const keys = Object.keys(tiers).map(Number).filter((k) => Number.isFinite(k) && k > 0).sort((a, b) => a - b);
  if (!keys.length) return 0;
  if (n < keys[0]) {
    // Below smallest tier: charge proportionally at that tier's per-unit rate.
    return round2((Number(tiers[String(keys[0])]) / keys[0]) * n);
  }
  return fillWithTiers(tiers, keys, n);
}

/** Greedily fill n units using the provided tiers from largest to smallest (reused as needed). */
function fillWithTiers(tiers: Record<string, number>, keys: number[], n: number): number {
  if (n <= 0 || !keys.length) return 0;
  const sorted = [...keys].sort((a, b) => b - a); // descending
  let remaining = n;
  let cost = 0;
  for (const k of sorted) {
    if (remaining <= 0) break;
    const count = Math.floor(remaining / k);
    cost += count * Number(tiers[String(k)]);
    remaining -= count * k;
  }
  if (remaining > 0) {
    // Fractional remainder below the smallest tier: per-unit rate of the smallest tier.
    const smallestKey = sorted[sorted.length - 1];
    cost += (remaining * Number(tiers[String(smallestKey)])) / smallestKey;
  }
  return round2(cost);
}
