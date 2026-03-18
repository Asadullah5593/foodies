import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add latitude and longitude to branches (for branches-near-me).
 */
export class BranchLatLng1740000000022 implements MigrationInterface {
    name = 'BranchLatLng1740000000022';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "branches"
      ADD COLUMN IF NOT EXISTS "latitude" decimal(10,7) NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "branches"
      ADD COLUMN IF NOT EXISTS "longitude" decimal(10,7) NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN IF EXISTS "latitude"`);
        await queryRunner.query(`ALTER TABLE "branches" DROP COLUMN IF EXISTS "longitude"`);
    }
}
