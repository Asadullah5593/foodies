import { MigrationInterface, QueryRunner } from 'typeorm';

export class InventoryItemDefaultBuyPrice1760000000008
    implements MigrationInterface
{
    name = 'InventoryItemDefaultBuyPrice1760000000008';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE inventory_items
            ADD COLUMN IF NOT EXISTS default_buy_price numeric(18,6)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE inventory_items
            DROP COLUMN IF EXISTS default_buy_price
        `);
    }
}

