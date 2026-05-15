import { MigrationInterface, QueryRunner } from 'typeorm';

export class RiderLocationSummariesAndRetentionIndexes1760000000011 implements MigrationInterface {
    name = 'RiderLocationSummariesAndRetentionIndexes1760000000011';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_order_location_summaries" (
        "id" SERIAL NOT NULL,
        "order_id" integer NOT NULL,
        "points_count" integer NOT NULL DEFAULT 0,
        "start_latitude" decimal(10,7),
        "start_longitude" decimal(10,7),
        "end_latitude" decimal(10,7),
        "end_longitude" decimal(10,7),
        "start_recorded_at" TIMESTAMP,
        "end_recorded_at" TIMESTAMP,
        "sampled_path" jsonb,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_order_location_summaries" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_rider_order_location_summaries_order_id" UNIQUE ("order_id")
      )
    `);

        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_order_locations_created_at"
      ON "rider_order_locations" ("created_at" ASC)
    `);

        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_order_location_summaries_end_recorded_at"
      ON "rider_order_location_summaries" ("end_recorded_at" ASC)
    `);

        await queryRunner.query(`
      ALTER TABLE "rider_order_location_summaries"
      ADD CONSTRAINT "FK_rider_order_location_summaries_order"
      FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE
      ON UPDATE NO ACTION
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "rider_order_location_summaries" DROP CONSTRAINT IF EXISTS "FK_rider_order_location_summaries_order"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_order_location_summaries_end_recorded_at"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_order_locations_created_at"`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS "rider_order_location_summaries"`,
        );
    }
}
