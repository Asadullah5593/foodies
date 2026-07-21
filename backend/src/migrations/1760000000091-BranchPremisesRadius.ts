import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Adds the branch "premises": a circle around the branch's own coordinates
 * inside which a rider counts as physically on-site and therefore available.
 *
 * This is distinct from `delivery_radius_km`, which dispatch had been reusing
 * as a rider-proximity proxy. That column answers "how far will this branch
 * deliver to a customer" (kilometres, ~10 by default); the premises answers
 * "how close must a rider be to the restaurant to be assignable" (metres).
 * Conflating the two made the proximity rule a no-op in practice.
 *
 * Branches with no latitude/longitude cannot evaluate a premises; dispatch
 * treats those as unconfigured and skips the check rather than blocking every
 * assignment for that branch.
 */
export class BranchPremisesRadius1760000000091 implements MigrationInterface {
    name = 'BranchPremisesRadius1760000000091';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "branches"
             ADD COLUMN IF NOT EXISTS "premises_radius_m" integer NOT NULL DEFAULT 300`,
        );
        await queryRunner.query(
            `ALTER TABLE "branches"
             ADD CONSTRAINT "CHK_branches_premises_radius_positive"
             CHECK ("premises_radius_m" > 0)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "branches" DROP CONSTRAINT IF EXISTS "CHK_branches_premises_radius_positive"`,
        );
        await queryRunner.query(
            `ALTER TABLE "branches" DROP COLUMN IF EXISTS "premises_radius_m"`,
        );
    }
}
