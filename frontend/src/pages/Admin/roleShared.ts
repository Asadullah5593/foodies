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
  /**
   * Ceiling on a staff discount this role may grant at the till; null = no
   * ceiling of that kind (the tenant offer cap still binds). Read back
   * camelCase like orderHistoryDays, but as a STRING — they are numeric
   * columns and pg returns decimals as strings. Written as
   * `max_staff_discount_percent` / `_amount`.
   */
  maxStaffDiscountPercent?: number | string | null;
  maxStaffDiscountAmount?: number | string | null;
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

/**
 * Form values for a role's staff-discount ceilings.
 *
 * Two traps this exists to keep straight, both of which silently blank the
 * edit form if got wrong: the API returns these camelCase (they are read off
 * the entity, unlike the snake_case keys they are WRITTEN with), and they are
 * numeric columns, so pg hands them back as strings like "5.00". Blank means
 * no ceiling; "0" is a real value meaning this role may grant nothing, so it
 * must survive as "0" rather than collapsing to blank.
 */
export function ceilingFieldValues(role: Role | null | undefined): {
  percent: string;
  amount: string;
} {
  const toField = (v: number | string | null | undefined): string =>
    v == null || v === '' ? '' : String(Number(v));
  return {
    percent: toField(role?.maxStaffDiscountPercent),
    amount: toField(role?.maxStaffDiscountAmount),
  };
}

/**
 * A permission and the permissions that NARROW it. `orders:view:own-pos-only`
 * only means anything alongside `orders:view`, so the form reads far better
 * with it indented under its parent than sorted alphabetically among peers.
 *
 * Parentage is derived from the name, not a hand-kept list: a permission whose
 * name is another's plus one `:segment` is that one's child. New markers nest
 * themselves.
 */
export interface PermissionNode {
  permission: Permission;
  children: Permission[];
}

export function nestPermissions(perms: Permission[]): PermissionNode[] {
  const byName = new Map(perms.map((p) => [p.name, p]));
  const parentOf = (p: Permission): Permission | null => {
    const cut = p.name.lastIndexOf(':');
    if (cut <= 0) return null;
    return byName.get(p.name.slice(0, cut)) ?? null;
  };
  const nodes: PermissionNode[] = [];
  const index = new Map<string, PermissionNode>();
  for (const p of perms) {
    if (parentOf(p)) continue;
    const node = { permission: p, children: [] as Permission[] };
    nodes.push(node);
    index.set(p.name, node);
  }
  for (const p of perms) {
    const parent = parentOf(p);
    if (!parent) continue;
    // An orphan (parent not granted to this catalog view) stays top-level so it
    // can never become unreachable.
    const node = index.get(parent.name);
    if (node) node.children.push(p);
    else nodes.push({ permission: p, children: [] });
  }
  return nodes;
}
