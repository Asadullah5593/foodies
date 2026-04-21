import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderDeliveryLatLng1740000000039 implements MigrationInterface {
    name = 'OrderDeliveryLatLng1740000000039';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "delivery_latitude" DECIMAL(10, 7) NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "delivery_longitude" DECIMAL(10, 7) NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivery_longitude"
    `);
        await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivery_latitude"
    `);
    }
}
