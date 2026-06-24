import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brand-scoped inventory buckets.
 *
 * Adds a nullable `brand_id` to the on-hand / batch-on-hand / ledger tables so a
 * branch's stock can be allocated to brands (brand_id NULL = the branch's shared
 * pool, where GRN receipts land). A single batch's qty can be split across brand
 * buckets. Batches themselves stay branch-scoped (no brand_id on inventory_batches).
 *
 * Also:
 *  - Rebuilds the on-hand unique indexes as COALESCE-sentinel expression indexes so
 *    they include brand_id AND correctly treat NULL location/brand as a single bucket
 *    (the old plain UNIQUE(...location_id) let NULL-location rows duplicate because
 *    Postgres treats NULLs as distinct in a unique index).
 *  - Adds source/destination brand to transfer requests + orders (all 4 directions).
 *  - Makes order_inventory_allocations.inventory_batch_id nullable + adds brand_id, so
 *    allow-negative sales can record a batchless shortfall allocation that reverses cleanly.
 *  - Adds inventory_on_hand.negative_flagged_at as a denormalized flag for the UI.
 */
export class InventoryBrandBuckets1760000000036 implements MigrationInterface {
    name = 'InventoryBrandBuckets1760000000036';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Add brand_id columns (nullable; existing rows => NULL = branch pool).
        await queryRunner.query(`
            ALTER TABLE "inventory_on_hand"
                ADD COLUMN IF NOT EXISTS "brand_id" integer,
                ADD COLUMN IF NOT EXISTS "negative_flagged_at" timestamp
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_batch_on_hand"
                ADD COLUMN IF NOT EXISTS "brand_id" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_ledger_entries"
                ADD COLUMN IF NOT EXISTS "brand_id" integer
        `);

        await queryRunner.query(`
            ALTER TABLE "inventory_on_hand"
                ADD CONSTRAINT "FK_ioh_brand" FOREIGN KEY ("brand_id")
                REFERENCES "brands"("id") ON DELETE SET NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_batch_on_hand"
                ADD CONSTRAINT "FK_iboh_brand" FOREIGN KEY ("brand_id")
                REFERENCES "brands"("id") ON DELETE SET NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_ledger_entries"
                ADD CONSTRAINT "FK_ile_brand" FOREIGN KEY ("brand_id")
                REFERENCES "brands"("id") ON DELETE SET NULL
        `);

        // 2. Defensively collapse any pre-existing duplicate NULL-bucket rows before
        //    building the new unique index (the old constraint let them fan out).
        //    inventory_on_hand: key (branch, item, COALESCE(loc,0), COALESCE(brand,0))
        await queryRunner.query(`
            UPDATE "inventory_on_hand" t
            SET qty = agg.total_qty
            FROM (
                SELECT MIN(id) AS keep_id, SUM(qty) AS total_qty
                FROM "inventory_on_hand"
                GROUP BY branch_id, inventory_item_id,
                         COALESCE(location_id, 0), COALESCE(brand_id, 0)
                HAVING COUNT(*) > 1
            ) agg
            WHERE t.id = agg.keep_id
        `);
        await queryRunner.query(`
            DELETE FROM "inventory_on_hand" t
            USING (
                SELECT id,
                       MIN(id) OVER (
                           PARTITION BY branch_id, inventory_item_id,
                                        COALESCE(location_id, 0), COALESCE(brand_id, 0)
                       ) AS keep_id
                FROM "inventory_on_hand"
            ) d
            WHERE t.id = d.id AND d.id <> d.keep_id
        `);

        //    inventory_batch_on_hand: key (branch, batch, COALESCE(loc,0), COALESCE(brand,0))
        await queryRunner.query(`
            UPDATE "inventory_batch_on_hand" t
            SET qty = agg.total_qty
            FROM (
                SELECT MIN(id) AS keep_id, SUM(qty) AS total_qty
                FROM "inventory_batch_on_hand"
                GROUP BY branch_id, inventory_batch_id,
                         COALESCE(location_id, 0), COALESCE(brand_id, 0)
                HAVING COUNT(*) > 1
            ) agg
            WHERE t.id = agg.keep_id
        `);
        await queryRunner.query(`
            DELETE FROM "inventory_batch_on_hand" t
            USING (
                SELECT id,
                       MIN(id) OVER (
                           PARTITION BY branch_id, inventory_batch_id,
                                        COALESCE(location_id, 0), COALESCE(brand_id, 0)
                       ) AS keep_id
                FROM "inventory_batch_on_hand"
            ) d
            WHERE t.id = d.id AND d.id <> d.keep_id
        `);

