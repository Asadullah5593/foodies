/**
 * Path → permission map for nav and route access. Must stay in sync with backend path-permissions.
 * Access is controlled by roles assigned in the Roles module (super admin / tenant admin).
 */
export const PATH_PERMISSIONS: Record<string, string[] | null> = {
  '/admin/dashboard': ['dashboard:view'],
  '/admin/button-demo': ['dashboard:view'],
  '/admin/business-settings': ['business-settings:access'],
  '/admin/brands': ['branches:manage'],
  '/admin/branches': ['branches:manage'],
  '/admin/users': ['users:manage'],
  '/admin/categories': ['menu:manage', 'branch-menu:manage'],
  '/admin/menu-items': ['menu:manage', 'branch-menu:manage'],
  '/admin/deals': ['deals:view', 'deals:create', 'deals:edit', 'deals:delete'],
  '/admin/menu-variants': ['menu:manage', 'branch-menu:manage'],
  '/admin/menu-addons': ['menu:manage', 'branch-menu:manage'],
  '/admin/modifiers': ['menu:manage', 'branch-menu:manage'],
  '/admin/branch-menu-items': ['branch-menu:manage'],
  '/admin/branch-users': ['branch-users:assign'],
  '/admin/discounts': ['discounts:manage'],
  '/admin/loyalty-settings': ['loyalty:manage'],
  '/admin/customers': ['customers:manage'],
  '/admin/roles': ['roles:manage'],
  '/admin/orders': ['orders:view'],
  '/admin/deliveries': ['deliveries:view'],
  '/admin/shifts': ['shifts:manage'],
  '/admin/reports': ['reports:view'],
  '/admin/inventory': [
    'inventory:view',
    'inventory:receive',
    'inventory:adjust',
    'inventory:waste',
    'inventory:stocktake',
    'inventory:transfer',
  ],
  '/admin/procurement': [
    'procurement:pr:create',
    'procurement:pr:approve',
    'procurement:po:manage',
    'procurement:grn:post',
  ],
  '/admin/procurement/prs': [
    'procurement:pr:create',
    'procurement:pr:approve',
  ],
  '/admin/procurement/pos': ['procurement:po:manage'],
  '/admin/procurement/grns': ['procurement:grn:post'],
  '/admin/recipes': ['recipes:manage', 'costing:view'],
  '/pos/orders': ['orders:create'],
  '/kitchen': ['kitchen:view', 'kitchen:update'],
  '/kitchen/back': ['back-kitchen:view'],
  '/foh/packing': ['kitchen:view', 'kitchen:update'],
};

export type UserForAccess = {
  is_super_admin?: boolean;
  tenant_id?: number | null;
  permissions?: string[];
  is_rider?: boolean;
} | null;

/** True if user should be treated as rider (only deliveries): backend flag or only has deliveries:view */
export function isRiderForAccess(user: UserForAccess): boolean {
  if (!user) return false;
  if (user.is_rider === true) return true;
  const perms = user.permissions ?? [];
  return perms.length > 0 && perms.every((p) => p === 'deliveries:view');
}

function getRequiredPermissionsForPath(path: string): string[] | null | undefined {
  // Match by longest prefix (mirrors backend RoleAccessGuard prefix matching)
  const keys = Object.keys(PATH_PERMISSIONS);
  const matches = keys
    .filter((k) => path === k || path.startsWith(k + '/'))
    .sort((a, b) => b.length - a.length);
  const best = matches[0];
  return best ? PATH_PERMISSIONS[best] : undefined;
}

export function canAccessPath(user: UserForAccess, path: string): boolean {
  if (!user) return false;
  if (user.is_super_admin) return true;
  // Riders only have access to the rider app (deliveries); no admin modules
  if (isRiderForAccess(user)) return path === '/rider' || path.startsWith('/rider/');
  if (path === '/admin/tenants') return false;
  const perms = getRequiredPermissionsForPath(path);
  if (perms === null || !perms?.length) return false;
  if (!perms?.length) return false;
  return perms.some((p) => user.permissions?.includes(p));
}

/** Ordered paths to try as landing page (first one user can access is used after login / default redirect). */
const ORDERED_LANDING_PATHS = [
  '/admin/dashboard',
  '/admin/tenants',
  '/admin/business-settings',
  '/admin/brands',
  '/admin/branches',
  '/admin/users',
  '/admin/categories',
  '/admin/menu-items',
  '/admin/deals',
  '/admin/menu-variants',
  '/admin/menu-addons',
  '/admin/modifiers',
  '/admin/branch-menu-items',
  '/admin/branch-users',
  '/admin/discounts',
  '/admin/loyalty-settings',
  '/admin/customers',
  '/admin/roles',
  '/admin/orders',
  '/admin/deliveries',
  '/admin/shifts',
  '/admin/reports',
  '/admin/inventory',
  '/admin/procurement',
  '/admin/recipes',
  '/pos/orders',
  '/kitchen',
  '/kitchen/back',
  '/foh/packing',
];

/** First path the user can access; used as post-login and default redirect. Riders get /rider. */
export function getDefaultLandingPath(user: UserForAccess): string {
  if (!user) return '/admin/dashboard';
  if (isRiderForAccess(user)) return '/rider';
  for (const path of ORDERED_LANDING_PATHS) {
    if (canAccessPath(user, path)) return path;
  }
  return '/admin/dashboard';
}
