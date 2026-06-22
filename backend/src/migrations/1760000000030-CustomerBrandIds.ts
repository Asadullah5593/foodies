import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Explicit customer↔brand association list. Lets a manually-created customer be
 * seen/selected by any sibling brand of the same tenant without duplicating the
 * (tenant, phone)-unique customer row. Visibility unions this with order history,
 * so existing customers stay visible via their orders (no backfill needed).
 */
export class CustomerBrandIds1760000000030 implements MigrationInterface {
    name = 'CustomerBrandIds1760000000030';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "customers"
            ADD COLUMN IF NOT EXISTS "brand_ids" jsonb
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "customers"
            DROP COLUMN IF EXISTS "brand_ids"
        `);
    }
}
