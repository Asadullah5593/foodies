import { MigrationInterface, QueryRunner } from 'typeorm';

export class TenantUserBranchUserRoleId1740000000004 implements MigrationInterface {
    name = 'TenantUserBranchUserRoleId1740000000004';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // tenant_users: add role_id, backfill from roles by slug, drop role
        await queryRunner.query(`
      ALTER TABLE "tenant_users"
      ADD COLUMN "role_id" integer
    `);
        await queryRunner.query(`
      UPDATE "tenant_users" tu
      SET "role_id" = r.id
      FROM "roles" r
      WHERE r.slug = tu.role
    `);
        await queryRunner.query(`
      ALTER TABLE "tenant_users"
      ALTER COLUMN "role_id" SET NOT NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "tenant_users"
      ADD CONSTRAINT "FK_tenant_users_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT
    `);
        await queryRunner.query(
            `ALTER TABLE "tenant_users" DROP COLUMN "role"`,
        );

        // branch_users: add role_id, backfill (branch_users used 'cashier' default), drop role
        await queryRunner.query(`
      ALTER TABLE "branch_users"
      ADD COLUMN "role_id" integer
    `);
        await queryRunner.query(`
      UPDATE "branch_users" bu
      SET "role_id" = r.id
      FROM "roles" r
      WHERE r.slug = bu.role
    `);
        await queryRunner.query(`
      ALTER TABLE "branch_users"
      ALTER COLUMN "role_id" SET NOT NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "branch_users"
      ADD CONSTRAINT "FK_branch_users_role" FOREIGN KEY ("role_id") REFERENCES "roles"("id") ON DELETE RESTRICT
    `);
        await queryRunner.query(
            `ALTER TABLE "branch_users" DROP COLUMN "role"`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "tenant_users" ADD COLUMN "role" character varying`,
        );
        await queryRunner.query(`
      UPDATE "tenant_users" tu
      SET "role" = r.slug
      FROM "roles" r
      WHERE r.id = tu.role_id
    `);
        await queryRunner.query(
            `ALTER TABLE "tenant_users" ALTER COLUMN "role" SET NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "tenant_users" DROP CONSTRAINT "FK_tenant_users_role"`,
        );
        await queryRunner.query(
            `ALTER TABLE "tenant_users" DROP COLUMN "role_id"`,
        );

        await queryRunner.query(
            `ALTER TABLE "branch_users" ADD COLUMN "role" character varying NOT NULL DEFAULT 'cashier'`,
        );
        await queryRunner.query(`
      UPDATE "branch_users" bu
      SET "role" = r.slug
      FROM "roles" r
      WHERE r.id = bu.role_id
    `);
        await queryRunner.query(
            `ALTER TABLE "branch_users" DROP CONSTRAINT "FK_branch_users_role"`,
        );
        await queryRunner.query(
            `ALTER TABLE "branch_users" DROP COLUMN "role_id"`,
        );
    }
}
