import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Kitchen role: keep only back-kitchen:view so users with only Kitchen role see just Back Kitchen.
 */
export class KitchenRoleOnlyBackKitchen1740000000029 implements MigrationInterface {
    name = 'KitchenRoleOnlyBackKitchen1740000000029';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Remove all current permissions from Kitchen role, then assign only back-kitchen:view
        await queryRunner.query(
            `DELETE FROM role_permissions
             WHERE role_id IN (SELECT id FROM roles WHERE slug = 'kitchen')`,
        );
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug = 'kitchen' AND p.name = 'back-kitchen:view'`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM role_permissions
             WHERE role_id IN (SELECT id FROM roles WHERE slug = 'kitchen')`,
        );
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug = 'kitchen'
             AND p.name IN ('kitchen:view', 'kitchen:update', 'orders:view')`,
        );
    }
}
