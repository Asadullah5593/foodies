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
    // Marker: this user takes orders on behalf of customers (call centre), so
    // their POS orders are tagged source=call_centre and alert the till. Held by
    // the Call Centre Agent role; not implied by any umbrella.
    ORDERS_PLACE_CALL_CENTER: 'orders:place:call-center',
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
    // Customer Display + FOH Packing + the kitchen order APIs share this pair
    // (renamed from kitchen:view/update — there is no "Kitchen Display" module);
    // Back Kitchen = the brand-specific cooks’ screen.
    CUSTOMER_DISPLAY_VIEW: 'customer-display:view',
    CUSTOMER_DISPLAY_UPDATE: 'customer-display:update',
    BACK_KITCHEN_VIEW: 'back-kitchen:view',
    // Show the branch selector on the kitchen/FOH screens (admins pick a
    // branch; regular staff are pinned to their assigned branch).
    BACK_KITCHEN_BRANCH_FILTER: 'back-kitchen:branch-filter',
    FOH_BRANCH_FILTER: 'foh:branch-filter',
    // Module-level (one permission per admin module)
    BUSINESS_SETTINGS_ACCESS: 'business-settings:access',
    USERS_MANAGE: 'users:manage',
    MENU_MANAGE: 'menu:manage',
    CUSTOMERS_MANAGE: 'customers:manage',
    ROLES_MANAGE: 'roles:manage',
    DELIVERIES_VIEW: 'deliveries:view',
    DELIVERIES_MANAGE: 'deliveries:manage',
    // Rider brand-ownership & sharing
    RIDER_SHARE_REQUEST: 'rider-share:request',
    RIDER_SHARING_MANAGE: 'rider-sharing:manage',
    SHIFTS_MANAGE: 'shifts:manage',
    LOYALTY_MANAGE: 'loyalty:manage',
    // Deals (menu items with deal_components)
    DEALS_VIEW: 'deals:view',
    DEALS_CREATE: 'deals:create',
    DEALS_EDIT: 'deals:edit',
    DEALS_DELETE: 'deals:delete',

    // Inventory / procurement / recipes
    INVENTORY_VIEW: 'inventory:view',
    INVENTORY_RECEIVE: 'inventory:receive',
    INVENTORY_ADJUST: 'inventory:adjust',
    INVENTORY_WASTE: 'inventory:waste',
    INVENTORY_STOCKTAKE: 'inventory:stocktake',
    INVENTORY_TRANSFER: 'inventory:transfer',
    INVENTORY_OVERRIDE_NEGATIVE: 'inventory:override_negative',
    INVENTORY_OVERRIDE_FEFO: 'inventory:override_fefo',
    // Brand-scoped inventory for brand admins (see own brand stock across
    // their branches; request transfers in; approve/dispatch pulls FROM a
    // bucket they control — enforced per-bucket in InventoryTransferService).
    INVENTORY_VIEW_BRAND: 'inventory:view:brand',
    INVENTORY_TRANSFER_REQUEST: 'inventory:transfer:request',
    INVENTORY_TRANSFER_APPROVE: 'inventory:transfer:approve',

    PROCUREMENT_PR_CREATE: 'procurement:pr:create',
    PROCUREMENT_PR_APPROVE: 'procurement:pr:approve',
    PROCUREMENT_PO_MANAGE: 'procurement:po:manage',
    PROCUREMENT_GRN_POST: 'procurement:grn:post',

    RECIPES_MANAGE: 'recipes:manage',
    COSTING_VIEW: 'costing:view',

    // Campaigns, CMS – Banners & Promotions
    CAMPAIGNS_MANAGE: 'campaigns:manage',
    CMS_MANAGE: 'cms:manage',
    PROMOTIONS_MANAGE: 'promotions:manage',

    // Notifications (configure which roles receive which alerts)
    NOTIFICATIONS_MANAGE: 'notifications:manage',

    /* ─────────────────────────────────────────────────────────────────
     * Granular per-action permissions (view/create/edit/delete + specials).
     * Each is IMPLIED by its module's legacy umbrella (see
     * permission-implications.ts) so existing roles keep full access;
     * assign them individually for finer-grained roles.
     * ───────────────────────────────────────────────────────────────── */

    // — Menu content (umbrella: menu:manage) —
    MENU_VIEW: 'menu:view',
    MENU_CREATE: 'menu:create',
    MENU_EDIT: 'menu:edit',
    MENU_DELETE: 'menu:delete',
    CATEGORIES_VIEW: 'categories:view',
    CATEGORIES_CREATE: 'categories:create',
    CATEGORIES_EDIT: 'categories:edit',
    CATEGORIES_DELETE: 'categories:delete',
    VARIANTS_VIEW: 'variants:view',
    VARIANTS_CREATE: 'variants:create',
    VARIANTS_EDIT: 'variants:edit',
    VARIANTS_DELETE: 'variants:delete',
    ADDONS_VIEW: 'addons:view',
    ADDONS_CREATE: 'addons:create',
    ADDONS_EDIT: 'addons:edit',
    ADDONS_DELETE: 'addons:delete',
    MODIFIERS_VIEW: 'modifiers:view',
    MODIFIERS_CREATE: 'modifiers:create',
    MODIFIERS_EDIT: 'modifiers:edit',
    MODIFIERS_DELETE: 'modifiers:delete',

    // — Brands & branches (umbrella: branches:manage) —
    BRANDS_VIEW: 'brands:view',
    BRANDS_CREATE: 'brands:create',
    BRANDS_EDIT: 'brands:edit',
    BRANDS_DELETE: 'brands:delete',
    BRANDS_TOGGLE_OPEN: 'brands:toggle-open',
    BRANCHES_VIEW: 'branches:view',
    BRANCHES_CREATE: 'branches:create',
    BRANCHES_EDIT: 'branches:edit',
    BRANCHES_DELETE: 'branches:delete',

    // — Branch menu overrides (umbrella: branch-menu:manage) —
    BRANCH_MENU_VIEW: 'branch-menu:view',
    BRANCH_MENU_EDIT: 'branch-menu:edit',
    BRANCH_MENU_LINK: 'branch-menu:link',

    // — Branch users (umbrella: branch-users:assign) —
    BRANCH_USERS_VIEW: 'branch-users:view',
    BRANCH_USERS_REMOVE: 'branch-users:remove',

    // — Users (umbrella: users:manage) —
    USERS_VIEW: 'users:view',
    USERS_CREATE: 'users:create',
    USERS_EDIT: 'users:edit',
    USERS_DELETE: 'users:delete',

    // — Roles (umbrella: roles:manage) —
    ROLES_VIEW: 'roles:view',
    ROLES_CREATE: 'roles:create',
    ROLES_EDIT: 'roles:edit',
    ROLES_DELETE: 'roles:delete',

    // — Shifts (umbrella: shifts:manage) —
    SHIFTS_VIEW: 'shifts:view',
    SHIFTS_OPEN: 'shifts:open',
    SHIFTS_CLOSE: 'shifts:close',
    // Supervisor override: open a shift without being brand-locked staff, and
    // close shifts opened by OTHER users (closing is otherwise opener-only).
    // Implies view/open/close, but is NOT implied by shifts:manage — a cashier
    // with the umbrella stays opener-only; grant this explicitly to overseers.
    SHIFTS_OVERRIDE: 'shifts:override',
    // Record / void a mid-shift cash-out (cash handed from the till to the
    // owner). Standalone like shifts:override — everyone who can see a shift
    // sees the entries read-only; only holders may add or void one.
    SHIFTS_CASH_OUT: 'shifts:cash-out',

    // — Business settings (umbrella: business-settings:access) —
    BUSINESS_SETTINGS_EDIT: 'business-settings:edit',

    // — Invoice templates (umbrella: business-settings:access) —
    INVOICE_TEMPLATES_VIEW: 'invoice-templates:view',
    INVOICE_TEMPLATES_CREATE: 'invoice-templates:create',
    INVOICE_TEMPLATES_EDIT: 'invoice-templates:edit',
    INVOICE_TEMPLATES_DELETE: 'invoice-templates:delete',
    INVOICE_TEMPLATES_SET_DEFAULT: 'invoice-templates:set-default',

    // — Discounts (umbrella: discounts:manage) —
    DISCOUNTS_VIEW: 'discounts:view',
    DISCOUNTS_CREATE: 'discounts:create',
    DISCOUNTS_EDIT: 'discounts:edit',
    DISCOUNTS_DELETE: 'discounts:delete',

    // — Product promotions (umbrella: discounts:manage) —
    PRODUCT_PROMOTIONS_VIEW: 'product-promotions:view',
    PRODUCT_PROMOTIONS_CREATE: 'product-promotions:create',
    PRODUCT_PROMOTIONS_EDIT: 'product-promotions:edit',
    PRODUCT_PROMOTIONS_DELETE: 'product-promotions:delete',

    // — Coupons (umbrella: discounts:manage) —
    COUPONS_VIEW: 'coupons:view',
    COUPONS_CREATE: 'coupons:create',
    COUPONS_EDIT: 'coupons:edit',
    COUPONS_DELETE: 'coupons:delete',

    // — Bank cards (umbrella: discounts:manage) —
    BANK_CARDS_VIEW: 'bank-cards:view',
    BANK_CARDS_CREATE: 'bank-cards:create',
    BANK_CARDS_EDIT: 'bank-cards:edit',
    BANK_CARDS_DELETE: 'bank-cards:delete',

    // — Staff discounts (own module; NOT under discounts:manage — a give-away
    //   at the till is a different right from authoring offers) —
    STAFF_DISCOUNTS_VIEW: 'staff-discounts:view',
    STAFF_DISCOUNTS_CREATE: 'staff-discounts:create',
    STAFF_DISCOUNTS_EDIT: 'staff-discounts:edit',
    STAFF_DISCOUNTS_DELETE: 'staff-discounts:delete',
    /** Grant one on an order at the till. */
    STAFF_DISCOUNTS_APPLY: 'staff-discounts:apply',

    /** Switch a till-activated offer (activation='manual') on for one cart. */
    ORDERS_APPLY_MANUAL_OFFER: 'orders:apply-manual-offer',

    // — Campaigns (umbrella: campaigns:manage) —
    CAMPAIGNS_VIEW: 'campaigns:view',
    CAMPAIGNS_CREATE: 'campaigns:create',
    CAMPAIGNS_EDIT: 'campaigns:edit',
    CAMPAIGNS_DELETE: 'campaigns:delete',

    // — Banners (umbrella: cms:manage) —
    BANNERS_VIEW: 'banners:view',
    BANNERS_CREATE: 'banners:create',
    BANNERS_EDIT: 'banners:edit',
    BANNERS_DELETE: 'banners:delete',

    // — Targeted promotions (umbrella: promotions:manage) —
    PROMOTIONS_VIEW: 'promotions:view',
    PROMOTIONS_CREATE: 'promotions:create',
    PROMOTIONS_EDIT: 'promotions:edit',
    PROMOTIONS_DELETE: 'promotions:delete',

    // — Offer settings (umbrella: campaigns:manage) —
    OFFER_SETTINGS_EDIT: 'offer-settings:edit',

    // — Loyalty (umbrella: loyalty:manage) —
    LOYALTY_VIEW: 'loyalty:view',
    LOYALTY_EDIT: 'loyalty:edit',

    // — Orders (granular admin actions; backfilled from orders:view) —
    ORDERS_UPDATE_STATUS: 'orders:update-status',
    ORDERS_ASSIGN_RIDER: 'orders:assign-rider',

    /*
     * Order-history filter controls. Without these the Orders page still shows
     * the date range (every role can narrow by date), but the other filters are
     * hidden — e.g. a brand cashier who may only pick a date. Backfilled onto
     * every role that already had orders:view so nothing is lost.
     */
    ORDERS_FILTER_BRANCH: 'orders:filter:branch',
    ORDERS_FILTER_BRAND: 'orders:filter:brand',
    ORDERS_FILTER_ORDER_TYPE: 'orders:filter:order-type',
    ORDERS_FILTER_SOURCE: 'orders:filter:source',
    ORDERS_FILTER_STATUS: 'orders:filter:status',
    ORDERS_FILTER_SEARCH: 'orders:filter:search',
    ORDERS_FILTER_PAYMENT: 'orders:filter:payment',
    ORDERS_FILTER_DISCOUNT: 'orders:filter:discount',

    // — Delivery tiers (umbrella: deliveries:manage) —
    DELIVERY_TIERS_VIEW: 'delivery-tiers:view',
    DELIVERY_TIERS_EDIT: 'delivery-tiers:edit',

    // — Customers (umbrella: customers:manage) —
    CUSTOMERS_VIEW: 'customers:view',
    CUSTOMERS_CREATE: 'customers:create',
    CUSTOMERS_EDIT: 'customers:edit',
    CUSTOMERS_DELETE: 'customers:delete',

    // — Inventory master data (backfilled from inventory:view) —
    INVENTORY_ITEMS_VIEW: 'inventory-items:view',
    INVENTORY_ITEMS_CREATE: 'inventory-items:create',
    INVENTORY_ITEMS_EDIT: 'inventory-items:edit',
    INVENTORY_ITEMS_DELETE: 'inventory-items:delete',
    UOMS_VIEW: 'uoms:view',
    UOMS_CREATE: 'uoms:create',
    UOMS_EDIT: 'uoms:edit',
    UOMS_DELETE: 'uoms:delete',
    VENDORS_VIEW: 'vendors:view',
    VENDORS_CREATE: 'vendors:create',
    VENDORS_EDIT: 'vendors:edit',
    VENDORS_DELETE: 'vendors:delete',

    // — Procurement (extends existing granular perms) —
    PROCUREMENT_GRN_REVERSE: 'procurement:grn:reverse',

    // — Recipes (umbrella: recipes:manage) —
    RECIPES_VIEW: 'recipes:view',
    RECIPES_CREATE: 'recipes:create',
    RECIPES_EDIT: 'recipes:edit',
    RECIPES_DELETE: 'recipes:delete',
    RECIPES_ACTIVATE: 'recipes:activate',

    // — Rider HRM (backfilled from shifts:manage / deliveries) —
    RIDER_HRM_VIEW: 'rider-hrm:view',
    RIDER_PROFILES_EDIT: 'rider-profiles:edit',
    RIDER_PAYROLL_RUN: 'rider-payroll:run',
    RIDER_PAYROLL_REVERSE: 'rider-payroll:reverse',
    RIDER_COMP_PLANS_VIEW: 'rider-comp-plans:view',
    RIDER_COMP_PLANS_CREATE: 'rider-comp-plans:create',
    RIDER_COMP_PLANS_EDIT: 'rider-comp-plans:edit',
    RIDER_COMP_PLANS_ACTIVATE: 'rider-comp-plans:activate',
    RIDER_ATTENDANCE_MANAGE: 'rider-attendance:manage',
    // Read-only rider supervisor surface (recent delivery orders, live rider
    // roster with attendance + base salary). Standalone — NOT implied by any
    // umbrella — so it can be granted on its own to a limited oversight role.
    RIDER_SUPERVISOR_VIEW: 'rider-supervisor:view',
    // Order status on that surface: the Status column, the status filter pills
    // and the per-bucket counts. Separate from :view so a supervisor can be
    // limited to logistics (who/where/when) without order progress. Granted to
    // existing :view holders by migration, so nothing is lost by default.
    RIDER_SUPERVISOR_VIEW_STATUS: 'rider-supervisor:view-status',

    // — Notifications (umbrella: notifications:manage) —
    NOTIFICATIONS_VIEW: 'notifications:view',
    NOTIFICATIONS_EDIT: 'notifications:edit',

    // — Employee HRM (docs/HRM.md §14) —
    // Distinct from Rider HRM above: that module is about dispatch and rider
    // pay, this one is about people. Riders appear in both.
    EMPLOYEES_VIEW: 'employees:view',
    EMPLOYEES_CREATE: 'employees:create',
    EMPLOYEES_EDIT: 'employees:edit',
    EMPLOYEES_TERMINATE: 'employees:terminate',
    EMPLOYEE_DOCS_VIEW: 'employee-docs:view',
    EMPLOYEE_DOCS_MANAGE: 'employee-docs:manage',
    EMPLOYEE_PIN_RESET: 'employee-pin:reset',
    /**
     * Salary figures and payslips. STANDALONE on purpose — not implied by
     * employees:view, not implied by any umbrella, and not granted to branch
     * managers by default. Easy to grant later; impossible to un-see once a
     * branch has read everyone's pay.
     */
    SALARY_VIEW: 'salary:view',
    SALARY_EDIT: 'salary:edit',
    /** Settings that drive every calculation: designations, policies, rules. */
    HR_SETTINGS_MANAGE: 'hr-settings:manage',
    HR_AUDIT_VIEW: 'hr-audit:view',
} as const;

export type PermissionName = (typeof Permissions)[keyof typeof Permissions];
