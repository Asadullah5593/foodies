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
    {
        // Reads are needed by brand-scoped staff (menu dropdowns, shifts,
        // branch-user pages); writes are guarded per-method with
        // branches:manage in the controllers.
        prefix: '/admin/brands',
        permissionNames: [
            Permissions.BRANCHES_MANAGE,
            Permissions.MENU_MANAGE,
            Permissions.BRANCH_MENU_MANAGE,
            Permissions.SHIFTS_MANAGE,
        ],
    },
    {
        prefix: '/admin/branches',
        permissionNames: [
            Permissions.BRANCHES_MANAGE,
            Permissions.BRANCH_USERS_ASSIGN,
            Permissions.BRANCH_MENU_MANAGE,
            Permissions.SHIFTS_MANAGE,
        ],
    },
    { prefix: '/admin/users', permissionNames: [Permissions.USERS_MANAGE] },
    {
        prefix: '/admin/categories',
        permissionNames: [
            Permissions.MENU_MANAGE,
            Permissions.BRANCH_MENU_MANAGE,
            Permissions.MENU_VIEW,
            Permissions.CATEGORIES_VIEW,
        ],
    },
    {
        prefix: '/admin/menu-items',
        permissionNames: [
            Permissions.MENU_MANAGE,
            Permissions.BRANCH_MENU_MANAGE,
            Permissions.MENU_VIEW,
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
            Permissions.MENU_VIEW,
            Permissions.VARIANTS_VIEW,
        ],
    },
    {
        prefix: '/admin/menu-addons',
        permissionNames: [
            Permissions.MENU_MANAGE,
            Permissions.BRANCH_MENU_MANAGE,
            Permissions.MENU_VIEW,
            Permissions.ADDONS_VIEW,
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
        // `apply` is listed so a cashier holding only the till right can reach
        // /for-till; the per-method guards enforce which right each route needs.
        prefix: '/admin/staff-discounts',
        permissionNames: [
            Permissions.STAFF_DISCOUNTS_VIEW,
            Permissions.STAFF_DISCOUNTS_APPLY,
        ],
    },
    {
        prefix: '/admin/loyalty-settings',
        permissionNames: [Permissions.LOYALTY_MANAGE],
    },
    {
        prefix: '/admin/delivery-tiers',
        permissionNames: [Permissions.DELIVERIES_MANAGE],
    },
    {
        prefix: '/admin/customers',
        permissionNames: [Permissions.CUSTOMERS_MANAGE],
    },
    { prefix: '/admin/roles', permissionNames: [Permissions.ROLES_MANAGE] },
    {
        prefix: '/admin/notification-settings',
        permissionNames: [Permissions.NOTIFICATIONS_MANAGE],
    },
    { prefix: '/admin/orders', permissionNames: [Permissions.ORDERS_VIEW] },
    {
        prefix: '/admin/riders',
        permissionNames: [Permissions.DELIVERIES_VIEW, Permissions.ORDERS_VIEW],
    },
    {
        prefix: '/admin/deliveries',
        permissionNames: [Permissions.DELIVERIES_VIEW],
    },
    {
        // Owner/GM only: link riders to brands + approve share requests.
        // Longer, more specific prefix wins over /admin/rider-hrm below.
        prefix: '/admin/rider-sharing',
        permissionNames: [Permissions.RIDER_SHARING_MANAGE],
    },
    {
        // Brand-admin facing: browse the pool + submit/cancel share requests.
        prefix: '/admin/rider-hrm/share-requests',
        permissionNames: [Permissions.RIDER_SHARE_REQUEST],
    },
    {
        prefix: '/admin/rider-hrm/pool-riders',
        permissionNames: [Permissions.RIDER_SHARE_REQUEST],
    },
    {
        // Read-only supervisor surface: its own permission, independent of the
        // rest of Rider HRM. Longer, more specific prefix wins over the
        // /admin/rider-hrm gate below.
        prefix: '/admin/rider-hrm/supervisor',
        permissionNames: [Permissions.RIDER_SUPERVISOR_VIEW],
    },
    {
        // Salary data — its own rider-HRM permissions, not the broad
        // /admin/rider-hrm gate (shifts:manage till staff must not pass).
        prefix: '/admin/rider-hrm/profiles',
        permissionNames: [
            Permissions.RIDER_HRM_VIEW,
            Permissions.RIDER_PROFILES_EDIT,
        ],
    },
    {
        prefix: '/admin/rider-hrm',
        permissionNames: [
            Permissions.DELIVERIES_VIEW,
            Permissions.SHIFTS_MANAGE,
        ],
    },
    {
        prefix: '/admin/rider-ops',
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
        // Brand-admin facing: read own brand stock across branches. Longer,
        // more specific prefix wins over /admin/inventory above. Brand-lock
        // (brandId ∈ allowedBrandIds) is enforced in the controller.
        prefix: '/admin/inventory/brands',
        permissionNames: [
            Permissions.INVENTORY_VIEW_BRAND,
            Permissions.INVENTORY_VIEW,
        ],
    },
    {
        // Brand-admin facing: request transfers in (destination side) and
        // approve/dispatch pulls FROM a bucket they control (source side).
        // Per-bucket authority is enforced in InventoryTransferService.
        prefix: '/admin/inventory/transfers',
        permissionNames: [
            Permissions.INVENTORY_TRANSFER_REQUEST,
            Permissions.INVENTORY_TRANSFER_APPROVE,
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
    {
        prefix: '/admin/banners',
        permissionNames: [Permissions.CMS_MANAGE],
    },
    {
        prefix: '/admin/promotions',
        permissionNames: [Permissions.PROMOTIONS_MANAGE],
    },
    {
        // Employee HRM settings — designations and (from Phase 2) the policy
        // tables every calculation reads. More specific than /admin/hr below.
        prefix: '/admin/hr/settings',
        permissionNames: [Permissions.HR_SETTINGS_MANAGE],
    },
    {
        prefix: '/admin/hr/audit',
        permissionNames: [Permissions.HR_AUDIT_VIEW],
    },
    {
        prefix: '/admin/hr',
        permissionNames: [Permissions.EMPLOYEES_VIEW],
    },
    { prefix: '/pos', permissionNames: [Permissions.ORDERS_CREATE] },
    {
        prefix: '/kitchen/back',
        permissionNames: [Permissions.BACK_KITCHEN_VIEW],
    },
    {
        prefix: '/kitchen',
        permissionNames: [
            Permissions.CUSTOMER_DISPLAY_VIEW,
            Permissions.CUSTOMER_DISPLAY_UPDATE,
        ],
    },
];
