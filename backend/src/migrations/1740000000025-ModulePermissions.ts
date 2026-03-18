import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add one permission per admin module so access is controlled via Roles module.
 * Assign new permissions to owner and super_admin so existing tenants keep full access.
 */
export class ModulePermissions1740000000025 implements MigrationInterface {
    name = 'ModulePermissions1740000000025';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const newPermissions = [
            { name: 'discounts:manage', resource: 'discounts', action: 'manage', description: 'Manage discounts (admin module)' },
            { name: 'business-settings:access', resource: 'business-settings', action: 'access', description: 'Access business settings' },
            { name: 'users:manage', resource: 'users', action: 'manage', description: 'Manage users' },
            { name: 'menu:manage', resource: 'menu', action: 'manage', description: 'Manage menu (categories, items, variants, addons)' },
            { name: 'customers:manage', resource: 'customers', action: 'manage', description: 'Manage customers' },
            { name: 'roles:manage', resource: 'roles', action: 'manage', description: 'Manage roles and assign permissions' },
            { name: 'deliveries:view', resource: 'deliveries', action: 'view', description: 'View deliveries' },
            { name: 'shifts:manage', resource: 'shifts', action: 'manage', description: 'Manage shifts' },
            { name: 'loyalty:manage', resource: 'loyalty', action: 'manage', description: 'Manage loyalty settings' },
        ];

        for (const p of newPermissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
        }

        // Assign new permissions to owner and super_admin (idempotent)
        const ownerAdminPerms = [
            'discounts:manage', 'business-settings:access', 'users:manage',
            'menu:manage', 'customers:manage', 'roles:manage', 'deliveries:view',
            'shifts:manage', 'loyalty:manage',
        ];
        for (const permName of ownerAdminPerms) {
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT r.id, p.id FROM roles r
                 CROSS JOIN permissions p
                 WHERE r.slug IN ('owner', 'super_admin') AND p.name = $1
                 AND NOT EXISTS (
                     SELECT 1 FROM role_permissions rp
                     WHERE rp.role_id = r.id AND rp.permission_id = p.id
                 )`,
                [permName],
            );
        }

        // Ensure cashier role has shifts:manage (for Orders, Shifts, POS access)
        await queryRunner.query(`
            INSERT INTO role_permissions (role_id, permission_id)
            SELECT r.id, p.id FROM roles r
            CROSS JOIN permissions p
            WHERE r.slug = 'cashier' AND p.name = 'shifts:manage'
            AND NOT EXISTS (
                SELECT 1 FROM role_permissions rp
                WHERE rp.role_id = r.id AND rp.permission_id = p.id
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const names = [
            'discounts:manage', 'business-settings:access', 'users:manage',
            'menu:manage', 'customers:manage', 'roles:manage', 'deliveries:view',
            'shifts:manage', 'loyalty:manage',
        ];
        for (const name of names) {
            await queryRunner.query(
                'DELETE FROM permissions WHERE name = $1',
                [name],
            );
        }
    }
}
