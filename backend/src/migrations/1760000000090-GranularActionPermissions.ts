import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds granular per-action permissions (view/create/edit/delete + specials) for
 * every admin module. Strictly additive:
 *  - Each new permission is inserted into the catalog so it appears in the Roles
 *    UI and can be assigned to fine-grained roles.
 *  - Owner + super_admin get all of them (they hold every permission).
 *  - Modules with a clear "manage" umbrella rely on runtime expansion
 *    (permission-implications.ts) — no role_permissions backfill needed; roles
 *    holding the umbrella auto-satisfy the granular checks.
 *  - Modules whose legacy gate was a coarse view/action permission get a
 *    one-time backfill here, so existing roles keep exactly what they can do
 *    today (see BACKFILL below).
 */
export class GranularActionPermissions1760000000090
    implements MigrationInterface
{
    name = 'GranularActionPermissions1760000000090';

    // resource, action, description — name is `${resource}:${action}`
    private readonly permissions: Array<{
        resource: string;
        action: string;
        description: string;
    }> = [
        // Menu content
        { resource: 'menu', action: 'view', description: 'View menu items' },
        { resource: 'menu', action: 'create', description: 'Create menu items' },
        { resource: 'menu', action: 'edit', description: 'Edit menu items (incl. activate/deactivate, addons, images)' },
        { resource: 'menu', action: 'delete', description: 'Delete menu items' },
        { resource: 'categories', action: 'view', description: 'View categories' },
        { resource: 'categories', action: 'create', description: 'Create categories' },
        { resource: 'categories', action: 'edit', description: 'Edit categories' },
        { resource: 'categories', action: 'delete', description: 'Delete categories' },
        { resource: 'variants', action: 'view', description: 'View variants' },
        { resource: 'variants', action: 'create', description: 'Create variants' },
        { resource: 'variants', action: 'edit', description: 'Edit variants' },
        { resource: 'variants', action: 'delete', description: 'Delete variants' },
        { resource: 'addons', action: 'view', description: 'View addons' },
        { resource: 'addons', action: 'create', description: 'Create addons' },
        { resource: 'addons', action: 'edit', description: 'Edit addons' },
        { resource: 'addons', action: 'delete', description: 'Delete addons' },
        { resource: 'modifiers', action: 'view', description: 'View modifier groups & modifiers' },
        { resource: 'modifiers', action: 'create', description: 'Create modifier groups & modifiers' },
        { resource: 'modifiers', action: 'edit', description: 'Edit modifier groups & modifiers, link to items' },
        { resource: 'modifiers', action: 'delete', description: 'Delete modifier groups & modifiers' },
        // Brands & branches
        { resource: 'brands', action: 'view', description: 'View brands' },
        { resource: 'brands', action: 'create', description: 'Create brands' },
        { resource: 'brands', action: 'edit', description: 'Edit brands' },
        { resource: 'brands', action: 'delete', description: 'Delete brands' },
        { resource: 'brands', action: 'toggle-open', description: 'Open/close brands online (bulk open/close)' },
        { resource: 'branches', action: 'view', description: 'View branches' },
        { resource: 'branches', action: 'create', description: 'Create branches' },
        { resource: 'branches', action: 'edit', description: 'Edit branches' },
        { resource: 'branches', action: 'delete', description: 'Delete branches' },
        // Branch menu overrides
        { resource: 'branch-menu', action: 'view', description: 'View branch menu overrides' },
        { resource: 'branch-menu', action: 'edit', description: 'Edit branch price/availability overrides' },
        { resource: 'branch-menu', action: 'link', description: 'Link/de-link items to a branch (bulk)' },
        // Branch users
        { resource: 'branch-users', action: 'view', description: 'View branch user assignments' },
        { resource: 'branch-users', action: 'remove', description: 'Remove users from branches' },
        // Users
        { resource: 'users', action: 'view', description: 'View users' },
        { resource: 'users', action: 'create', description: 'Create users' },
        { resource: 'users', action: 'edit', description: 'Edit users (incl. reset password)' },
        { resource: 'users', action: 'delete', description: 'Delete users' },
        // Roles
        { resource: 'roles', action: 'view', description: 'View roles & permissions' },
        { resource: 'roles', action: 'create', description: 'Create roles' },
        { resource: 'roles', action: 'edit', description: 'Edit roles & assign permissions' },
        { resource: 'roles', action: 'delete', description: 'Delete roles' },
        // Shifts
        { resource: 'shifts', action: 'view', description: 'View shifts' },
        { resource: 'shifts', action: 'open', description: 'Open a shift' },
        { resource: 'shifts', action: 'close', description: 'Close a shift' },
        // Business settings & invoice templates
        { resource: 'business-settings', action: 'edit', description: 'Edit business settings' },
        { resource: 'invoice-templates', action: 'view', description: 'View invoice templates' },
        { resource: 'invoice-templates', action: 'create', description: 'Create invoice templates' },
        { resource: 'invoice-templates', action: 'edit', description: 'Edit invoice templates' },
        { resource: 'invoice-templates', action: 'delete', description: 'Delete invoice templates' },
        { resource: 'invoice-templates', action: 'set-default', description: 'Set the customer/kitchen default template' },
        // Discounts family
        { resource: 'discounts', action: 'view', description: 'View discounts' },
        { resource: 'discounts', action: 'create', description: 'Create discounts' },
        { resource: 'discounts', action: 'edit', description: 'Edit discounts' },
        { resource: 'discounts', action: 'delete', description: 'Delete discounts' },
        { resource: 'product-promotions', action: 'view', description: 'View product promotions' },
        { resource: 'product-promotions', action: 'create', description: 'Create product promotions' },
        { resource: 'product-promotions', action: 'edit', description: 'Edit product promotions' },
        { resource: 'product-promotions', action: 'delete', description: 'Delete product promotions' },
        { resource: 'coupons', action: 'view', description: 'View coupons' },
        { resource: 'coupons', action: 'create', description: 'Create coupons' },
        { resource: 'coupons', action: 'edit', description: 'Edit coupons' },
        { resource: 'coupons', action: 'delete', description: 'Delete coupons' },
        { resource: 'bank-cards', action: 'view', description: 'View bank card offers' },
        { resource: 'bank-cards', action: 'create', description: 'Create bank card offers' },
        { resource: 'bank-cards', action: 'edit', description: 'Edit bank card offers' },
        { resource: 'bank-cards', action: 'delete', description: 'Delete bank card offers' },
        // Campaigns / banners / promotions / offer settings / loyalty
        { resource: 'campaigns', action: 'view', description: 'View campaigns' },
        { resource: 'campaigns', action: 'create', description: 'Create campaigns' },
        { resource: 'campaigns', action: 'edit', description: 'Edit campaigns' },
        { resource: 'campaigns', action: 'delete', description: 'Delete campaigns' },
        { resource: 'banners', action: 'view', description: 'View banners' },
        { resource: 'banners', action: 'create', description: 'Create banners' },
        { resource: 'banners', action: 'edit', description: 'Edit banners' },
        { resource: 'banners', action: 'delete', description: 'Delete banners' },
        { resource: 'promotions', action: 'view', description: 'View targeted promotions' },
        { resource: 'promotions', action: 'create', description: 'Create targeted promotions' },
        { resource: 'promotions', action: 'edit', description: 'Edit targeted promotions' },
        { resource: 'promotions', action: 'delete', description: 'Delete targeted promotions' },
        { resource: 'offer-settings', action: 'edit', description: 'Edit offer settings' },
        { resource: 'loyalty', action: 'view', description: 'View loyalty settings' },
        { resource: 'loyalty', action: 'edit', description: 'Edit loyalty settings' },
        // Orders (granular admin actions)
        { resource: 'orders', action: 'update-status', description: 'Update an order’s status' },
        { resource: 'orders', action: 'assign-rider', description: 'Assign/change the rider on an order' },
        // Delivery tiers
        { resource: 'delivery-tiers', action: 'view', description: 'View delivery tiers' },
        { resource: 'delivery-tiers', action: 'edit', description: 'Edit delivery tiers' },
        // Customers
        { resource: 'customers', action: 'view', description: 'View customers' },
        { resource: 'customers', action: 'create', description: 'Create customers' },
        { resource: 'customers', action: 'edit', description: 'Edit customers' },
        { resource: 'customers', action: 'delete', description: 'Delete customers' },
        // Inventory master data
        { resource: 'inventory-items', action: 'view', description: 'View inventory item master' },
        { resource: 'inventory-items', action: 'create', description: 'Create inventory items' },
        { resource: 'inventory-items', action: 'edit', description: 'Edit inventory items (incl. reorder point)' },
        { resource: 'inventory-items', action: 'delete', description: 'Delete inventory items' },
        { resource: 'uoms', action: 'view', description: 'View units of measure' },
        { resource: 'uoms', action: 'create', description: 'Create units of measure' },
        { resource: 'uoms', action: 'edit', description: 'Edit units of measure' },
        { resource: 'uoms', action: 'delete', description: 'Delete units of measure' },
        { resource: 'vendors', action: 'view', description: 'View vendors' },
        { resource: 'vendors', action: 'create', description: 'Create vendors' },
        { resource: 'vendors', action: 'edit', description: 'Edit vendors' },
        { resource: 'vendors', action: 'delete', description: 'Delete vendors' },
        // Procurement extension
        { resource: 'procurement', action: 'grn:reverse', description: 'Reverse a posted GRN' },
        // Recipes
        { resource: 'recipes', action: 'view', description: 'View recipes' },
        { resource: 'recipes', action: 'create', description: 'Create recipes' },
        { resource: 'recipes', action: 'edit', description: 'Edit recipes & ingredients' },
        { resource: 'recipes', action: 'delete', description: 'Delete recipes' },
        { resource: 'recipes', action: 'activate', description: 'Activate a recipe version' },
        // Rider HRM
        { resource: 'rider-hrm', action: 'view', description: 'View Rider HRM' },
        { resource: 'rider-profiles', action: 'edit', description: 'Edit rider profiles' },
        { resource: 'rider-payroll', action: 'run', description: 'Run rider payroll' },
        { resource: 'rider-payroll', action: 'reverse', description: 'Reverse a finalized payroll run' },
        { resource: 'rider-comp-plans', action: 'view', description: 'View rider compensation plans' },
        { resource: 'rider-comp-plans', action: 'create', description: 'Create rider compensation plans' },
        { resource: 'rider-comp-plans', action: 'edit', description: 'Edit rider compensation plans' },
        { resource: 'rider-comp-plans', action: 'activate', description: 'Activate a rider compensation plan' },
        { resource: 'rider-attendance', action: 'manage', description: 'Check riders in/out (attendance)' },
        // Notifications
        { resource: 'notifications', action: 'view', description: 'View notification settings' },
        { resource: 'notifications', action: 'edit', description: 'Edit notification settings' },
    ];

    /**
     * One-time backfill for modules with NO manage umbrella: grant the new
     * granular permission to any role that already holds the legacy permission
     * that gated the action today, so existing roles keep their capabilities.
     * { newPerm: [legacy perms — grant to roles holding ANY of these] }
     */
    private readonly backfill: Record<string, string[]> = {
        'orders:update-status': ['orders:view'],
        'orders:assign-rider': ['orders:view', 'deliveries:view', 'deliveries:manage'],
        'inventory-items:view': ['inventory:view', 'inventory:view:brand'],
        'inventory-items:create': ['inventory:view'],
        'inventory-items:edit': ['inventory:view'],
        'inventory-items:delete': ['inventory:view'],
        'uoms:view': ['inventory:view'],
        'uoms:create': ['inventory:view'],
        'uoms:edit': ['inventory:view'],
        'uoms:delete': ['inventory:view'],
        'vendors:view': ['inventory:view'],
        'vendors:create': ['inventory:view'],
        'vendors:edit': ['inventory:view'],
        'vendors:delete': ['inventory:view'],
        'procurement:grn:reverse': ['procurement:grn:post'],
        'rider-hrm:view': ['deliveries:view', 'shifts:manage'],
        'rider-profiles:edit': ['deliveries:view', 'shifts:manage'],
        'rider-payroll:run': ['deliveries:view', 'shifts:manage'],
        'rider-payroll:reverse': ['deliveries:view', 'shifts:manage'],
        'rider-comp-plans:view': ['deliveries:view', 'shifts:manage'],
        'rider-comp-plans:create': ['deliveries:view', 'shifts:manage'],
        'rider-comp-plans:edit': ['deliveries:view', 'shifts:manage'],
        'rider-comp-plans:activate': ['deliveries:view', 'shifts:manage'],
        'rider-attendance:manage': ['deliveries:view', 'shifts:manage'],
    };

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [`${p.resource}:${p.action}`, p.resource, p.action, p.description],
            );
        }

        // Owner + super_admin hold everything.
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT r.id, perm.id FROM roles r
                 CROSS JOIN permissions perm
                 WHERE LOWER(r.slug) IN ('owner', 'super_admin') AND perm.name = $1
                 AND NOT EXISTS (
                     SELECT 1 FROM role_permissions rp
                     WHERE rp.role_id = r.id AND rp.permission_id = perm.id
                 )`,
                [`${p.resource}:${p.action}`],
            );
        }

        // Legacy-view backfills: grant to roles holding any listed legacy perm.
        for (const [newPerm, legacyPerms] of Object.entries(this.backfill)) {
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT DISTINCT rp.role_id, np.id
                 FROM role_permissions rp
                 INNER JOIN permissions lp ON lp.id = rp.permission_id AND lp.name = ANY($2)
                 CROSS JOIN permissions np
                 WHERE np.name = $1
                 AND NOT EXISTS (
                     SELECT 1 FROM role_permissions rp2
                     WHERE rp2.role_id = rp.role_id AND rp2.permission_id = np.id
                 )`,
                [newPerm, legacyPerms],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const p of this.permissions) {
            await queryRunner.query(`DELETE FROM permissions WHERE name = $1`, [
                `${p.resource}:${p.action}`,
            ]);
        }
    }
}
