/**
 * Central DTO for permission names. Each module in the system has a corresponding
 * permission. Super admin / tenant admin assigns these to roles via the Roles module;
 * access is then determined purely by whether the user's role(s) have the required permission.
 */
export const Permissions = {
    // Dashboard (required for any admin nav; no open-ended modules)
    DASHBOARD_VIEW: 'dashboard:view',
    // Orders & POS
    ORDERS_CREATE: 'orders:create',
    ORDERS_VIEW: 'orders:view',
    ORDERS_VOID: 'orders:void',
    // Discounts (apply at POS vs manage in admin)
    DISCOUNTS_APPLY: 'discounts:apply',
    DISCOUNTS_MANAGE: 'discounts:manage',
    // Reports
    REPORTS_VIEW: 'reports:view',
    // Branches & brands
    BRANCHES_MANAGE: 'branches:manage',
    ALL_BRANCHES_ACCESS: 'all-branches:access',
    // Branch-level
    BRANCH_MENU_MANAGE: 'branch-menu:manage',
    BRANCH_USERS_ASSIGN: 'branch-users:assign',
    // Kitchen (Kitchen Display = main KDS; Back Kitchen = brand-specific back kitchen)
    KITCHEN_VIEW: 'kitchen:view',
    KITCHEN_UPDATE: 'kitchen:update',
    BACK_KITCHEN_VIEW: 'back-kitchen:view',
    // Module-level (one permission per admin module)
    BUSINESS_SETTINGS_ACCESS: 'business-settings:access',
    USERS_MANAGE: 'users:manage',
    MENU_MANAGE: 'menu:manage',
    CUSTOMERS_MANAGE: 'customers:manage',
    ROLES_MANAGE: 'roles:manage',
    DELIVERIES_VIEW: 'deliveries:view',
    SHIFTS_MANAGE: 'shifts:manage',
    LOYALTY_MANAGE: 'loyalty:manage',
    // Deals (menu items with deal_components)
    DEALS_VIEW: 'deals:view',
    DEALS_CREATE: 'deals:create',
    DEALS_EDIT: 'deals:edit',
    DEALS_DELETE: 'deals:delete',
} as const;

export type PermissionName = (typeof Permissions)[keyof typeof Permissions];
