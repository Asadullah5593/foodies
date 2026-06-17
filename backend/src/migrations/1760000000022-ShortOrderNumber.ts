import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Introduces two separate order identifiers:
 *
 * 1. `order_id` (new column) — permanent, globally-unique tracking reference
 *    formatted as `BR-{brandId}-{branchId}-{YYYYMMDD}-{seq}`
 *    (e.g. `BR-23-10-20260617-001`). Shared with customers for "track my order".
 *
 * 2. `order_number` (existing column, repurposed) — short daily call-out number,
 *    just the zero-padded sequence (e.g. `001`). Resets to `001` every day per
 *    branch+brand. This is what staff announce and displays on KDS/receipts.
 *
 * Because `order_number` now repeats across days, replace the old global unique
 * constraint with a composite unique index on (branch_id, brand_id, date, number).
 * `order_id` is globally unique and gets its own unique index.
 *
 * Existing orders keep their old long-format `order_number`; `order_id` is
 * nullable so old rows are unaffected.
 */
export class ShortOrderNumber1760000000022 implements MigrationInterface {
    name = 'ShortOrderNumber1760000000022';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Add the new permanent tracking column (nullable — old rows stay as-is)
        await queryRunner.query(`
            ALTER TABLE "orders"
            ADD COLUMN IF NOT EXISTS "order_id" character varying NULL
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_orders_order_id"
            ON "orders" ("order_id")
            WHERE "order_id" IS NOT NULL
        `);

        // Replace global unique constraint on order_number with a per-branch+brand+day index
        await queryRunner.query(
            `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "UQ_orders_order_number"`,
        );
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_orders_branch_brand_day_number"
            ON "orders" ("branch_id", "brand_id", (date("placed_at")), "order_number")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_orders_branch_brand_day_number"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_orders_order_id"`,
        );
        await queryRunner.query(`
            ALTER TABLE "orders" DROP COLUMN IF EXISTS "order_id"
        `);
        await queryRunner.query(
            `ALTER TABLE "orders" ADD CONSTRAINT "UQ_orders_order_number" UNIQUE ("order_number")`,
        );
    }
}
