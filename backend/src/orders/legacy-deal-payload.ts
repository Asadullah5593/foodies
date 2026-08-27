import { Logger } from '@nestjs/common';

/**
 * Translate the deal shape the SHIPPED consumer app sends into the one the
 * server understands.
 *
 * The build in the store sends a deal as an ordinary line carrying a
 * `deal_items` array:
 *
 *     { menu_item_id: 2514, quantity: 1, variant_id: null,
 *       deal_items: [ { slot_index, choice_item_id, variant_id, modifiers } ] }
 *
 * The server expects:
 *
 *     { deal_menu_item_id: 2514, quantity: 1,
 *       components: [ { slot_index, menu_item_id, variant_id, modifiers } ] }
 *
 * Every field is already there — `choice_item_id` is the chosen item and
 * `menu_item_id` is the deal root. It is a rename, not missing data, which is
 * why this can be fixed here instead of waiting on a store release.
 *
 * This is a SHIM with an end date. Each legacy line is logged, so the day those
 * logs stop is the day the last old build is gone and this file can be deleted.
 *
 * Deliberately NOT merging the top-level `deals[]` array the app also sends:
 * across every captured request it was a duplicate of a deal already present in
 * `items[]`, so merging would charge the customer twice. It is ignored.
 *
 * The plain-deal guard stays exactly as it is. A line this function converts
 * arrives as a proper deal and passes the guard on its own merits; anything it
 * does not recognise still gets refused rather than priced at zero.
 */

const logger = new Logger('LegacyDealPayload');

type LegacyComponent = {
    slot_index?: number;
    choice_item_id?: number;
    menu_item_id?: number;
    variant_id?: number | null;
    quantity?: number;
    modifiers?: unknown[];
    addons?: unknown[];
};

type Line = {
    menu_item_id?: number;
    deal_menu_item_id?: number;
    deal_items?: LegacyComponent[];
    components?: unknown[];
    quantity?: number;
    variant_id?: number | null;
    [k: string]: unknown;
};

export type NormalizeResult = { items: Line[]; legacyLines: number };

/** True when this line is the shipped app's legacy deal shape. */
export function isLegacyDealLine(line: Line): boolean {
    return Array.isArray(line?.deal_items) && line.deal_items.length > 0;
}

function convert(line: Line): Line {
    const root = line.deal_menu_item_id ?? line.menu_item_id;
    const components = (line.deal_items ?? []).map((d) => ({
        slot_index: d.slot_index,
        // `choice_item_id` is what the customer picked in this slot; fall back
        // to menu_item_id so a half-migrated build still resolves.
        menu_item_id: d.choice_item_id ?? d.menu_item_id,
        // Size matters: a slot with allowed_size_keys refuses a component with
        // no variant, so null must not be forwarded as a value.
        ...(d.variant_id != null ? { variant_id: d.variant_id } : {}),
        ...(d.quantity != null ? { quantity: d.quantity } : {}),
        ...(Array.isArray(d.modifiers) && d.modifiers.length
            ? { modifiers: d.modifiers }
            : {}),
        ...(Array.isArray(d.addons) && d.addons.length
            ? { addons: d.addons }
            : {}),
    }));

    const out: Line = { ...line, deal_menu_item_id: root, components };
    // Both must go: menu_item_id would make it look like a plain line (the very
    // thing the guard refuses), and deal_items is now redundant.
    delete out.menu_item_id;
    delete out.deal_items;
    // The deal root carries no variant of its own; the slots do.
    delete out.variant_id;
    return out;
}

/**
 * Rewrite legacy deal lines in place. Returns the new items array and how many
 * lines were converted, so callers can log it.
 */
export function normalizeLegacyDealLines(items: unknown): NormalizeResult {
    if (!Array.isArray(items)) return { items: [], legacyLines: 0 };
    let legacyLines = 0;
    const out = items.map((raw) => {
        const line = raw as Line;
        if (!isLegacyDealLine(line)) return line;
        legacyLines += 1;
        return convert(line);
    });
    return { items: out, legacyLines };
}

/**
 * Apply the shim to a request body, in place. Safe to call on any body — a
 * request that already uses the current shape is returned untouched.
 */
export function normalizeOrderBody<T extends { items?: unknown }>(
    body: T,
    route: string,
): T {
    if (!body || !Array.isArray(body.items)) return body;
    const { items, legacyLines } = normalizeLegacyDealLines(body.items);
    if (legacyLines > 0) {
        body.items = items;
        logger.log(
            `legacy deal payload on ${route}: converted ${legacyLines} line(s). ` +
                `Delete this shim once these stop appearing.`,
        );
    }
    return body;
}
