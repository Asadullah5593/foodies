import { Permissions } from '../roles/permissions.dto';

/**
 * Map admin path prefixes to the permission(s) required to access them.
 * User must have at least one of the listed permissions (from any of their roles).
 * Used by RoleAccessGuard. Keep in sync with frontend PATH_PERMISSIONS.
 */
export const PATH_REQUIRED_PERMISSIONS: Array<{
    prefix: string;
    permissionNames: string[];
}> = [
    {
        prefix: '/admin/dashboard',
        permissionNames: [Permissions.DASHBOARD_VIEW],
    },
    {
        prefix: '/admin/business-settings',
        permissionNames: [Permissions.BUSINESS_SETTINGS_ACCESS],
    },
    { prefix: '/admin/brands', permissionNames: [Permissions.BRANCHES_MANAGE] },
    {
        prefix: '/admin/branches',
        permissionNames: [Permissions.BRANCHES_MANAGE],
    },
    { prefix: '/admin/users', permissionNames: [Permissions.USERS_MANAGE] },
    {
        prefix: '/admin/categories',
        permissionNames: [
            Permissions.MENU_MANAGE,
            Permissions.BRANCH_MENU_MANAGE,
        ],
    },
    {
        prefix: '/admin/menu-items',
        permissionNames: [
            Permissions.MENU_MANAGE,
            Permissions.BRANCH_MENU_MANAGE,
        ],
    },
    {
        prefix: '/admin/deals',
        permissionNames: [
            Permissions.DEALS_VIEW,
            Permissions.DEALS_CREATE,
            Permissions.DEALS_EDIT,
            Permissions.DEALS_DELETE,
        ],
    },
    {
        prefix: '/admin/menu-variants',
        permissionNames: [
            Permissions.MENU_MANAGE,
            Permissions.BRANCH_MENU_MANAGE,
        ],
    },
    {
        prefix: '/admin/menu-addons',
        permissionNames: [
            Permissions.MENU_MANAGE,
            Permissions.BRANCH_MENU_MANAGE,
        ],
    },
    {
        prefix: '/admin/branch-menu-items',
        permissionNames: [Permissions.BRANCH_MENU_MANAGE],
    },
    {
        prefix: '/admin/branch-users',
        permissionNames: [Permissions.BRANCH_USERS_ASSIGN],
    },
    {
        prefix: '/admin/discounts',
        permissionNames: [Permissions.DISCOUNTS_MANAGE],
    },
    {
        prefix: '/admin/loyalty-settings',
        permissionNames: [Permissions.LOYALTY_MANAGE],
    },
    {
        prefix: '/admin/customers',
        permissionNames: [Permissions.CUSTOMERS_MANAGE],
    },
    { prefix: '/admin/roles', permissionNames: [Permissions.ROLES_MANAGE] },
    { prefix: '/admin/orders', permissionNames: [Permissions.ORDERS_VIEW] },
    {
        prefix: '/admin/riders',
        permissionNames: [
            Permissions.DELIVERIES_VIEW,
            Permissions.ORDERS_VIEW,
        ],
    },
    {
        prefix: '/admin/deliveries',
        permissionNames: [Permissions.DELIVERIES_VIEW],
    },
    { prefix: '/admin/shifts', permissionNames: [Permissions.SHIFTS_MANAGE] },
    { prefix: '/admin/reports', permissionNames: [Permissions.REPORTS_VIEW] },
    {
        prefix: '/admin/inventory',
        permissionNames: [
            Permissions.INVENTORY_VIEW,
            Permissions.INVENTORY_RECEIVE,
            Permissions.INVENTORY_ADJUST,
            Permissions.INVENTORY_WASTE,
            Permissions.INVENTORY_STOCKTAKE,
            Permissions.INVENTORY_TRANSFER,
        ],
    },
    {
        prefix: '/admin/procurement',
        permissionNames: [
            Permissions.PROCUREMENT_PR_CREATE,
            Permissions.PROCUREMENT_PR_APPROVE,
            Permissions.PROCUREMENT_PO_MANAGE,
            Permissions.PROCUREMENT_GRN_POST,
        ],
    },
    {
        prefix: '/admin/procurement/prs',
        permissionNames: [
            Permissions.PROCUREMENT_PR_CREATE,
            Permissions.PROCUREMENT_PR_APPROVE,
        ],
    },
    {
        prefix: '/admin/procurement/pos',
        permissionNames: [Permissions.PROCUREMENT_PO_MANAGE],
    },
    {
        prefix: '/admin/procurement/grns',
        permissionNames: [Permissions.PROCUREMENT_GRN_POST],
    },
    {
        prefix: '/admin/recipes',
        permissionNames: [Permissions.RECIPES_MANAGE, Permissions.COSTING_VIEW],
    },
    { prefix: '/pos', permissionNames: [Permissions.ORDERS_CREATE] },
    {
        prefix: '/kitchen/back',
        permissionNames: [Permissions.BACK_KITCHEN_VIEW],
    },
    {
        prefix: '/kitchen',
        permissionNames: [Permissions.KITCHEN_VIEW, Permissions.KITCHEN_UPDATE],
    },
];
