import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Multi-brand separation: a branch_users assignment may be locked to a single
 * brand (brand_id NULL = all brands at the branch, mirroring how having no
 * branch_users rows means all branches). kiosk_orders records the single brand
 * of its cart so a brand-locked cashier can only finalize own-brand codes.
 */
export class BranchUserBrandLock1760000000018 implements MigrationInterface {
    name = 'BranchUserBrandLock1760000000018';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "branch_users"
      ADD COLUMN IF NOT EXISTS "brand_id" integer NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "branch_users"
      ADD CONSTRAINT "FK_branch_users_brand"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL
    `);

        await queryRunner.query(`
      ALTER TABLE "kiosk_orders"
      ADD COLUMN IF NOT EXISTS "brand_id" integer NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "kiosk_orders"
      ADD CONSTRAINT "FK_kiosk_orders_brand"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "kiosk_orders" DROP CONSTRAINT IF EXISTS "FK_kiosk_orders_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "kiosk_orders" DROP COLUMN IF EXISTS "brand_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "branch_users" DROP CONSTRAINT IF EXISTS "FK_branch_users_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "branch_users" DROP COLUMN IF EXISTS "brand_id"`,
        );
    }
}
