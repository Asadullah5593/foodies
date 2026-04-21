import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderItemModifierQuantity1740000000040 implements MigrationInterface {
    name = 'OrderItemModifierQuantity1740000000040';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "order_item_modifiers"
      ADD COLUMN IF NOT EXISTS "quantity" integer NOT NULL DEFAULT 1
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "order_item_modifiers"
      DROP COLUMN IF EXISTS "quantity"
    `);
    }
}
