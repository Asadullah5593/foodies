/**
 * Size-aware modifier pricing — the single source of truth for how selected modifiers
 * are charged on an order line. Used by every pricing site (POS quote, order create,
 * kiosk, consumer checkout, deal expansion) so all channels agree.
 *
 * Two behaviours layered on top of the legacy flat price:
 *   1. Per-size surcharge: a modifier's `priceBySize[sizeKey]` (e.g. Extra Cheese 12" = 249)
 *      overrides its flat `price` when the line's variant has that sizeKey.
 *   2. "First N free": each modifier GROUP can include `includedQuantity` units free
 *      (or a per-size `includedBySize[sizeKey]`) before any are charged. Units are counted
 *      by quantity, so the same modifier selected twice ("double meat") consumes two units.
 *      The free allowance is applied to the CHEAPEST units first (customer-friendly).
 *
 * With no priceBySize and no included allowance this reduces exactly to the old
 * `sum(price * quantity)`, so existing menus are unaffected.
 */

export interface PricingModifier {
    id: number;
    name?: string | null;
    price: number | string;
    priceBySize?: Record<string, number> | null;
}

export interface PricingModifierGroup {
    id?: number;
    includedQuantity?: number | null;
    includedBySize?: Record<string, number> | null;
    /** Quantity-tiered bundle price for charged units, keyed by charged count → total. */
    priceTiers?: Record<string, number> | null;
    modifiers?: PricingModifier[] | null;
}

export interface ModifierSelection {
    modifier_id: number;
    quantity?: number | null;
}

/** Per-modifier result, aggregated by modifierId, suitable for persisting an OrderItemModifier. */
export interface PricedModifierLine {
    modifierId: number;
    name: string | null;
    /** Total units selected for this modifier. */
    quantity: number;
    /** Units that were included free by the group allowance. */
    freeQuantity: number;
    /** Size-aware per-unit price (what each CHARGED unit costs). */
    unitPrice: number;
    /** (quantity - freeQuantity) * unitPrice, rounded to 2dp. */
    charge: number;
    /** The line's variant sizeKey used to resolve pricing (null when sizeless). */
    sizeKey: string | null;
}

export interface ModifierPricingResult {
    /** Sum of all line charges, rounded to 2dp. */
    total: number;
    lines: PricedModifierLine[];
}

const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

/**
 * Clean a size→number map from API input: keep only finite numeric entries (>= 0),
 * trim keys, and collapse to null when nothing valid remains so the column stays NULL
 * and the flat fallback applies. `round` keeps prices to 2dp; included counts are floored.
 */
function normalizeSizeMap(
    input: Record<string, unknown> | null | undefined,
    mode: 'price' | 'count',
): Record<string, number> | null {
    if (!input || typeof input !== 'object') return null;
    const out: Record<string, number> = {};
    for (const [rawKey, rawVal] of Object.entries(input)) {
        const key = String(rawKey).trim();
        if (!key) continue;
        const num = Number(rawVal);
        if (!Number.isFinite(num) || num < 0) continue;
        out[key] = mode === 'price' ? round2(num) : Math.floor(num);
    }
    return Object.keys(out).length ? out : null;
}

export const normalizePriceBySize = (
    input: Record<string, unknown> | null | undefined,
): Record<string, number> | null => normalizeSizeMap(input, 'price');

/** Tiers map (charged-count → total price); same shape/validation as a price-by-size map. */
export const normalizePriceTiers = (
    input: Record<string, unknown> | null | undefined,
): Record<string, number> | null => normalizeSizeMap(input, 'price');

/**
 * Total charge for `n` charged units given a tier table (e.g. {1:99,2:169,3:249}).
 *
 * Tier values are BUNDLE prices. For n > maxKey: one maxKey bundle, then fill the
 * remainder greedily with SMALLER tiers only — giving the "3+2+2" / "3+2+1" splits
 * rather than reusing the largest tier. For n between defined keys: largest fitting
 * tier + remainder with ≤ that tier.
 */
