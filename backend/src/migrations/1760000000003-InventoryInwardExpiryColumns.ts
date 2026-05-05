import { MigrationInterface, QueryRunner } from 'typeorm';

export class InventoryInwardExpiryColumns1760000000003 implements MigrationInterface {
    name = 'InventoryInwardExpiryColumns1760000000003';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE inventory_adjustment_lines
            ADD COLUMN IF NOT EXISTS lot_code character varying,
            ADD COLUMN IF NOT EXISTS expiry_date date
        `);

        await queryRunner.query(`
            ALTER TABLE inventory_transfer_receipt_lines
            ADD COLUMN IF NOT EXISTS lot_code character varying,
            ADD COLUMN IF NOT EXISTS expiry_date date
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE inventory_transfer_receipt_lines
            DROP COLUMN IF EXISTS expiry_date,
            DROP COLUMN IF EXISTS lot_code
        `);
        await queryRunner.query(`
            ALTER TABLE inventory_adjustment_lines
            DROP COLUMN IF EXISTS expiry_date,
            DROP COLUMN IF EXISTS lot_code
        `);
    }
}
