import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add requires_code: when false, discount is auto-applied when scope/eligibility match.
 * When true, discount is coupon/promo only (applied when user enters the code).
 */
export class DiscountRequiresCode1740000000007 implements MigrationInterface {
    name = 'DiscountRequiresCode1740000000007';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "discounts"
      ADD COLUMN IF NOT EXISTS "requires_code" boolean NOT NULL DEFAULT true
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "discounts" DROP COLUMN IF EXISTS "requires_code"`,
        );
    }
}
