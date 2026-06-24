import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Tier-based delivery: per-brand opt-in Saver/Standard/Priority delivery with
 * distance-band fees + static ETAs (stored in brands.delivery_tiers json), and
 * the chosen tier + ETA snapshot persisted on each order.
 */
export class DeliveryTiers1760000000034 implements MigrationInterface {
    name = 'DeliveryTiers1760000000034';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "brands"
                ADD COLUMN IF NOT EXISTS "delivery_tiers_enabled" boolean NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS "delivery_tiers" text
        `);
        await queryRunner.query(`
            ALTER TABLE "orders"
                ADD COLUMN IF NOT EXISTS "delivery_tier" varchar(16),
                ADD COLUMN IF NOT EXISTS "delivery_eta_min_minutes" integer,
                ADD COLUMN IF NOT EXISTS "delivery_eta_max_minutes" integer
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "orders"
                DROP COLUMN IF EXISTS "delivery_tier",
                DROP COLUMN IF EXISTS "delivery_eta_min_minutes",
                DROP COLUMN IF EXISTS "delivery_eta_max_minutes"
        `);
        await queryRunner.query(`
            ALTER TABLE "brands"
                DROP COLUMN IF EXISTS "delivery_tiers_enabled",
                DROP COLUMN IF EXISTS "delivery_tiers"
        `);
    }
}
