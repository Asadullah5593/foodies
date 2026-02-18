import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCategoryIdToMenuAddons1740000000002 implements MigrationInterface {
    name = 'AddCategoryIdToMenuAddons1740000000002';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "menu_addons"
      ADD COLUMN IF NOT EXISTS "category_id" integer NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "menu_addons"
      ADD CONSTRAINT "FK_menu_addons_category"
      FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE SET NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP CONSTRAINT IF EXISTS "FK_menu_addons_category"`,
        );
        await queryRunner.query(
            `ALTER TABLE "menu_addons" DROP COLUMN IF EXISTS "category_id"`,
        );
    }
}
