import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 of "fully support the Fireaway menu": size-dependent topping pricing and
 * "first N included free" allowances.
 *
 * - menu_variants.size_key            : normalized size ('7','10','12','14') so shared
 *                                        modifier groups can price per pizza size.
 * - modifiers.price_by_size           : { "7":99, "10":149, ... } surcharge per size.
 * - modifier_groups.included_quantity : units included free before charging.
 * - modifier_groups.included_by_size  : per-size override of included_quantity.
 * - order_item_modifiers.free_quantity / variant_size_snapshot : capture how the line
 *                                        was priced so receipts/refunds reconstruct it.
 *
 * Backfills size_key from existing variant names that contain an inch mark (e.g. 'Large 12"').
 * All new pricing columns are nullable / default 0 so every existing modifier keeps its
 * current flat behaviour until per-size data is entered.
 */
export class PerSizeModifierPricing1760000000041 implements MigrationInterface {
    name = 'PerSizeModifierPricing1760000000041';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "menu_variants"
                ADD COLUMN IF NOT EXISTS "size_key" character varying(32)
        `);
        await queryRunner.query(`
            ALTER TABLE "modifiers"
                ADD COLUMN IF NOT EXISTS "price_by_size" jsonb
        `);
        await queryRunner.query(`
            ALTER TABLE "modifier_groups"
                ADD COLUMN IF NOT EXISTS "included_quantity" integer NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS "included_by_size" jsonb
        `);
        await queryRunner.query(`
            ALTER TABLE "order_item_modifiers"
                ADD COLUMN IF NOT EXISTS "free_quantity" integer NOT NULL DEFAULT 0,
                ADD COLUMN IF NOT EXISTS "variant_size_snapshot" character varying(32)
        `);

        // Best-effort backfill: pull the inch number out of pizza variant names
        // (e.g. 'Small 7"' -> '7', 'Extra Large 14"' -> '14'). Non-pizza variants
        // (e.g. '500ml', '5 Pc') have no inch mark and are left NULL.
        await queryRunner.query(`
            UPDATE "menu_variants"
            SET "size_key" = substring("name" from '([0-9]+)\\s*["”]')
            WHERE "size_key" IS NULL
              AND "name" ~ '[0-9]+\\s*["”]'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "order_item_modifiers"
                DROP COLUMN IF EXISTS "variant_size_snapshot",
                DROP COLUMN IF EXISTS "free_quantity"
        `);
        await queryRunner.query(`
            ALTER TABLE "modifier_groups"
                DROP COLUMN IF EXISTS "included_by_size",
                DROP COLUMN IF EXISTS "included_quantity"
        `);
        await queryRunner.query(`
            ALTER TABLE "modifiers" DROP COLUMN IF EXISTS "price_by_size"
        `);
        await queryRunner.query(`
            ALTER TABLE "menu_variants" DROP COLUMN IF EXISTS "size_key"
        `);
    }
}