export function resolveTierCharge(
    tiers: Record<string, number>,
    n: number,
): number {
    if (n <= 0) return 0;
    if (tiers[String(n)] != null) return round2(Number(tiers[String(n)]));
    const keys = Object.keys(tiers)
        .map((k) => Number(k))
        .filter((k) => Number.isFinite(k) && k > 0)
        .sort((a, b) => a - b);
    if (!keys.length) return 0;
    const maxKey = keys[keys.length - 1];

    if (n < keys[0]) {
        // Below smallest tier: charge proportionally
        return round2((Number(tiers[String(keys[0])]) / keys[0]) * n);
    }

    if (n > maxKey) {
        // One maxKey bundle, then fill remainder with ONLY smaller tiers
        const maxCost = Number(tiers[String(maxKey)]);
        const remainder = n - maxKey;
        const smallerKeys = keys.slice(0, -1);
        const smallerTiers: Record<string, number> = {};
        for (const k of smallerKeys)
            smallerTiers[String(k)] = Number(tiers[String(k)]);
        return round2(maxCost + fillWithTiers(smallerTiers, smallerKeys, remainder));
    }

    // n between keys (no exact match): largest key ≤ n, fill remainder with ≤ that key
    let bestKey = keys[0];
    for (const k of keys) {
        if (k <= n) bestKey = k;
    }
    const bestCost = Number(tiers[String(bestKey)]);
    const remainder = n - bestKey;
    const fittingKeys = keys.filter((k) => k <= bestKey);
    const fittingTiers: Record<string, number> = {};
    for (const k of fittingKeys)
        fittingTiers[String(k)] = Number(tiers[String(k)]);
    return round2(bestCost + fillWithTiers(fittingTiers, fittingKeys, remainder));
}

function fillWithTiers(
    tiers: Record<string, number>,
    keys: number[],
    n: number,
): number {
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
        const smallestKey = sorted[sorted.length - 1];
        cost +=
            (remaining * Number(tiers[String(smallestKey)])) / smallestKey;
    }
    return round2(cost);
}

export const normalizeIncludedBySize = (
    input: Record<string, unknown> | null | undefined,
): Record<string, number> | null => normalizeSizeMap(input, 'count');

/** Resolve a modifier's per-unit price for a given size, falling back to its flat price. */
export function resolveModifierUnitPrice(
    mod: PricingModifier,
    sizeKey: string | null | undefined,
): number {
    if (sizeKey && mod.priceBySize && mod.priceBySize[sizeKey] != null) {
        return Number(mod.priceBySize[sizeKey]) || 0;
    }
    return Number(mod.price) || 0;
}

/** Resolve a group's free-included unit count for a given size. */
export function resolveIncludedQuantity(
    group: PricingModifierGroup,
    sizeKey: string | null | undefined,
): number {
    if (
        sizeKey &&
        group.includedBySize &&
        group.includedBySize[sizeKey] != null
    ) {
        return Math.max(0, Number(group.includedBySize[sizeKey]) || 0);
    }
    return Math.max(0, Number(group.includedQuantity) || 0);
}

/**
 * Price the selected modifiers for one order line.
 * Unknown modifier ids (not present in any group) are skipped, matching prior behaviour.
 */
