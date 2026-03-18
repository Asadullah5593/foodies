import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add separate permission for Back Kitchen so it can be assigned independently of Kitchen Display.
 */
export class BackKitchenPermission1740000000027 implements MigrationInterface {
    name = 'BackKitchenPermission1740000000027';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `INSERT INTO permissions (name, resource, action, description)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (name) DO NOTHING`,
            ['back-kitchen:view', 'back-kitchen', 'view', 'View and manage Back Kitchen (brand-specific orders)'],
        );

        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug IN ('owner', 'super_admin') AND p.name = 'back-kitchen:view'
             AND NOT EXISTS (
                 SELECT 1 FROM role_permissions rp
                 WHERE rp.role_id = r.id AND rp.permission_id = p.id
             )`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            "DELETE FROM permissions WHERE name = 'back-kitchen:view'",
        );
    }
}
