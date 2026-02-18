import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add branch-level toggle to enable/disable menu (POS, KDS, consumer).
 */
export class BranchMenuEnabled1740000000005 implements MigrationInterface {
    name = 'BranchMenuEnabled1740000000005';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "branches"
      ADD COLUMN IF NOT EXISTS "menu_enabled" boolean NOT NULL DEFAULT true
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "branches" DROP COLUMN IF EXISTS "menu_enabled"`,
        );
    }
}
