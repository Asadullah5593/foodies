import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phases 3 & 4 of "fully support the Fireaway menu":
 *  - Phase 3: deal_components.slot_surcharges — per-choice price upcharge within a deal slot
 *    (e.g. "upgrade wrap to Firey Special +Rs100").
 *  - Phase 4: discounts buy-X-get-Y (BOGO) fields — buy_quantity, get_quantity,
 *    get_discount_percent, bogo_match_same_group — used when discounts.type = 'buy_x_get_y'.
 */
export class DealUpsellAndBogo1760000000043 implements MigrationInterface {
    name = 'DealUpsellAndBogo1760000000043';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "deal_components"
                ADD COLUMN IF NOT EXISTS "slot_surcharges" jsonb
        `);
        await queryRunner.query(`
            ALTER TABLE "discounts"
                ADD COLUMN IF NOT EXISTS "buy_quantity" integer,
                ADD COLUMN IF NOT EXISTS "get_quantity" integer,
                ADD COLUMN IF NOT EXISTS "get_discount_percent" numeric(5,2),
                ADD COLUMN IF NOT EXISTS "bogo_match_same_group" boolean NOT NULL DEFAULT false
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "discounts"
                DROP COLUMN IF EXISTS "bogo_match_same_group",
                DROP COLUMN IF EXISTS "get_discount_percent",
                DROP COLUMN IF EXISTS "get_quantity",
                DROP COLUMN IF EXISTS "buy_quantity"
        `);
        await queryRunner.query(`
            ALTER TABLE "deal_components"
                DROP COLUMN IF EXISTS "slot_surcharges"
        `);
    }
}
