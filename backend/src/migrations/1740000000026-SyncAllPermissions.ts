import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Ensure all module permissions exist so they appear in the Roles module.
 * Idempotent: uses ON CONFLICT (name) DO NOTHING.
 */
export class SyncAllPermissions1740000000026 implements MigrationInterface {
    name = 'SyncAllPermissions1740000000026';

    private readonly permissions = [
        { name: 'orders:create', resource: 'orders', action: 'create', description: 'Create orders' },
        { name: 'orders:view', resource: 'orders', action: 'view', description: 'View orders' },
        { name: 'orders:void', resource: 'orders', action: 'void', description: 'Void orders' },
        { name: 'discounts:apply', resource: 'discounts', action: 'apply', description: 'Apply discounts at POS' },
        { name: 'discounts:manage', resource: 'discounts', action: 'manage', description: 'Manage discounts (admin module)' },
        { name: 'reports:view', resource: 'reports', action: 'view', description: 'View reports' },
        { name: 'branches:manage', resource: 'branches', action: 'manage', description: 'Manage branches' },
        { name: 'branch-menu:manage', resource: 'branch-menu', action: 'manage', description: 'Manage branch menu' },
        { name: 'branch-users:assign', resource: 'branch-users', action: 'assign', description: 'Assign users to branches' },
        { name: 'kitchen:view', resource: 'kitchen', action: 'view', description: 'View kitchen orders' },
        { name: 'kitchen:update', resource: 'kitchen', action: 'update', description: 'Update kitchen order status' },
        { name: 'business-settings:access', resource: 'business-settings', action: 'access', description: 'Access business settings' },
        { name: 'users:manage', resource: 'users', action: 'manage', description: 'Manage users' },
        { name: 'menu:manage', resource: 'menu', action: 'manage', description: 'Manage menu (categories, items, variants, addons)' },
        { name: 'customers:manage', resource: 'customers', action: 'manage', description: 'Manage customers' },
        { name: 'roles:manage', resource: 'roles', action: 'manage', description: 'Manage roles and assign permissions' },
        { name: 'deliveries:view', resource: 'deliveries', action: 'view', description: 'View deliveries' },
        { name: 'shifts:manage', resource: 'shifts', action: 'manage', description: 'Manage shifts' },
        { name: 'loyalty:manage', resource: 'loyalty', action: 'manage', description: 'Manage loyalty settings' },
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
        }
    }

    public async down(): Promise<void> {
        // No-op: we don't remove permissions on revert (other migrations may depend on them)
    }
}
