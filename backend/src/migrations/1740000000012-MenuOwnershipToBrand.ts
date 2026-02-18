import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Move menu ownership from Tenant → Brand.
 * - menu_categories, menu_items, menu_addons: add brand_id, backfill from tenant, drop tenant_id and copy columns.
 * - branch_menu_items: point to brand-level item only; drop source_menu_item_id; add is_hidden_online.
 * - Remove branch-level copies (menu_items/menu_addons with branch_id set).
 */
export class MenuOwnershipToBrand1740000000012 implements MigrationInterface {
    name = 'MenuOwnershipToBrand1740000000012';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. Add brand_id (nullable), backfill from tenant (one brand per tenant)
        await queryRunner.query(
            `ALTER TABLE "menu_categories" ADD COLUMN IF NOT EXISTS "brand_id" integer NULL`,
        );
        await queryRunner.query(`
      UPDATE "menu_categories" c
      SET brand_id = (SELECT b.id FROM "brands" b WHERE b.tenant_id = c.tenant_id ORDER BY b.id LIMIT 1)
      WHERE c.tenant_id IS NOT NULL
    `);
        await queryRunner.query(
            `ALTER TABLE "menu_categories" ALTER COLUMN "brand_id" SET NOT NULL`,
        );
        await queryRunner.query(`
      ALTER TABLE "menu_categories" ADD CONSTRAINT "FK_menu_categories_brand"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
    `);

        await queryRunner.query(
            `ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "brand_id" integer NULL`,
        );
        await queryRunner.query(`
      UPDATE "menu_items" i
      SET brand_id = (SELECT b.id FROM "brands" b WHERE b.tenant_id = i.tenant_id ORDER BY b.id LIMIT 1)
      WHERE i.tenant_id IS NOT NULL AND i.branch_id IS NULL
    `);
        // Branch-level copies: set brand_id from their source item's tenant
        await queryRunner.query(`
      UPDATE "menu_items" i
      SET brand_id = (SELECT b.id FROM "brands" b
        JOIN "menu_items" src ON src.id = i.source_menu_item_id AND src.tenant_id = b.tenant_id
        ORDER BY b.id LIMIT 1)
      WHERE i.branch_id IS NOT NULL AND i.source_menu_item_id IS NOT NULL
    `);

        await queryRunner.query(
            `ALTER TABLE "menu_addons" ADD COLUMN IF NOT EXISTS "brand_id" integer NULL`,
        );
        await queryRunner.query(`
      UPDATE "menu_addons" a
      SET brand_id = (SELECT b.id FROM "brands" b WHERE b.tenant_id = a.tenant_id ORDER BY b.id LIMIT 1)
      WHERE a.tenant_id IS NOT NULL AND a.branch_id IS NULL
    `);
        await queryRunner.query(`
      UPDATE "menu_addons" a
      SET brand_id = (SELECT b.id FROM "brands" b
        JOIN "menu_addons" src ON src.id = a.source_addon_id AND src.tenant_id = b.tenant_id
        ORDER BY b.id LIMIT 1)
      WHERE a.branch_id IS NOT NULL AND a.source_addon_id IS NOT NULL
    `);

        // 2. Point branch_menu_items to the source (brand-level) item before we delete copies.
        // Collapse duplicates: keep one row per (branch_id, source_menu_item_id), then set menu_item_id = source_menu_item_id.
        await queryRunner.query(`
      DELETE FROM "branch_menu_items" a
      USING "branch_menu_items" b
      WHERE a.branch_id = b.branch_id AND a.source_menu_item_id = b.source_menu_item_id
        AND a.source_menu_item_id IS NOT NULL AND a.id > b.id
    `);
        await queryRunner.query(`
      UPDATE "branch_menu_items" bmi
      SET menu_item_id = bmi.source_menu_item_id
      WHERE bmi.source_menu_item_id IS NOT NULL
    `);

        // 3. Delete branch-level menu item copies (cascade will remove their variants and menu_item_addons links)
        await queryRunner.query(
            `DELETE FROM "menu_items" WHERE "branch_id" IS NOT NULL`,
        );
        await queryRunner.query(
            `DELETE FROM "menu_addons" WHERE "branch_id" IS NOT NULL`,
        );

