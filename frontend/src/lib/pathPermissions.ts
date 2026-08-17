/**
 * Path → permission map for nav and route access. Must stay in sync with backend path-permissions.
 * Access is controlled by roles assigned in the Roles module (super admin / tenant admin).
 */
export const PATH_PERMISSIONS: Record<string, string[] | null> = {
  '/admin/dashboard': ['dashboard:view'],
  '/admin/button-demo': ['dashboard:view'],
  '/admin/business-settings': ['business-settings:access'],
  // Brand admins (menu:manage, brand-locked) see only their own brand and
  // can configure its rules (delivery fee, logo); create/delete stays
  // owner-level (enforced server-side).
  '/admin/brands': ['branches:manage', 'menu:manage', 'brands:view'],
  '/admin/branches': ['branches:manage', 'branches:view'],
  '/admin/users': ['users:manage', 'users:view'],
  '/admin/categories': ['menu:manage', 'branch-menu:manage', 'menu:view', 'categories:view'],
  '/admin/menu-items': ['menu:manage', 'branch-menu:manage', 'menu:view'],
  '/admin/deals': ['deals:view', 'deals:create', 'deals:edit', 'deals:delete'],
  '/admin/menu-variants': ['menu:manage', 'branch-menu:manage', 'menu:view', 'variants:view'],
  '/admin/menu-addons': ['menu:manage', 'branch-menu:manage', 'menu:view', 'addons:view'],
  '/admin/modifiers': ['menu:manage', 'branch-menu:manage', 'menu:view', 'modifiers:view'],
  '/admin/branch-menu-items': ['branch-menu:manage', 'branch-menu:view'],
  '/admin/branch-users': ['branch-users:assign', 'branch-users:view'],
  '/admin/discounts': ['discounts:manage', 'discounts:view'],
  '/admin/product-promotions': ['discounts:manage', 'product-promotions:view'],
  '/admin/coupons': ['discounts:manage', 'coupons:view'],
  '/admin/campaigns': ['campaigns:manage', 'cms:manage', 'campaigns:view'],
  '/admin/offer-settings': ['campaigns:manage', 'discounts:manage', 'offer-settings:edit'],
  '/admin/bank-cards': ['discounts:manage', 'bank-cards:view'],
  // Its own right, NOT under discounts:manage — authoring offers and handing
  // out a give-away at the till are different permissions.
  '/admin/staff-discounts': ['staff-discounts:view'],
  '/admin/loyalty-settings': ['loyalty:manage', 'loyalty:view'],
  '/admin/invoice-templates': ['business-settings:access', 'invoice-templates:view'],
  '/admin/delivery-tiers': ['deliveries:manage', 'delivery-tiers:view'],
  '/admin/banners': ['cms:manage', 'banners:view'],
  '/admin/promotions': ['promotions:manage', 'promotions:view'],
  '/admin/customers': ['customers:manage', 'customers:view'],
  '/admin/roles': ['roles:manage', 'roles:view'],
  '/admin/notification-settings': ['notifications:manage', 'notifications:view'],
  '/admin/orders': ['orders:view'],
  '/admin/riders': ['deliveries:view', 'orders:view'],
  '/admin/deliveries': ['deliveries:view'],
  // More specific rider-hrm sub-paths (longest-prefix match wins).
  '/admin/rider-hrm/pool-sharing': ['rider-sharing:manage'],
  '/admin/rider-hrm/request-riders': ['rider-share:request'],
  '/admin/rider-hrm/supervisor': ['rider-supervisor:view'],
  // Salary data — needs a rider-HRM permission of its own, NOT the broad
  // any-of gate below (which shifts:manage till staff would pass).
  '/admin/rider-hrm/profiles': ['rider-hrm:view', 'rider-profiles:edit'],
  '/admin/rider-hrm': ['deliveries:view', 'shifts:manage', 'rider-hrm:view'],
  // Employee HRM. Settings need hr-settings:manage; the roster and the 360 page
  // need only employees:view, which branch managers hold. Salary data inside the
  // 360 payload is gated separately server-side by salary:view.
  '/admin/hr/settings/designations': ['hr-settings:manage', 'employees:view'],
  '/admin/hr/attendance': ['attendance:view'],
  // The station is reachable by till staff, who hold attendance:punch and
  // nothing else in HR — it must NOT sit behind employees:view.
  '/attendance': ['attendance:punch'],
  '/admin/hr/audit': ['hr-audit:view'],
  '/admin/hr': ['employees:view'],
  '/admin/rider-ops': ['deliveries:view'],
  '/admin/shifts': ['shifts:manage', 'shifts:view'],
  '/admin/reports': ['reports:view'],
  '/admin/inventory': [
    'inventory:view',
    'inventory:receive',
    'inventory:adjust',
    'inventory:waste',
    'inventory:stocktake',
    'inventory:transfer',
    'inventory-items:view',
    'uoms:view',
    'vendors:view',
  ],
  // Brand-admin facing (longest-prefix match wins over /admin/inventory).
  '/admin/inventory/brand-stock': ['inventory:view:brand', 'inventory:view'],
  '/admin/inventory/transfers': [
    'inventory:transfer:request',
    'inventory:transfer:approve',
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
  '/admin/recipes': ['recipes:manage', 'costing:view', 'recipes:view'],
  '/pos/orders': ['orders:create'],
  '/kitchen': ['customer-display:view', 'customer-display:update'],
  '/kitchen/back': ['back-kitchen:view'],
  '/foh/packing': ['customer-display:view', 'customer-display:update'],
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
  // Straight after the dashboard: till staff (cashiers, call-centre agents) have
  // no dashboard:view, and the POS is their home screen — not the admin order
  // list they would otherwise fall through to.
  '/pos/orders',
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
  '/admin/banners',
  '/admin/promotions',
  '/admin/customers',
  '/admin/roles',
  '/admin/notification-settings',
  '/admin/orders',
  '/admin/deliveries',
  '/admin/rider-hrm',
  '/admin/rider-hrm/supervisor',
  '/admin/hr/employees',
  '/admin/shifts',
  '/admin/reports',
  '/admin/inventory',
  '/admin/procurement',
  '/admin/recipes',
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
