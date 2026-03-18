import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add deal_only flag to menu_items. When true, item is used only inside deals
 * and is hidden from POS as a standalone product.
 */
export class MenuItemDealOnly1740000000035 implements MigrationInterface {
    name = 'MenuItemDealOnly1740000000035';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "menu_items"
            ADD COLUMN IF NOT EXISTS "deal_only" boolean NOT NULL DEFAULT false
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "deal_only"`);
    }
}
