import { MigrationInterface, QueryRunner } from 'typeorm';

export class BrandOrderRatingComment1760000000013 implements MigrationInterface {
    name = 'BrandOrderRatingComment1760000000013';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "brand_order_ratings"
      ADD COLUMN IF NOT EXISTS "comment" text
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "brand_order_ratings"
      DROP COLUMN IF EXISTS "comment"
    `);
    }
}
