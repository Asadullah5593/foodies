import { singularise } from './activity-log.policy';

/**
 * Naming and placing the record a row is about.
 *
 * Rows reach the log from three sources that never agreed on a spelling: a
 * service says `menu_item`, a permission says `menu-items`, a controller name
 * says `menu`. Left alone, one record's history is split across several
 * `entity_type`s and no filter finds all of it.
 */

/** `menu-items` / `MenuItems` / `menu_item` → `menu_item` */
export function canonicalEntityType(
    value: string | null | undefined,
): string | null {
    const cleaned = (value ?? '')
        .trim()
        .replace(/([a-z])([A-Z])/g, '$1_$2')
        .toLowerCase()
        .replace(/[\s-]+/g, '_')
        .replace(/[^a-z0-9_]/g, '');
    if (!cleaned) return null;
    const parts = cleaned.split('_').filter(Boolean);
    if (!parts.length) return null;
    parts[parts.length - 1] = singularise(parts[parts.length - 1]);
    return parts.join('_').slice(0, 64);
}

/**
 * Every spelling an entity type was ever stored under. The table is
 * append-only, so rows written before the spelling was settled keep theirs and
 * have to be matched as they are.
 */
export function entityTypeVariants(value: string): string[] {
    const canonical = canonicalEntityType(value);
    if (!canonical) return [value];
    const plural = canonical.endsWith('y')
        ? `${canonical.slice(0, -1)}ies`
        : /(ch|sh|ss|x|z)$/.test(canonical)
          ? `${canonical}es`
          : `${canonical}s`;
    const variants = new Set<string>([value]);
    for (const form of [canonical, plural]) {
        variants.add(form);
        variants.add(form.replace(/_/g, '-'));
    }
    return [...variants];
}

const positiveInt = (value: unknown): number | null => {
    const n =
        typeof value === 'number'
            ? value
            : typeof value === 'string' && /^\d{1,9}$/.test(value.trim())
              ? Number(value.trim())
              : NaN;
    return Number.isInteger(n) && n > 0 ? n : null;
};

const pick = (source: unknown, keys: string[]): number | null => {
    if (!source || typeof source !== 'object' || Array.isArray(source)) {
        return null;
    }
    const record = source as Record<string, unknown>;
    for (const key of keys) {
        const found = positiveInt(record[key]);
        if (found != null) return found;
    }
    return null;
};

const BRANCH_KEYS = ['branch_id', 'branchId'];
const BRAND_KEYS = ['brand_id', 'brandId'];

/**
 * Where a request was aimed, read from the request itself: route params, then
 * the query, then the body, then what the response reported.
 */
export function scopeFromRequest(parts: {
    params?: unknown;
    query?: unknown;
    body?: unknown;
    response?: unknown;
}): { branchId: number | null; brandId: number | null } {
    const sources = [parts.params, parts.query, parts.body, parts.response];
    let branchId: number | null = null;
    let brandId: number | null = null;
    for (const source of sources) {
        branchId ??= pick(source, BRANCH_KEYS);
        brandId ??= pick(source, BRAND_KEYS);
    }
    return { branchId, brandId };
}

/**
 * The one branch or brand a person is confined to, if there is exactly one.
 *
 * A cashier who works at a single branch did what they did AT that branch, so
 * it is a truthful answer to "where" when the request itself names none. Staff
 * with several branches, or all of them, get no guess.
 */
export function soleId(ids: unknown): number | null {
    if (!Array.isArray(ids) || ids.length !== 1) return null;
    return positiveInt(ids[0]);
}

/** The name a response gave the record it returned. */
export function labelFromResponse(
    meta: Record<string, unknown> | null | undefined,
): string | null {
    if (!meta) return null;
    for (const key of ['name', 'title', 'order_number', 'code']) {
        const v = meta[key];
        if (typeof v === 'string' && v.trim()) return v.trim().slice(0, 200);
        if (typeof v === 'number') return String(v);
    }
    return null;
}
