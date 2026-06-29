import { MenuItem, MenuModifierGroup } from '../types';

/**
 * Client mirror of the backend's size-aware modifier pricing (backend/src/menu/modifier-pricing.ts).
 * The backend reprices authoritatively at quote/order time; this keeps POS/consumer live
 * totals in sync so what the customer sees matches what is charged.
 *
 * Free-unit allocation uses "slot-based" distribution: the first unit of each modifier
 * (cheapest-first within the same slot) is freed before any modifier's second unit is freed.
 * This ensures the charge falls on the modifier that was deliberately added as an extra,
 * not on a more-expensive modifier that was already in the selection.
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

export function resolveIncludedQuantity(
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
 *
 * Free allocation is slot-based: in each "round", one unit from each modifier is freed
 * (cheapest modifier first within the round). Only after all modifiers have had their
 * first unit freed do second units of any modifier get freed. This charges the customer
 * for the modifier they deliberately doubled, not for a different (possibly pricier) one.
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

  // Build per-group slot lists: each unit tagged with its slot (0 = first unit of that modifier, 1 = second, …).
  const groupSlots = new Map<MenuModifierGroup, { price: number; slot: number }[]>();
  for (const sel of selections) {
    const mod = modIndex.get(sel.modifierId);
    const group = groupOf.get(sel.modifierId);
    if (!mod || !group) continue;
    const qty = Math.max(0, Math.floor(Number(sel.quantity ?? 1)) || 0);
    if (qty === 0) continue;
    const unitPrice = resolveModifierUnitPrice(mod, sizeKey);
    const arr = groupSlots.get(group) ?? [];
    for (let i = 0; i < qty; i++) arr.push({ price: unitPrice, slot: i });
    groupSlots.set(group, arr);
  }

  let total = 0;
  for (const [group, slotUnits] of groupSlots) {
    const free = resolveIncludedQuantity(group, sizeKey);
    const tiers = group.price_tiers;
    if (tiers && Object.keys(tiers).length > 0) {
      const charged = Math.max(0, slotUnits.length - free);
      total += resolveTierCharge(tiers, charged);
      continue;
    }
    // Sort by (slot asc, price asc): slot-0 units freed first, cheapest within each slot freed first.
    const sorted = [...slotUnits].sort((a, b) =>
      a.slot !== b.slot ? a.slot - b.slot : a.price - b.price,
    );
    let freeLeft = free;
    for (const u of sorted) {
      if (freeLeft > 0) { freeLeft--; continue; }
      total += u.price;
    }
  }
  return round2(total);
}

/**
 * Total charge for `n` extra (charged) units given a tier table, e.g. {1:99, 2:169, 3:249}.
 *
 * Tier values are BUNDLE prices (not per-unit). The algorithm:
 *   • n ≤ maxKey and exact match → return tier[n] directly.
 *   • n > maxKey → one maxKey bundle, then fill the remainder greedily using
 *     only the smaller tiers (never reuses the largest tier). This matches the
 *     "3+2+2" / "3+2+1" splitting the user expects.
 *   • n between keys (no exact match) → largest fitting tier + fill remainder with ≤ that tier.
 */
export function resolveTierCharge(tiers: Record<string, number>, n: number): number {
  if (n <= 0) return 0;

  const keys = Object.keys(tiers)
    .map(Number)
    .filter((k) => Number.isFinite(k) && k > 0)
    .sort((a, b) => a - b); // ascending: e.g. [1, 2, 3]

  if (!keys.length) return 0;

  // Exact match
  if (tiers[String(n)] != null) return round2(Number(tiers[String(n)]));

  const maxKey = keys[keys.length - 1];

  if (n < keys[0]) {
    // Below smallest tier: charge proportionally from the smallest tier rate
    return round2((Number(tiers[String(keys[0])]) / keys[0]) * n);
  }

  if (n > maxKey) {
    // Use ONE maxKey bundle, then fill remainder with ONLY smaller tiers
    const maxCost = Number(tiers[String(maxKey)]);
    const remainder = n - maxKey;
    const smallerKeys = keys.slice(0, -1);
    const smallerTiers: Record<string, number> = {};
    for (const k of smallerKeys) smallerTiers[String(k)] = Number(tiers[String(k)]);
    return round2(maxCost + fillWithTiers(smallerTiers, smallerKeys, remainder));
  }

  // n is between keys (no exact match): use largest key ≤ n, fill remainder with ≤ that key
  let bestKey = keys[0];
  for (const k of keys) {
    if (k <= n) bestKey = k;
  }
  const bestCost = Number(tiers[String(bestKey)]);
  const remainder = n - bestKey;
  const fittingKeys = keys.filter((k) => k <= bestKey);
  const fittingTiers: Record<string, number> = {};
  for (const k of fittingKeys) fittingTiers[String(k)] = Number(tiers[String(k)]);
  return round2(bestCost + fillWithTiers(fittingTiers, fittingKeys, remainder));
}

/** Greedily fill n units using provided tiers from largest to smallest. */
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
    // Fractional remainder: use per-unit rate of the smallest tier
    const smallestKey = sorted[sorted.length - 1];
    cost += (remaining * Number(tiers[String(smallestKey)])) / smallestKey;
  }
  return round2(cost);
}
