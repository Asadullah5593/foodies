import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A branch assignment could lock a user to ONE brand, because branch_users is
 * keyed on (branch_id, user_id) — one row per user per branch, holding one
 * brand_id. Staff who work two of a branch's brands had no way to say so: the
 * only alternatives were one brand or all of them.
 *
 * brand_ids holds the full set. brand_id stays, carrying the FIRST of them, so
 * any reader still on the single column sees a lock that is narrower than the
 * truth rather than none at all — a missed reader restricts, it never leaks.
 * Existing rows are backfilled so reads are uniform from the first request.
 *
 * An int[] cannot carry a foreign key, so a deleted brand leaves a dangling id
 * here where brand_id would have been nulled. Readers join brands to resolve
 * the set, which drops anything stale.
 */
export class BranchUserMultiBrand1760000000124 implements MigrationInterface {
    name = 'BranchUserMultiBrand1760000000124';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "branch_users" ADD COLUMN IF NOT EXISTS "brand_ids" integer[]`,
        );
        await queryRunner.query(
            `UPDATE "branch_users"
             SET "brand_ids" = ARRAY["brand_id"]
             WHERE "brand_id" IS NOT NULL AND "brand_ids" IS NULL`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // brand_id already carries the first brand of every row, so dropping the
        // column loses only the extra brands — the lock itself survives.
        await queryRunner.query(
            `ALTER TABLE "branch_users" DROP COLUMN IF EXISTS "brand_ids"`,
        );
    }
}
