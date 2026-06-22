import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-(branch,brand) online open/close switch. Lets a single brand pause its
 * online orders (consumer app/web/kiosk) at one branch, independent of the
 * whole-branch isActive switch and of POS shifts.
 */
export class BranchBrandOpenClose1760000000031 implements MigrationInterface {
    name = 'BranchBrandOpenClose1760000000031';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "branch_brands"
                ADD COLUMN IF NOT EXISTS "is_open" boolean NOT NULL DEFAULT true,
                ADD COLUMN IF NOT EXISTS "closed_at" timestamp,
                ADD COLUMN IF NOT EXISTS "closed_by_user_id" integer
        `);
        await queryRunner.query(`
            ALTER TABLE "branch_brands"
            ADD CONSTRAINT "FK_branch_brands_closed_by_user"
            FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "branch_brands"
            DROP CONSTRAINT IF EXISTS "FK_branch_brands_closed_by_user"
        `);
        await queryRunner.query(`
            ALTER TABLE "branch_brands"
                DROP COLUMN IF EXISTS "is_open",
                DROP COLUMN IF EXISTS "closed_at",
                DROP COLUMN IF EXISTS "closed_by_user_id"
        `);
    }
}
