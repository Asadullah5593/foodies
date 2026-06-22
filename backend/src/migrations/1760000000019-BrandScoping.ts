import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brand-level operations: shifts are opened per brand (per branch) instead of
 * per branch, and the flat delivery fee moves from branch to brand (each
 * order is single-brand, so each order charges its own brand's fee).
 * shifts.brand_id stays nullable for legacy rows; all new shifts carry it.
 */
export class BrandScoping1760000000019 implements MigrationInterface {
    name = 'BrandScoping1760000000019';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "shifts"
      ADD COLUMN IF NOT EXISTS "brand_id" integer NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "shifts"
      ADD CONSTRAINT "FK_shifts_brand"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE SET NULL
    `);
        await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_shifts_open_branch_brand"
      ON "shifts" ("branch_id", "brand_id")
      WHERE "status" = 'open' AND "brand_id" IS NOT NULL
    `);

        await queryRunner.query(`
      ALTER TABLE "brands"
      ADD COLUMN IF NOT EXISTS "delivery_flat_fee" numeric(10,2) NOT NULL DEFAULT 0
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "brands" DROP COLUMN IF EXISTS "delivery_flat_fee"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_shifts_open_branch_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shifts" DROP CONSTRAINT IF EXISTS "FK_shifts_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "shifts" DROP COLUMN IF EXISTS "brand_id"`,
        );
    }
}
