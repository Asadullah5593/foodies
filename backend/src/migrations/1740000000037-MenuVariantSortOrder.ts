import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add explicit display ordering for menu variants.
 */
export class MenuVariantSortOrder1740000000037 implements MigrationInterface {
    name = 'MenuVariantSortOrder1740000000037';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "menu_variants"
            ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "menu_variants"
            DROP COLUMN IF EXISTS "sort_order"
        `);
    }
}
