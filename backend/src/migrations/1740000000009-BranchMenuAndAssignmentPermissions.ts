import { MigrationInterface, QueryRunner } from 'typeorm';

export class BranchMenuAndAssignmentPermissions1740000000009 implements MigrationInterface {
    name = 'BranchMenuAndAssignmentPermissions1740000000009';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      INSERT INTO "permissions" ("name", "resource", "action", "description")
      VALUES
        ('branch-menu:manage', 'branch-menu', 'manage', 'Manage branch menu (link/de-link items, overrides)'),
        ('branch-users:assign', 'branch-users', 'assign', 'Assign/unassign users to branches (tenant/super admin only)')
      ON CONFLICT ("name") DO NOTHING
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM "permissions" WHERE "name" IN ('branch-menu:manage', 'branch-users:assign')`,
        );
    }
}
