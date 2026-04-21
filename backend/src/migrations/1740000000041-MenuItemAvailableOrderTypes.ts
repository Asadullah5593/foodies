import { MigrationInterface, QueryRunner } from 'typeorm';

export class MenuItemAvailableOrderTypes1740000000041 implements MigrationInterface {
    name = 'MenuItemAvailableOrderTypes1740000000041';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "menu_items"
      ADD COLUMN IF NOT EXISTS "available_for_order_types" jsonb NULL
    `);
        await queryRunner.query(`
      COMMENT ON COLUMN "menu_items"."available_for_order_types" IS
        'JSON array of channels: delivery, pickup, dine_in. NULL = all channels (legacy). POS takeaway maps to pickup.'
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "menu_items"
      DROP COLUMN IF EXISTS "available_for_order_types"
    `);
    }
}
