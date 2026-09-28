import { canonicalEntityType } from './activity-log.subject';

/**
 * What the filter dropdowns offer.
 *
 * Each list is what EXISTS — the tenant's branches, brands, roles and staff —
 * merged with what the log has seen. Built from the log alone, every list was
 * empty wherever the log was: a new install, an environment with capture
 * switched off, and (for branch and brand) every row written before rows
 * carried a place. The log still contributes what the tables no longer hold:
 * a user since deleted, a role since renamed away.
 */

/**
 * Every area a row can be filed under — deriveActionGroup's buckets, the
 * beacon's `client` and the writer's own `audit` rows — in the order a reader
 * looks for them.
 */
export const KNOWN_AREAS = [
    'orders',
    'menu',
    'offers',
    'shifts',
    'inventory',
    'reports',
    'access',
    'auth',
    'client',
    'audit',
    'other',
] as const;

/**
 * Record types worth offering before any have been logged, in the canonical
 * spelling rows are stored under (see canonicalEntityType).
 */
export const COMMON_RECORD_TYPES = [
    'order',
    'menu_item',
    'category',
    'deal',
    'discount',
    'customer',
    'shift',
    'role',
    'user',
    'branch',
    'brand',
] as const;

export interface PlaceOption {
    id: number;
    name: string;
    /** Absent when only the log knows the place — its state is unknown. */
    is_active?: boolean;
}

export interface PersonOption {
    actor_user_id: number;
    actor_label: string;
    /** Absent when only the log knows the person — its state is unknown. */
    is_active?: boolean;
}

export interface RoleOption {
    name: string;
    /**
     * Every role slug going by this name. Two roles can share a name — a
     * tenant's own "Cashier" beside the built-in one — and a reader asking for
     * "Cashier" means both, so one option matches either.
     */
    slugs: string[];
}

const byName = <T>(items: T[], name: (item: T) => string): T[] =>
    items.sort((a, b) =>
        name(a).localeCompare(name(b), undefined, { sensitivity: 'base' }),
    );

/** Branches or brands: today's records under today's names, then log-only ones. */
export function mergePlaces(
    current: Array<{ id: number; name: string | null; is_active?: boolean }>,
    seen: Array<{ id: number; name: string | null }>,
): PlaceOption[] {
    const byId = new Map<number, PlaceOption>();
    for (const place of current) {
        const id = Number(place.id);
        byId.set(id, {
            id,
            name: place.name?.trim() || `#${id}`,
            is_active: place.is_active !== false,
        });
    }
    for (const place of seen) {
        const id = Number(place.id);
        if (!byId.has(id)) {
            byId.set(id, { id, name: place.name?.trim() || `#${id}` });
        }
    }
    return byName([...byId.values()], (p) => p.name);
}

/**
 * Staff under their current names, then anyone the log names who is no
 * longer on the list — a deleted account's actions still have to be findable.
 */
export function mergePeople(
    current: Array<{ id: number; name: string | null; status?: string | null }>,
    seen: Array<{ actor_user_id: number; actor_label: string | null }>,
): PersonOption[] {
    const byId = new Map<number, PersonOption>();
    for (const person of current) {
        const id = Number(person.id);
        byId.set(id, {
            actor_user_id: id,
            actor_label: person.name?.trim() || `user#${id}`,
            is_active: (person.status ?? 'active') === 'active',
        });
    }
    for (const actor of seen) {
        const id = Number(actor.actor_user_id);
        if (!byId.has(id)) {
            byId.set(id, {
                actor_user_id: id,
                actor_label: actor.actor_label?.trim() || `user#${id}`,
            });
        }
    }
    return byName([...byId.values()], (p) => p.actor_label);
}

/**
 * One option per role NAME. Each slug is named as the role is named today, or
 * as the log last saw it; slugs sharing a name then fold into one option.
 * The filter still matches on slugs, so a renamed role keeps its history.
 */
export function mergeRoles(
    current: Array<{ slug: string; name: string | null }>,
    seen: Array<{ slug: string; name: string | null }>,
): RoleOption[] {
    const nameBySlug = new Map<string, string>();
    for (const role of [...current, ...seen]) {
        if (role.slug && !nameBySlug.has(role.slug)) {
            nameBySlug.set(role.slug, role.name?.trim() || role.slug);
        }
    }
    const byRoleName = new Map<string, RoleOption>();
    for (const [slug, name] of nameBySlug) {
        const key = name.toLowerCase();
        const option = byRoleName.get(key);
        if (option) option.slugs.push(slug);
        else byRoleName.set(key, { name, slugs: [slug] });
    }
    return byName([...byRoleName.values()], (r) => r.name);
}

/** `"cashier, pos_cashier"` → `['cashier', 'pos_cashier']`, bounded. */
export function parseRoleSlugs(value: string | null | undefined): string[] {
    return [
        ...new Set(
            (value ?? '')
                .split(',')
                .map((slug) => slug.trim())
                .filter((slug) => slug !== '' && slug.length <= 100),
        ),
    ].slice(0, 20);
}

/** The known areas in reading order, then anything newer the log has seen. */
export function mergeAreas(seen: string[]): string[] {
    const known: readonly string[] = KNOWN_AREAS;
    const extra = seen
        .filter((group) => group && !known.includes(group))
        .sort();
    return [...known, ...new Set(extra)];
}

/** Common record types plus every type the log has seen, one spelling each. */
export function mergeRecordTypes(seen: string[]): string[] {
    const types = new Set<string>(COMMON_RECORD_TYPES);
    for (const raw of seen) {
        const canonical = canonicalEntityType(raw);
        if (canonical) types.add(canonical);
    }
    return [...types].sort();
}