export function priceModifiersForLine(params: {
    modifierGroups: PricingModifierGroup[] | null | undefined;
    selections: ModifierSelection[] | null | undefined;
    sizeKey: string | null | undefined;
}): ModifierPricingResult {
    const { modifierGroups, selections } = params;
    const sizeKey = params.sizeKey ?? null;

    // Index each modifier to its owning group.
    const modIndex = new Map<
        number,
        { mod: PricingModifier; group: PricingModifierGroup }
    >();
    for (const group of modifierGroups ?? []) {
        for (const mod of group.modifiers ?? []) {
            modIndex.set(mod.id, { mod, group });
        }
    }

    // Per-modifier aggregate (merges duplicate selections of the same modifier id).
    const lineAgg = new Map<number, PricedModifierLine>();
    // Per-group unit list tagged with slot (0 = first unit of that modifier, 1 = second, …).
    const groupUnits = new Map<
        PricingModifierGroup,
        Array<{ modifierId: number; unitPrice: number; slot: number }>
    >();

    for (const sel of selections ?? []) {
        const found = modIndex.get(sel.modifier_id);
        if (!found) continue;
        const qty = Math.max(0, Math.floor(Number(sel.quantity ?? 1)) || 0);
        if (qty === 0) continue;
        const unitPrice = resolveModifierUnitPrice(found.mod, sizeKey);

        let line = lineAgg.get(sel.modifier_id);
        if (!line) {
            line = {
                modifierId: sel.modifier_id,
                name: found.mod.name ?? null,
                quantity: 0,
                freeQuantity: 0,
                unitPrice,
                charge: 0,
                sizeKey,
            };
            lineAgg.set(sel.modifier_id, line);
        }
        line.quantity += qty;

        let units = groupUnits.get(found.group);
        if (!units) {
            units = [];
            groupUnits.set(found.group, units);
        }
        for (let i = 0; i < qty; i++)
            units.push({ modifierId: sel.modifier_id, unitPrice, slot: i });
    }

    // Apply each group's free allowance using slot-based ordering:
    // slot-0 units (first of each modifier, cheapest first within slot) are freed before
    // any modifier's slot-1+ units. This charges the customer for the modifier they
    // deliberately doubled, not for a pricier modifier in the original selection.
    for (const [group, units] of groupUnits) {
        const included = resolveIncludedQuantity(group, sizeKey);
        if (included <= 0) continue;
        const orderBySlotPrice = units
            .map((_, i) => i)
            .sort((a, b) => {
                const slotDiff = units[a].slot - units[b].slot;
                return slotDiff !== 0
                    ? slotDiff
                    : units[a].unitPrice - units[b].unitPrice;
            });
        const freeCount = Math.min(included, units.length);
        for (let k = 0; k < freeCount; k++) {
            const unit = units[orderBySlotPrice[k]];
            const line = lineAgg.get(unit.modifierId);
            if (line) line.freeQuantity += 1;
        }
    }

    // Charge per group: tiered groups use the bundle table on charged units; others price
    // each charged unit at its (size-aware) price.
    const linesByGroup = new Map<PricingModifierGroup, PricedModifierLine[]>();
    for (const line of lineAgg.values()) {
        const group = modIndex.get(line.modifierId)?.group;
        if (!group) continue;
        const arr = linesByGroup.get(group);
        if (arr) arr.push(line);
        else linesByGroup.set(group, [line]);
    }

    let total = 0;
    for (const [group, groupLines] of linesByGroup) {
        const tiers = group.priceTiers;
        if (tiers && Object.keys(tiers).length > 0) {
            const chargedUnits = groupLines.reduce(
                (s, l) => s + Math.max(0, l.quantity - l.freeQuantity),
                0,
            );
            const groupCharge = resolveTierCharge(tiers, chargedUnits);
            const perUnit = chargedUnits > 0 ? groupCharge / chargedUnits : 0;
            for (const l of groupLines) {
                l.unitPrice = round2(perUnit);
                l.charge = round2(
                    Math.max(0, l.quantity - l.freeQuantity) * perUnit,
                );
            }
            total += groupCharge; // exact bundle total (line charges are display splits)
        } else {
            for (const l of groupLines) {
                l.charge = round2(
                    Math.max(0, l.quantity - l.freeQuantity) * l.unitPrice,
                );
                total += l.charge;
            }
        }
    }

    return { total: round2(total), lines: [...lineAgg.values()] };
}