        // 3. Swap the plain unique constraints for COALESCE-sentinel expression indexes
        //    that include brand_id (sentinel 0 is safe: real ids start at 1).
        await queryRunner.query(`
            ALTER TABLE "inventory_on_hand"
                DROP CONSTRAINT IF EXISTS "UQ_ioh_branch_item_location"
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ioh_branch_item_loc_brand"
                ON "inventory_on_hand"
                ("branch_id", "inventory_item_id",
                 COALESCE("location_id", 0), COALESCE("brand_id", 0))
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_batch_on_hand"
                DROP CONSTRAINT IF EXISTS "UQ_iboh_branch_batch_location"
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_iboh_branch_batch_loc_brand"
                ON "inventory_batch_on_hand"
                ("branch_id", "inventory_batch_id",
                 COALESCE("location_id", 0), COALESCE("brand_id", 0))
        `);

        // Helpful read index for per-brand ledger queries.
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_ile_brand_item"
                ON "inventory_ledger_entries"
                ("branch_id", "brand_id", "inventory_item_id", "created_at")
        `);

        // 4. Transfer source/destination brand (all 4 directions).
        await queryRunner.query(`
            ALTER TABLE "inventory_transfer_requests"
                ADD COLUMN IF NOT EXISTS "source_brand_id" integer,
                ADD COLUMN IF NOT EXISTS "destination_brand_id" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_transfer_orders"
                ADD COLUMN IF NOT EXISTS "source_brand_id" integer,
                ADD COLUMN IF NOT EXISTS "destination_brand_id" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_transfer_requests"
                ADD CONSTRAINT "FK_itr_source_brand" FOREIGN KEY ("source_brand_id")
                    REFERENCES "brands"("id") ON DELETE SET NULL,
                ADD CONSTRAINT "FK_itr_dest_brand" FOREIGN KEY ("destination_brand_id")
                    REFERENCES "brands"("id") ON DELETE SET NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_transfer_orders"
                ADD CONSTRAINT "FK_ito_source_brand" FOREIGN KEY ("source_brand_id")
                    REFERENCES "brands"("id") ON DELETE SET NULL,
                ADD CONSTRAINT "FK_ito_dest_brand" FOREIGN KEY ("destination_brand_id")
                    REFERENCES "brands"("id") ON DELETE SET NULL
        `);

        // 5. Allocations: batchless shortfall support + brand attribution.
        await queryRunner.query(`
            ALTER TABLE "order_inventory_allocations"
                ALTER COLUMN "inventory_batch_id" DROP NOT NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "order_inventory_allocations"
                ADD COLUMN IF NOT EXISTS "brand_id" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "order_inventory_allocations"
                ADD CONSTRAINT "FK_oia_brand" FOREIGN KEY ("brand_id")
                REFERENCES "brands"("id") ON DELETE SET NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "order_inventory_allocations"
                DROP CONSTRAINT IF EXISTS "FK_oia_brand"
        `);
        await queryRunner.query(`
            ALTER TABLE "order_inventory_allocations"
                DROP COLUMN IF EXISTS "brand_id"
        `);
        await queryRunner.query(`
            ALTER TABLE "order_inventory_allocations"
                ALTER COLUMN "inventory_batch_id" SET NOT NULL
        `);

        await queryRunner.query(`
            ALTER TABLE "inventory_transfer_orders"
                DROP CONSTRAINT IF EXISTS "FK_ito_source_brand",
                DROP CONSTRAINT IF EXISTS "FK_ito_dest_brand"
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_transfer_orders"
                DROP COLUMN IF EXISTS "source_brand_id",
                DROP COLUMN IF EXISTS "destination_brand_id"
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_transfer_requests"
                DROP CONSTRAINT IF EXISTS "FK_itr_source_brand",
                DROP CONSTRAINT IF EXISTS "FK_itr_dest_brand"
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_transfer_requests"
                DROP COLUMN IF EXISTS "source_brand_id",
                DROP COLUMN IF EXISTS "destination_brand_id"
        `);

        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ile_brand_item"`);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_iboh_branch_batch_loc_brand"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_ioh_branch_item_loc_brand"`,
        );
        await queryRunner.query(`
            ALTER TABLE "inventory_batch_on_hand"
                ADD CONSTRAINT "UQ_iboh_branch_batch_location"
                UNIQUE ("branch_id", "inventory_batch_id", "location_id")
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_on_hand"
                ADD CONSTRAINT "UQ_ioh_branch_item_location"
                UNIQUE ("branch_id", "inventory_item_id", "location_id")
        `);

        await queryRunner.query(`
            ALTER TABLE "inventory_ledger_entries"
                DROP CONSTRAINT IF EXISTS "FK_ile_brand"
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_ledger_entries" DROP COLUMN IF EXISTS "brand_id"
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_batch_on_hand"
                DROP CONSTRAINT IF EXISTS "FK_iboh_brand"
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_batch_on_hand" DROP COLUMN IF EXISTS "brand_id"
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_on_hand"
                DROP CONSTRAINT IF EXISTS "FK_ioh_brand"
        `);
        await queryRunner.query(`
            ALTER TABLE "inventory_on_hand"
                DROP COLUMN IF EXISTS "brand_id",
                DROP COLUMN IF EXISTS "negative_flagged_at"
        `);
    }
}
