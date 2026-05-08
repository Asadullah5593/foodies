import { MigrationInterface, QueryRunner } from 'typeorm';

export class OrderBranchLatLng1760000000009 implements MigrationInterface {
    name = 'OrderBranchLatLng1760000000009';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "branch_latitude" DECIMAL(10, 7) NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "orders"
      ADD COLUMN IF NOT EXISTS "branch_longitude" DECIMAL(10, 7) NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "branch_longitude"
    `);
        await queryRunner.query(`
      ALTER TABLE "orders" DROP COLUMN IF EXISTS "branch_latitude"
    `);
    }
}
