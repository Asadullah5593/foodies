import { MigrationInterface, QueryRunner } from 'typeorm';

export class InventoryItemMultipleBaseUnits1760000000007 implements MigrationInterface {
    name = 'InventoryItemMultipleBaseUnits1760000000007';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE inventory_items
            ADD COLUMN IF NOT EXISTS base_uom_ids integer[]
        `);

        await queryRunner.query(`
            UPDATE inventory_items
            SET base_uom_ids = ARRAY[base_uom_id]
            WHERE base_uom_ids IS NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE inventory_items
            DROP COLUMN IF EXISTS base_uom_ids
        `);
    }
}
