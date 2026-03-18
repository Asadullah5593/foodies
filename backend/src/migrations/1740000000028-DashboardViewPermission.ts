import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add dashboard:view permission and assign to all roles that should see the dashboard
 * (not the minimal Kitchen role which only has back-kitchen:view).
 */
export class DashboardViewPermission1740000000028 implements MigrationInterface {
    name = 'DashboardViewPermission1740000000028';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `INSERT INTO permissions (name, resource, action, description)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (name) DO NOTHING`,
            ['dashboard:view', 'dashboard', 'view', 'View admin dashboard'],
        );

        // Assign to owner, super_admin, manager, branch_manager, cashier, rider (not kitchen)
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug IN ('owner', 'super_admin', 'manager', 'branch_manager', 'cashier', 'rider')
             AND p.name = 'dashboard:view'
             AND NOT EXISTS (
                 SELECT 1 FROM role_permissions rp
                 WHERE rp.role_id = r.id AND rp.permission_id = p.id
             )`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            "DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name = 'dashboard:view')",
        );
        await queryRunner.query(
            "DELETE FROM permissions WHERE name = 'dashboard:view'",
        );
    }
}
