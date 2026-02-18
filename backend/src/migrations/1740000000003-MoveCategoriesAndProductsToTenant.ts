import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Products and categories become tenant-based. Brands inherit from tenant.
 * - menu_categories: brand_id → tenant_id
 * - menu_items: brand_id → tenant_id
 * - menu_addons: brand_id → tenant_id
 */
export class MoveCategoriesAndProductsToTenant1740000000003 implements MigrationInterface {
    name = 'MoveCategoriesAndProductsToTenant1740000000003';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. menu_categories: add tenant_id, backfill, drop brand_id
        await queryRunner.query(`
      ALTER TABLE "menu_categories"
      ADD COLUMN IF NOT EXISTS "tenant_id" integer NULL
    `);
        await queryRunner.query(`
      UPDATE "menu_categories" c
      SET tenant_id = b.tenant_id
      FROM "brands" b
      WHERE c.brand_id = b.id
    `);
        await queryRunner.query(
            `ALTER TABLE "menu_categories" ALTER COLUMN "tenant_id" SET NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_categories" DROP CONSTRAINT IF EXISTS "FK_menu_categories_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_categories" DROP COLUMN IF EXISTS "brand_id"`,
        );
        await queryRunner.query(`
      ALTER TABLE "menu_categories"
      ADD CONSTRAINT "FK_menu_categories_tenant"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
    `);

        // 2. menu_items: add tenant_id, backfill, drop brand_id
        await queryRunner.query(`
      ALTER TABLE "menu_items"
      ADD COLUMN IF NOT EXISTS "tenant_id" integer NULL
    `);
        await queryRunner.query(`
      UPDATE "menu_items" i
      SET tenant_id = b.tenant_id
      FROM "brands" b
      WHERE i.brand_id = b.id
    `);
        await queryRunner.query(
            `ALTER TABLE "menu_items" ALTER COLUMN "tenant_id" SET NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP CONSTRAINT IF EXISTS "FK_menu_items_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "brand_id"`,
        );
        await queryRunner.query(`
      ALTER TABLE "menu_items"
      ADD CONSTRAINT "FK_menu_items_tenant"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
    `);

        // 3. menu_addons: add tenant_id, backfill, drop brand_id
        await queryRunner.query(`
      ALTER TABLE "menu_addons"
      ADD COLUMN IF NOT EXISTS "tenant_id" integer NULL
    `);
        await queryRunner.query(`
      UPDATE "menu_addons" a
      SET tenant_id = b.tenant_id
      FROM "brands" b
      WHERE a.brand_id = b.id
    `);
        await queryRunner.query(
            `ALTER TABLE "menu_addons" ALTER COLUMN "tenant_id" SET NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP CONSTRAINT IF EXISTS "FK_menu_addons_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP COLUMN IF EXISTS "brand_id"`,
        );
        await queryRunner.query(`
      ALTER TABLE "menu_addons"
      ADD CONSTRAINT "FK_menu_addons_tenant"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Reverse: add brand_id back (we'd need a default brand per tenant - skip full restore)
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP CONSTRAINT IF EXISTS "FK_menu_addons_tenant"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP COLUMN IF EXISTS "tenant_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP CONSTRAINT IF EXISTS "FK_menu_items_tenant"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "tenant_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_categories" DROP CONSTRAINT IF EXISTS "FK_menu_categories_tenant"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_categories" DROP COLUMN IF EXISTS "tenant_id"`,
        );
    }
}
