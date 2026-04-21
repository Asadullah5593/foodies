import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add rider assignment and delivery status to orders.
 * Rider role is created with no permissions (rider-only app access).
 */
export class OrderRiderAndDeliveryStatus1740000000015 implements MigrationInterface {
    name = 'OrderRiderAndDeliveryStatus1740000000015';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "rider_id" integer NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "delivery_status" varchar(32) NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "delivery_failed_reason" text NULL
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_orders_rider_id"
      ON "orders" ("rider_id")
    `);
        await queryRunner.query(`
      ALTER TABLE "orders"
      ADD CONSTRAINT "FK_orders_rider"
      FOREIGN KEY ("rider_id") REFERENCES "users"("id") ON DELETE SET NULL
      ON UPDATE NO ACTION
    `);

        // Insert Rider role (tenant_id NULL = global role like other roles)
        await queryRunner.query(`
      INSERT INTO "roles" ("tenant_id", "name", "slug", "created_at", "updated_at")
      SELECT NULL, 'Rider', 'rider', NOW(), NOW()
      WHERE NOT EXISTS (SELECT 1 FROM "roles" WHERE slug = 'rider')
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "FK_orders_rider"`,
        );
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_orders_rider_id"`);
        await queryRunner.query(
            `ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivery_failed_reason"`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" DROP COLUMN IF EXISTS "delivery_status"`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" DROP COLUMN IF EXISTS "rider_id"`,
        );
        await queryRunner.query(`DELETE FROM "roles" WHERE slug = 'rider'`);
    }
}
