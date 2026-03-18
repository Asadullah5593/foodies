import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add profile_image_url to customers (consumer app).
 */
export class CustomerProfileImage1740000000019 implements MigrationInterface {
    name = 'CustomerProfileImage1740000000019';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "customers"
      ADD COLUMN IF NOT EXISTS "profile_image_url" character varying NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "customers" DROP COLUMN IF EXISTS "profile_image_url"
    `);
    }
}
