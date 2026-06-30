import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * - menu_items.label       : short badge/tag (e.g. "Classic", "Signature") shown on the item.
 * - deal_components.slot_size_key : lock a deal slot's chosen item to one variant size
 *                            (e.g. '12' = "All 12\" pizza options") so customization is size-fixed.
 */
export class ItemLabelAndDealSlotSize1760000000050 implements MigrationInterface {
    name = 'ItemLabelAndDealSlotSize1760000000050';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "label" character varying(40)
        `);
        await queryRunner.query(`
            ALTER TABLE "deal_components" ADD COLUMN IF NOT EXISTS "slot_size_key" character varying(32)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "deal_components" DROP COLUMN IF EXISTS "slot_size_key"
        `);
        await queryRunner.query(`
            ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "label"
        `);
    }
}
