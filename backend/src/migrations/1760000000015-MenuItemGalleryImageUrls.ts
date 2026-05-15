import { MigrationInterface, QueryRunner } from 'typeorm';

export class MenuItemGalleryImageUrls1760000000015 implements MigrationInterface {
    name = 'MenuItemGalleryImageUrls1760000000015';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "menu_items"
      ADD COLUMN IF NOT EXISTS "gallery_image_urls" jsonb NULL
    `);
        await queryRunner.query(`
      COMMENT ON COLUMN "menu_items"."gallery_image_urls" IS
      'Optional ordered list of extra image URLs for consumer product gallery/slider below the main image_url. Main image stays in image_url.'
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "gallery_image_urls"
    `);
    }
}
