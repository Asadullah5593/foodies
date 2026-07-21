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

export function groupByResource(permissions: Permission[]): Map<string, Permission[]> {
  const map = new Map<string, Permission[]>();
  for (const p of permissions) {
    const key = p.resource || 'other';
    if (!map.has(key)) map.set(key, []);
    map.get(key)!.push(p);
  }
  for (const arr of map.values()) {
    arr.sort((a, b) => a.name.localeCompare(b.name));
  }
  return map;
}

export function resourceLabel(resource: string): string {
  return resource
    .split(/[-_]/)
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase())
    .join(' ');
}
