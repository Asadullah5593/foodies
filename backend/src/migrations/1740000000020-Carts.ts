import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cart and cart_items for consumer app.
 */
export class Carts1740000000020 implements MigrationInterface {
    name = 'Carts1740000000020';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "carts" (
        "id" SERIAL NOT NULL,
        "customer_id" integer NOT NULL,
        "branch_id" integer NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_carts" PRIMARY KEY ("id"),
        CONSTRAINT "FK_carts_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_carts_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE
      )
    `);
        await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_carts_customer_branch"
      ON "carts" ("customer_id", "branch_id")
    `);
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "cart_items" (
        "id" SERIAL NOT NULL,
        "cart_id" integer NOT NULL,
        "menu_item_id" integer NOT NULL,
        "variant_id" integer NULL,
        "quantity" integer NOT NULL DEFAULT 1,
        "notes" character varying NULL,
        "addons" jsonb NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_cart_items" PRIMARY KEY ("id"),
        CONSTRAINT "FK_cart_items_cart" FOREIGN KEY ("cart_id") REFERENCES "carts"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_cart_items_menu_item" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_cart_items_variant" FOREIGN KEY ("variant_id") REFERENCES "menu_variants"("id") ON DELETE SET NULL
      )
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "cart_items"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "carts"`);
    }
}
