import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add latitude and longitude to customers (consumer app location).
 */
export class CustomerLatLng1740000000021 implements MigrationInterface {
    name = 'CustomerLatLng1740000000021';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "customers"
      ADD COLUMN IF NOT EXISTS "latitude" decimal(10,7) NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "customers"
      ADD COLUMN IF NOT EXISTS "longitude" decimal(10,7) NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "latitude"`);
        await queryRunner.query(`ALTER TABLE "customers" DROP COLUMN IF EXISTS "longitude"`);
    }
}
