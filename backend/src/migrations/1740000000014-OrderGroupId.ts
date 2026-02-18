import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add order_group_id to orders so multiple orders from one cart (multi-brand) can be grouped.
 */
export class OrderGroupId1740000000014 implements MigrationInterface {
    name = 'OrderGroupId1740000000014';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "order_group_id" varchar(36) NULL
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_order_group_id"
      ON "orders" ("order_group_id")
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_orders_order_group_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" DROP COLUMN IF EXISTS "order_group_id"`,
        );
    }
}
