import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * System role: branch_manager.
 *
 * Intended access:
 * - Can manage branch menu linkage/copies and branch-level overrides (branch-menu:manage)
 * - Can perform basic POS actions (orders:create, orders:view, discounts:apply)
 * - Cannot assign branches to users (branch-users:assign is tenant/super admin only)
 */
export class BranchManagerRole1740000000010 implements MigrationInterface {
    name = 'BranchManagerRole1740000000010';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      INSERT INTO "roles" ("tenant_id", "name", "slug")
      SELECT NULL, 'Branch Manager', 'branch_manager'
      WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE "slug" = 'branch_manager')
    `);

        await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT r.id, p.id
      FROM "roles" r
      JOIN "permissions" p ON p.name IN ('orders:create','orders:view','discounts:apply','branch-menu:manage','reports:view')
      WHERE r.slug = 'branch_manager'
      ON CONFLICT DO NOTHING
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      DELETE FROM "role_permissions"
      WHERE "role_id" IN (SELECT id FROM "roles" WHERE slug = 'branch_manager')
    `);
        await queryRunner.query(
            `DELETE FROM "roles" WHERE slug = 'branch_manager'`,
        );
    }
}
