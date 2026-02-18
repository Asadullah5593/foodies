import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Branch-scoped menu copies (copy-on-link).
 *
 * - Tenant menu-items/addons/variants remain tenant-level (branch_id NULL).
 * - When linking a menu-item to a branch, we create branch-level copies:
 *   - menu_items.branch_id = <branch>
 *   - menu_items.source_menu_item_id = <tenant menu item>
 *   - menu_variants.source_menu_variant_id = <tenant variant>
 *   - menu_addons.branch_id = <branch>
 *   - menu_addons.source_addon_id = <tenant addon>
 * - branch_menu_items points to the branch-level copied menu_item, and keeps a reference to the source item.
 */
export class BranchScopedMenuCopies1740000000008 implements MigrationInterface {
    name = 'BranchScopedMenuCopies1740000000008';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "menu_items"
      ADD COLUMN IF NOT EXISTS "branch_id" integer NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "menu_items"
      ADD COLUMN IF NOT EXISTS "source_menu_item_id" integer NULL
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_menu_items_branch_id" ON "menu_items" ("branch_id")
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_menu_items_source_menu_item_id" ON "menu_items" ("source_menu_item_id")
    `);

        await queryRunner.query(`
      ALTER TABLE "menu_variants"
      ADD COLUMN IF NOT EXISTS "source_menu_variant_id" integer NULL
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_menu_variants_source_menu_variant_id" ON "menu_variants" ("source_menu_variant_id")
    `);

        await queryRunner.query(`
      ALTER TABLE "menu_addons"
      ADD COLUMN IF NOT EXISTS "branch_id" integer NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "menu_addons"
      ADD COLUMN IF NOT EXISTS "source_addon_id" integer NULL
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_menu_addons_branch_id" ON "menu_addons" ("branch_id")
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_menu_addons_source_addon_id" ON "menu_addons" ("source_addon_id")
    `);

        await queryRunner.query(`
      ALTER TABLE "branch_menu_items"
      ADD COLUMN IF NOT EXISTS "source_menu_item_id" integer NULL
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_branch_menu_items_source_menu_item_id" ON "branch_menu_items" ("source_menu_item_id")
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_branch_menu_items_source_menu_item_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "branch_menu_items" DROP COLUMN IF EXISTS "source_menu_item_id"`,
        );

        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_menu_addons_source_addon_id"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_menu_addons_branch_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP COLUMN IF EXISTS "source_addon_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP COLUMN IF EXISTS "branch_id"`,
        );

        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_menu_variants_source_menu_variant_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_variants" DROP COLUMN IF EXISTS "source_menu_variant_id"`,
        );

        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_menu_items_source_menu_item_id"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "idx_menu_items_branch_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "source_menu_item_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "branch_id"`,
        );
    }
}
