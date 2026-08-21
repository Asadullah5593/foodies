import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-module read permissions for the activity log.
 *
 * `activity-log:view` remains the umbrella and keeps granting everything (see
 * permission-implications.ts). These narrow it: a menu manager can be given
 * `activity-log:view:menu` and will see price history — and nothing about
 * users, roles, shifts or money.
 *
 * The split follows `action_group`, which every row already carries, so
 * filtering is an indexed equality check rather than a new taxonomy to keep in
 * sync with the one that exists.
 */
export class ActivityLogModulePermissions1760000000119
    implements MigrationInterface
{
    name = 'ActivityLogModulePermissions1760000000119';

    private readonly permissions = [
        ['activity-log:view:access', 'Roles, users and branch assignments'],
        ['activity-log:view:menu', 'Menu items, categories and branch pricing'],
        ['activity-log:view:offers', 'Discounts, coupons and campaigns'],
        ['activity-log:view:shifts', 'Shift opens, closes and cash-outs'],
        ['activity-log:view:inventory', 'Stock adjustments, wastage and procurement'],
        ['activity-log:view:orders', 'Order payments, voids and refunds'],
        ['activity-log:view:auth', 'Sign-ins and failed sign-in attempts'],
        ['activity-log:view:system', 'Settings, reports, exports and the log itself'],
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
        for (const [name, description] of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, 'activity-log', $2, $3)
                 ON CONFLICT (name) DO NOTHING`,
                [name, name.split(':').slice(1).join(':'), `View activity for: ${description}`],
            );
            // Owner / super admin already hold the umbrella, but granting the
            // narrow ones too keeps the Roles UI honest about what they have.
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT r.id, p.id FROM roles r CROSS JOIN permissions p
                 WHERE r.slug IN ('owner', 'super_admin', 'superadmin')
                   AND p.name = $1
                   AND NOT EXISTS (
                       SELECT 1 FROM role_permissions rp
                       WHERE rp.role_id = r.id AND rp.permission_id = p.id
                   )`,
                [name],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const [name] of this.permissions) {
            await queryRunner.query(`DELETE FROM permissions WHERE name = $1`, [
                name,
            ]);
        }
    }
}
