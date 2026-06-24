import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a recipe target a menu ADD-ON or a MODIFIER (not just a menu item/variant),
 * so add-ons and modifiers deduct their own ingredients on top of the base dish.
 *
 * A recipe now targets exactly one of:
 *   - a menu item (+ optional variant)  -> menu_item_id set
 *   - an add-on                         -> addon_id set
 *   - a modifier                        -> modifier_id set
 * Hence menu_item_id becomes nullable.
 */
export class RecipeAddonModifierTargets1760000000037 implements MigrationInterface {
    name = 'RecipeAddonModifierTargets1760000000037';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "recipes" ALTER COLUMN "menu_item_id" DROP NOT NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "recipes"
                ADD COLUMN IF NOT EXISTS "addon_id" integer,
                ADD COLUMN IF NOT EXISTS "modifier_id" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "recipes"
                ADD CONSTRAINT "FK_recipes_addon" FOREIGN KEY ("addon_id")
                    REFERENCES "menu_addons"("id") ON DELETE CASCADE,
                ADD CONSTRAINT "FK_recipes_modifier" FOREIGN KEY ("modifier_id")
                    REFERENCES "modifiers"("id") ON DELETE CASCADE
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_recipes_addon" ON "recipes" ("tenant_id", "addon_id")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_recipes_modifier" ON "recipes" ("tenant_id", "modifier_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_recipes_modifier"`);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_recipes_addon"`);
        await queryRunner.query(`
            ALTER TABLE "recipes"
                DROP CONSTRAINT IF EXISTS "FK_recipes_addon",
                DROP CONSTRAINT IF EXISTS "FK_recipes_modifier"
        `);
        await queryRunner.query(`
            ALTER TABLE "recipes"
                DROP COLUMN IF EXISTS "addon_id",
                DROP COLUMN IF EXISTS "modifier_id"
        `);
        // Note: menu_item_id is left nullable on rollback (re-adding NOT NULL would
        // fail if add-on/modifier recipes exist); harmless for a down migration.
    }
}
