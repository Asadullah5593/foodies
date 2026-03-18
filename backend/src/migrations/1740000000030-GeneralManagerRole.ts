import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add all-branches:access permission and General Manager role (access all branches of tenant).
 */
export class GeneralManagerRole1740000000030 implements MigrationInterface {
    name = 'GeneralManagerRole1740000000030';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `INSERT INTO permissions (name, resource, action, description)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (name) DO NOTHING`,
            [
                'all-branches:access',
                'branches',
                'access-all',
                'Access all branches of the tenant (General Manager)',
            ],
        );

        await queryRunner.query(
            `INSERT INTO roles (name, slug, tenant_id)
             SELECT 'General Manager', 'general_manager', NULL
             WHERE NOT EXISTS (SELECT 1 FROM roles WHERE slug = 'general_manager')`,
        );

        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug = 'general_manager'
             AND p.name IN ('dashboard:view', 'all-branches:access', 'orders:create', 'orders:view', 'discounts:apply', 'branch-menu:manage', 'reports:view', 'shifts:manage')
             AND NOT EXISTS (
                 SELECT 1 FROM role_permissions rp
                 WHERE rp.role_id = r.id AND rp.permission_id = p.id
             )`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM role_permissions WHERE role_id IN (SELECT id FROM roles WHERE slug = 'general_manager')`,
        );
        await queryRunner.query(
            `DELETE FROM roles WHERE slug = 'general_manager'`,
        );
        await queryRunner.query(
            "DELETE FROM permissions WHERE name = 'all-branches:access'",
        );
    }
}
