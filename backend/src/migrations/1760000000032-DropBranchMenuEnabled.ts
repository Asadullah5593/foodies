import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Retire branch.menu_enabled. It was nearly redundant with is_active at the
 * consumer layer; is_active is now the single whole-branch switch and the new
 * per-(branch,brand) is_open handles granular online pauses.
 * Preserve intent: a branch that was menu-disabled but "active" took no orders,
 * so mark it inactive before dropping the column.
 */
export class DropBranchMenuEnabled1760000000032 implements MigrationInterface {
    name = 'DropBranchMenuEnabled1760000000032';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "branches" SET "is_active" = false
            WHERE "menu_enabled" = false AND "is_active" = true
        `);
        await queryRunner.query(`
            ALTER TABLE "branches" DROP COLUMN IF EXISTS "menu_enabled"
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Re-add the column (default open); prior values are not restorable.
        await queryRunner.query(`
            ALTER TABLE "branches"
            ADD COLUMN IF NOT EXISTS "menu_enabled" boolean NOT NULL DEFAULT true
        `);
    }
}
