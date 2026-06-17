import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record the "home brand" of a user on tenant_users. When a brand-locked admin
 * creates a user, the brand is stored here so the user is visible to that
 * brand's admins even before any branch assignment / role is given. Stays null
 * for users created by owner/GM/super admin (unscoped).
 */
export class TenantUserBrandLink1760000000021 implements MigrationInterface {
    name = 'TenantUserBrandLink1760000000021';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "tenant_users"
            ADD COLUMN IF NOT EXISTS "brand_id" integer NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "tenant_users"
            ADD CONSTRAINT "FK_tenant_users_brand"
            FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_tenant_users_brand_id"
            ON "tenant_users" ("brand_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_tenant_users_brand_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "tenant_users" DROP CONSTRAINT IF EXISTS "FK_tenant_users_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "tenant_users" DROP COLUMN IF EXISTS "brand_id"`,
        );
    }
}
