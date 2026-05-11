import { MigrationInterface, QueryRunner } from 'typeorm';

export class CustomerOrderRatings1760000000010 implements MigrationInterface {
    name = 'CustomerOrderRatings1760000000010';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE "rider_order_ratings" (
        "id" SERIAL NOT NULL,
        "order_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "rider_user_id" integer NOT NULL,
        "stars" smallint NOT NULL,
        "order_item_ids" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_order_ratings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_rider_order_ratings_order_id" UNIQUE ("order_id"),
        CONSTRAINT "FK_rider_order_ratings_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_order_ratings_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_order_ratings_rider_user" FOREIGN KEY ("rider_user_id") REFERENCES "users"("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
        CONSTRAINT "CHK_rider_order_ratings_stars" CHECK ("stars" >= 1 AND "stars" <= 5)
      )
    `);
        await queryRunner.query(`
      CREATE INDEX "IDX_rider_order_ratings_rider_user_id"
      ON "rider_order_ratings" ("rider_user_id")
    `);

        await queryRunner.query(`
      CREATE TABLE "brand_order_ratings" (
        "id" SERIAL NOT NULL,
        "order_id" integer NOT NULL,
        "brand_id" integer NOT NULL,
        "customer_id" integer NOT NULL,
        "stars" smallint NOT NULL,
        "order_item_ids" jsonb NOT NULL DEFAULT '[]',
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_brand_order_ratings" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_brand_order_ratings_order_brand" UNIQUE ("order_id", "brand_id"),
        CONSTRAINT "FK_brand_order_ratings_order" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_brand_order_ratings_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_brand_order_ratings_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "CHK_brand_order_ratings_stars" CHECK ("stars" >= 1 AND "stars" <= 5)
      )
    `);
        await queryRunner.query(`
      CREATE INDEX "IDX_brand_order_ratings_brand_id"
      ON "brand_order_ratings" ("brand_id")
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "brand_order_ratings"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "rider_order_ratings"`);
    }
}
