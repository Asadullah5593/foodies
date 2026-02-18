import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Support one order with items from multiple brands (e.g. food court).
 * - orders.brand_id: make nullable (null when order has items from more than one brand).
 * - order_items.brand_id: add column, backfill from menu_items.brand_id.
 */
export class OrderMultiBrand1740000000013 implements MigrationInterface {
    name = 'OrderMultiBrand1740000000013';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "orders" ALTER COLUMN "brand_id" DROP NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "order_items" ADD COLUMN IF NOT EXISTS "brand_id" integer NULL`,
        );
        await queryRunner.query(`
      UPDATE "order_items" oi
      SET brand_id = (SELECT i.brand_id FROM "menu_items" i WHERE i.id = oi.menu_item_id LIMIT 1)
      WHERE oi.brand_id IS NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      UPDATE "orders" o SET brand_id = (SELECT brand_id FROM "order_items" WHERE order_id = o.id LIMIT 1)
      WHERE o.brand_id IS NULL
    `);
        await queryRunner.query(
            `ALTER TABLE "orders" ALTER COLUMN "brand_id" SET NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "order_items" DROP COLUMN IF EXISTS "brand_id"`,
        );
    }
}
