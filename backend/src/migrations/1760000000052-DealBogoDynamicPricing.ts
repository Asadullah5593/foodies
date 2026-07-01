import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dynamic "Buy One Get One" deal pricing.
 *
 * menu_items (deal root): deal_pricing_mode ('bogo') + buy/get/percent params.
 * deal_components: allowed_size_keys (e.g. ['12','14']) + cross-slot mirror constraint
 * (mirror_slot_index / mirror_match_size / mirror_match_category) so the 2nd pizza must
 * match the first's size and category.
 *
 * All columns nullable / defaulted, so the existing fixed-price deals are untouched
 * (deal_pricing_mode NULL = legacy behaviour).
 */
export class DealBogoDynamicPricing1760000000052 implements MigrationInterface {
    name = 'DealBogoDynamicPricing1760000000052';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "menu_items"
                ADD COLUMN IF NOT EXISTS "deal_pricing_mode" character varying(16),
                ADD COLUMN IF NOT EXISTS "deal_bogo_buy_quantity" integer,
                ADD COLUMN IF NOT EXISTS "deal_bogo_get_quantity" integer,
                ADD COLUMN IF NOT EXISTS "deal_bogo_get_percent" numeric(5,2)
        `);
        await queryRunner.query(`
            ALTER TABLE "deal_components"
                ADD COLUMN IF NOT EXISTS "allowed_size_keys" jsonb,
                ADD COLUMN IF NOT EXISTS "mirror_slot_index" integer,
                ADD COLUMN IF NOT EXISTS "mirror_match_size" boolean NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS "mirror_match_category" boolean NOT NULL DEFAULT false
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "deal_components"
                DROP COLUMN IF EXISTS "mirror_match_category",
                DROP COLUMN IF EXISTS "mirror_match_size",
                DROP COLUMN IF EXISTS "mirror_slot_index",
                DROP COLUMN IF EXISTS "allowed_size_keys"
        `);
        await queryRunner.query(`
            ALTER TABLE "menu_items"
                DROP COLUMN IF EXISTS "deal_bogo_get_percent",
                DROP COLUMN IF EXISTS "deal_bogo_get_quantity",
                DROP COLUMN IF EXISTS "deal_bogo_buy_quantity",
                DROP COLUMN IF EXISTS "deal_pricing_mode"
        `);
    }
}
