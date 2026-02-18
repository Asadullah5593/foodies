import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add discount application scope (whole order / category / products) and
 * eligibility (which branches/brands can use this discount). All remain tenant-scoped.
 */
export class DiscountScopeAndEligibility1740000000006 implements MigrationInterface {
    name = 'DiscountScopeAndEligibility1740000000006';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "discounts"
      ADD COLUMN IF NOT EXISTS "application_scope" character varying NOT NULL DEFAULT 'whole_order',
      ADD COLUMN IF NOT EXISTS "application_scope_ids" jsonb,
      ADD COLUMN IF NOT EXISTS "eligibility_branch_ids" jsonb,
      ADD COLUMN IF NOT EXISTS "eligibility_brand_ids" jsonb
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "discounts"
      DROP COLUMN IF EXISTS "application_scope",
      DROP COLUMN IF EXISTS "application_scope_ids",
      DROP COLUMN IF EXISTS "eligibility_branch_ids",
      DROP COLUMN IF EXISTS "eligibility_brand_ids"
    `);
    }
}
