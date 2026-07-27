export interface Permission {
  id: number;
  name: string;
  resource: string;
  action: string;
  description?: string | null;
}

export interface Role {
  id: number;
  name: string;
  slug: string;
  tenant_id?: number | null;
  /**
   * Days of order history this role may read; null = unlimited. Read back from
   * the API as camelCase; written as `order_history_days` (same split as
   * `permissions` / `permission_ids`).
   */
  orderHistoryDays?: number | null;
  permissions?: Permission[];
}

export const SUPER_ADMIN_SLUG = 'super_admin';

/**
 * Resource families that are shown as ONE section instead of one per resource.
 * Rider HRM spreads across eight resources (rider-attendance, rider-comp-plans,
 * rider-hrm, rider-payroll, rider-profiles, rider-share, rider-sharing,
 * rider-supervisor) which read as eight near-identical headings; collapsing
 * them into a single "Rider" block keeps the permission list scannable.
 *
 * Add a prefix here to group another family. Grouping is presentational only —
 * each permission keeps its own `resource`, so the Permissions table still
 * shows the exact resource (see resourceLabel).
 */
const GROUPED_RESOURCE_PREFIXES = ['rider'] as const;

/** The section a resource belongs to: its family, else the resource itself. */
export function resourceGroupKey(resource: string): string {
  const r = resource || 'other';
  const family = GROUPED_RESOURCE_PREFIXES.find(
    (prefix) => r === prefix || r.startsWith(`${prefix}-`),
  );
  return family ?? r;
}

export function groupByResource(permissions: Permission[]): Map<string, Permission[]> {
  const map = new Map<string, Permission[]>();
  for (const p of permissions) {
    const key = resourceGroupKey(p.resource);
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  for (const arr of map.values()) {
    // Name order keeps a family's own actions together inside a merged section
    // (…comp-plans:* then …payroll:* then …profiles:*).
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

/**
 * Human label for one resource, e.g. 'rider-payroll' → 'Rider Payroll'.
 * Deliberately exact: the Permissions table lists it per permission, so this
 * must NOT collapse families the way resourceGroupKey does. Passing a group key
 * ('rider') naturally yields the section heading ('Rider').
 */
export function resourceLabel(resource: string): string {
  return resource
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}
