import { Permissions } from './permissions.dto';

/**
 * Umbrella → implied granular permissions. A role holding the umbrella
 * satisfies any of the implied granular checks WITHOUT a data change, so the
 * granular-permission rollout stays strictly additive: existing roles keep
 * full module access, while new roles can be given just the granular subset.
 *
 * Only genuine "full control of this module" umbrellas belong here. Cases where
 * the legacy gate was a coarse view/action permission (orders:view →
 * update-status, inventory:view → item CRUD, shifts:manage → rider-hrm) are
 * handled by a one-time backfill in the granular-permissions migration instead,
 * so we never permanently tie "view implies write".
 */
export const PERMISSION_IMPLICATIONS: Record<string, string[]> = {
    // Holding the umbrella means holding every per-module read.
    'activity-log:view': [
        'activity-log:view:access',
        'activity-log:view:menu',
        'activity-log:view:offers',
        'activity-log:view:shifts',
        'activity-log:view:inventory',
        'activity-log:view:orders',
        'activity-log:view:auth',
        'activity-log:view:system',
    ],
    [Permissions.MENU_MANAGE]: [
        Permissions.MENU_VIEW,
        Permissions.MENU_CREATE,
        Permissions.MENU_EDIT,
        Permissions.MENU_DELETE,
        Permissions.CATEGORIES_VIEW,
        Permissions.CATEGORIES_CREATE,
        Permissions.CATEGORIES_EDIT,
        Permissions.CATEGORIES_DELETE,
        Permissions.VARIANTS_VIEW,
        Permissions.VARIANTS_CREATE,
        Permissions.VARIANTS_EDIT,
        Permissions.VARIANTS_DELETE,
        Permissions.ADDONS_VIEW,
        Permissions.ADDONS_CREATE,
        Permissions.ADDONS_EDIT,
        Permissions.ADDONS_DELETE,
        Permissions.MODIFIERS_VIEW,
        Permissions.MODIFIERS_CREATE,
        Permissions.MODIFIERS_EDIT,
        Permissions.MODIFIERS_DELETE,
    ],
    [Permissions.BRANCHES_MANAGE]: [
        Permissions.BRANDS_VIEW,
        Permissions.BRANDS_CREATE,
        Permissions.BRANDS_EDIT,
        Permissions.BRANDS_DELETE,
        Permissions.BRANDS_TOGGLE_OPEN,
        Permissions.BRANCHES_VIEW,
        Permissions.BRANCHES_CREATE,
        Permissions.BRANCHES_EDIT,
        Permissions.BRANCHES_DELETE,
    ],
    [Permissions.BRANCH_MENU_MANAGE]: [
        Permissions.BRANCH_MENU_VIEW,
        Permissions.BRANCH_MENU_EDIT,
        Permissions.BRANCH_MENU_LINK,
    ],
    [Permissions.BRANCH_USERS_ASSIGN]: [
        Permissions.BRANCH_USERS_VIEW,
        Permissions.BRANCH_USERS_REMOVE,
    ],
    [Permissions.USERS_MANAGE]: [
        Permissions.USERS_VIEW,
        Permissions.USERS_CREATE,
        Permissions.USERS_EDIT,
        Permissions.USERS_DELETE,
    ],
    [Permissions.ROLES_MANAGE]: [
        Permissions.ROLES_VIEW,
        Permissions.ROLES_CREATE,
        Permissions.ROLES_EDIT,
        Permissions.ROLES_DELETE,
    ],
    [Permissions.SHIFTS_MANAGE]: [
        Permissions.SHIFTS_VIEW,
        Permissions.SHIFTS_OPEN,
        Permissions.SHIFTS_CLOSE,
    ],
    // Override holders pass the open/close endpoint guards without needing the
    // granular grants; the reverse is deliberately NOT true (shifts:manage does
    // not imply override) so umbrella holders stay opener-only on close.
    [Permissions.SHIFTS_OVERRIDE]: [
        Permissions.SHIFTS_VIEW,
        Permissions.SHIFTS_OPEN,
        Permissions.SHIFTS_CLOSE,
    ],
    // Editing rider profiles requires reading them (GET /admin/rider-hrm/
    // profiles is guarded by rider-hrm:view) — an edit-only custom role would
    // otherwise see every salary as unset while still being able to overwrite.
    [Permissions.RIDER_PROFILES_EDIT]: [Permissions.RIDER_HRM_VIEW],
    [Permissions.BUSINESS_SETTINGS_ACCESS]: [
        Permissions.BUSINESS_SETTINGS_EDIT,
        Permissions.INVOICE_TEMPLATES_VIEW,
        Permissions.INVOICE_TEMPLATES_CREATE,
        Permissions.INVOICE_TEMPLATES_EDIT,
        Permissions.INVOICE_TEMPLATES_DELETE,
        Permissions.INVOICE_TEMPLATES_SET_DEFAULT,
    ],
    [Permissions.DISCOUNTS_MANAGE]: [
        Permissions.DISCOUNTS_VIEW,
        Permissions.DISCOUNTS_CREATE,
        Permissions.DISCOUNTS_EDIT,
        Permissions.DISCOUNTS_DELETE,
        Permissions.PRODUCT_PROMOTIONS_VIEW,
        Permissions.PRODUCT_PROMOTIONS_CREATE,
        Permissions.PRODUCT_PROMOTIONS_EDIT,
        Permissions.PRODUCT_PROMOTIONS_DELETE,
        Permissions.COUPONS_VIEW,
        Permissions.COUPONS_CREATE,
        Permissions.COUPONS_EDIT,
        Permissions.COUPONS_DELETE,
        Permissions.BANK_CARDS_VIEW,
        Permissions.BANK_CARDS_CREATE,
        Permissions.BANK_CARDS_EDIT,
        Permissions.BANK_CARDS_DELETE,
    ],
    [Permissions.CAMPAIGNS_MANAGE]: [
        Permissions.CAMPAIGNS_VIEW,
        Permissions.CAMPAIGNS_CREATE,
        Permissions.CAMPAIGNS_EDIT,
        Permissions.CAMPAIGNS_DELETE,
        Permissions.OFFER_SETTINGS_EDIT,
    ],
    [Permissions.CMS_MANAGE]: [
        Permissions.BANNERS_VIEW,
        Permissions.BANNERS_CREATE,
        Permissions.BANNERS_EDIT,
        Permissions.BANNERS_DELETE,
    ],
    [Permissions.PROMOTIONS_MANAGE]: [
        Permissions.PROMOTIONS_VIEW,
        Permissions.PROMOTIONS_CREATE,
        Permissions.PROMOTIONS_EDIT,
        Permissions.PROMOTIONS_DELETE,
    ],
    [Permissions.LOYALTY_MANAGE]: [
        Permissions.LOYALTY_VIEW,
        Permissions.LOYALTY_EDIT,
    ],
    [Permissions.DELIVERIES_MANAGE]: [
        Permissions.DELIVERY_TIERS_VIEW,
        Permissions.DELIVERY_TIERS_EDIT,
    ],
    [Permissions.CUSTOMERS_MANAGE]: [
        Permissions.CUSTOMERS_VIEW,
        Permissions.CUSTOMERS_CREATE,
        Permissions.CUSTOMERS_EDIT,
        Permissions.CUSTOMERS_DELETE,
    ],
    [Permissions.RECIPES_MANAGE]: [
        Permissions.RECIPES_VIEW,
        Permissions.RECIPES_CREATE,
        Permissions.RECIPES_EDIT,
        Permissions.RECIPES_DELETE,
        Permissions.RECIPES_ACTIVATE,
    ],
    [Permissions.NOTIFICATIONS_MANAGE]: [
        Permissions.NOTIFICATIONS_VIEW,
        Permissions.NOTIFICATIONS_EDIT,
    ],
    // Employee HRM. Writing an employee requires reading one — the list and the
    // detail page are both guarded by employees:view, so an edit-only role
    // would be able to save changes to a record it cannot open.
    [Permissions.EMPLOYEES_CREATE]: [Permissions.EMPLOYEES_VIEW],
    [Permissions.EMPLOYEES_EDIT]: [Permissions.EMPLOYEES_VIEW],
    [Permissions.EMPLOYEES_TERMINATE]: [Permissions.EMPLOYEES_VIEW],
    [Permissions.EMPLOYEE_DOCS_MANAGE]: [Permissions.EMPLOYEE_DOCS_VIEW],
    // Deliberately absent: employees:view → salary:view. Pay visibility is
    // never a side effect of being able to open a staff record (docs/HRM.md
    // §14.2). salary:edit → salary:view is safe and follows the pattern above.
    [Permissions.SALARY_EDIT]: [Permissions.SALARY_VIEW],
};

/**
 * Expand a set of permission names to include everything implied by the
 * umbrellas the user holds. Single-level expansion (no umbrella implies another
 * umbrella), which is all the map needs.
 */
export function expandPermissions(names: Iterable<string>): Set<string> {
    const out = new Set<string>(names);
    for (const name of names) {
        const implied = PERMISSION_IMPLICATIONS[name];
        if (implied) for (const p of implied) out.add(p);
    }
    return out;
}
