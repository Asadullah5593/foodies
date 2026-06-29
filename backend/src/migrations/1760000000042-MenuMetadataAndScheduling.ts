import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phases 2 & 5 of "fully support the Fireaway menu":
 *  - Phase 5 metadata: menu_items.allergens/calories, menu_categories.description/image_url.
 *  - Phase 2 scheduling: menu_items recurring availability window
 *    (available_time_start/end + available_days_of_week) for time-restricted offers
 *    such as lunch deals (Mon–Fri 12:00–16:00).
 * All columns are nullable so existing rows are unaffected.
 */
export class MenuMetadataAndScheduling1760000000042 implements MigrationInterface {
    name = 'MenuMetadataAndScheduling1760000000042';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "menu_items"
                ADD COLUMN IF NOT EXISTS "allergens" jsonb,
                ADD COLUMN IF NOT EXISTS "calories" integer,
                ADD COLUMN IF NOT EXISTS "available_time_start" time,
                ADD COLUMN IF NOT EXISTS "available_time_end" time,
                ADD COLUMN IF NOT EXISTS "available_days_of_week" jsonb
        `);
        await queryRunner.query(`
            ALTER TABLE "menu_categories"
                ADD COLUMN IF NOT EXISTS "description" text,
                ADD COLUMN IF NOT EXISTS "image_url" character varying
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "menu_categories"
                DROP COLUMN IF EXISTS "image_url",
                DROP COLUMN IF EXISTS "description"
        `);
        await queryRunner.query(`
            ALTER TABLE "menu_items"
                DROP COLUMN IF EXISTS "available_days_of_week",
                DROP COLUMN IF EXISTS "available_time_end",
                DROP COLUMN IF EXISTS "available_time_start",
                DROP COLUMN IF EXISTS "calories",
                DROP COLUMN IF EXISTS "allergens"
        `);
    }
}
