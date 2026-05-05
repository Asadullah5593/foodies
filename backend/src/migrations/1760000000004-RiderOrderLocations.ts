import { MigrationInterface, QueryRunner } from 'typeorm';

export class RiderOrderLocations1760000000004 implements MigrationInterface {
    name = 'RiderOrderLocations1760000000004';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_order_locations" (
        "id" SERIAL NOT NULL,
        "order_id" integer NOT NULL,
        "latitude" decimal(10,7) NOT NULL,
        "longitude" decimal(10,7) NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_order_locations" PRIMARY KEY ("id")
      )
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_order_locations_order_created"
      ON "rider_order_locations" ("order_id", "created_at" DESC)
    `);
        await queryRunner.query(`
      ALTER TABLE "rider_order_locations"
      ADD CONSTRAINT "FK_rider_order_locations_order"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "rider_order_locations" DROP CONSTRAINT IF EXISTS "FK_rider_order_locations_order"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_order_locations_order_created"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "rider_order_locations"`);
    }
}