        // 4. Ensure all remaining menu_items have brand_id (tenant-level items only now)
        await queryRunner.query(`
      UPDATE "menu_items" i
      SET brand_id = (SELECT b.id FROM "brands" b WHERE b.tenant_id = i.tenant_id ORDER BY b.id LIMIT 1)
      WHERE i.brand_id IS NULL AND i.tenant_id IS NOT NULL
    `);
        await queryRunner.query(
            `ALTER TABLE "menu_items" ALTER COLUMN "brand_id" SET NOT NULL`,
        );
        await queryRunner.query(`
      ALTER TABLE "menu_items" ADD CONSTRAINT "FK_menu_items_brand"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
    `);
        await queryRunner.query(`
      UPDATE "menu_addons" a
      SET brand_id = (SELECT b.id FROM "brands" b WHERE b.tenant_id = a.tenant_id ORDER BY b.id LIMIT 1)
      WHERE a.brand_id IS NULL AND a.tenant_id IS NOT NULL
    `);
        await queryRunner.query(
            `ALTER TABLE "menu_addons" ALTER COLUMN "brand_id" SET NOT NULL`,
        );
        await queryRunner.query(`
      ALTER TABLE "menu_addons" ADD CONSTRAINT "FK_menu_addons_brand"
      FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
    `);

        // 5. branch_menu_items: add is_hidden_online, drop source_menu_item_id
        await queryRunner.query(`
      ALTER TABLE "branch_menu_items"
      ADD COLUMN IF NOT EXISTS "is_hidden_online" boolean NOT NULL DEFAULT false
    `);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_branch_menu_items_source_menu_item_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "branch_menu_items" DROP COLUMN IF EXISTS "source_menu_item_id"`,
        );

        // 6. Drop tenant_id and copy columns from menu tables
        await queryRunner.query(
            `ALTER TABLE "menu_categories" DROP CONSTRAINT IF EXISTS "FK_menu_categories_tenant"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_categories" DROP COLUMN IF EXISTS "tenant_id"`,
        );

        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP CONSTRAINT IF EXISTS "FK_menu_items_tenant"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_menu_items_branch_id"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_menu_items_source_menu_item_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "tenant_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "branch_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "source_menu_item_id"`,
        );

        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP CONSTRAINT IF EXISTS "FK_menu_addons_tenant"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_menu_addons_branch_id"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_menu_addons_source_addon_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP COLUMN IF EXISTS "tenant_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP COLUMN IF EXISTS "branch_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP COLUMN IF EXISTS "source_addon_id"`,
        );

        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_menu_variants_source_menu_variant_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_variants" DROP COLUMN IF EXISTS "source_menu_variant_id"`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Re-add tenant_id and copy columns (simplified: no data restore)
        await queryRunner.query(
            `ALTER TABLE "menu_categories" ADD COLUMN IF NOT EXISTS "tenant_id" integer NULL`,
        );
        await queryRunner.query(`
      UPDATE "menu_categories" c
      SET tenant_id = b.tenant_id FROM "brands" b WHERE b.id = c.brand_id
    `);
        await queryRunner.query(
            `ALTER TABLE "menu_categories" DROP CONSTRAINT IF EXISTS "FK_menu_categories_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_categories" DROP COLUMN IF EXISTS "brand_id"`,
        );
        await queryRunner.query(`
      ALTER TABLE "menu_categories" ADD CONSTRAINT "FK_menu_categories_tenant"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
    `);

        await queryRunner.query(
            `ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "tenant_id" integer NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "branch_id" integer NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "source_menu_item_id" integer NULL`,
        );
        await queryRunner.query(`
      UPDATE "menu_items" i SET tenant_id = b.tenant_id FROM "brands" b WHERE b.id = i.brand_id
    `);
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP CONSTRAINT IF EXISTS "FK_menu_items_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "brand_id"`,
        );
        await queryRunner.query(`
      ALTER TABLE "menu_items" ADD CONSTRAINT "FK_menu_items_tenant"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
    `);

        await queryRunner.query(
            `ALTER TABLE "menu_addons" ADD COLUMN IF NOT EXISTS "tenant_id" integer NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" ADD COLUMN IF NOT EXISTS "branch_id" integer NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" ADD COLUMN IF NOT EXISTS "source_addon_id" integer NULL`,
        );
        await queryRunner.query(`
      UPDATE "menu_addons" a SET tenant_id = b.tenant_id FROM "brands" b WHERE b.id = a.brand_id
    `);
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP CONSTRAINT IF EXISTS "FK_menu_addons_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP COLUMN IF EXISTS "brand_id"`,
        );
        await queryRunner.query(`
      ALTER TABLE "menu_addons" ADD CONSTRAINT "FK_menu_addons_tenant"
      FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE
    `);

        await queryRunner.query(
            `ALTER TABLE "menu_variants" ADD COLUMN IF NOT EXISTS "source_menu_variant_id" integer NULL`,
        );

        await queryRunner.query(
            `ALTER TABLE "branch_menu_items" ADD COLUMN IF NOT EXISTS "source_menu_item_id" integer NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "branch_menu_items" DROP COLUMN IF EXISTS "is_hidden_online"`,
        );
    }
}
