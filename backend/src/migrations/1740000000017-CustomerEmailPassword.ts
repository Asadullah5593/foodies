import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add email and password to customers for customer login (consumer app).
 */
export class CustomerEmailPassword1740000000017 implements MigrationInterface {
    name = 'CustomerEmailPassword1740000000017';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "customers"
      ADD COLUMN IF NOT EXISTS "email" character varying NULL
    `);
        await queryRunner.query(`
      ALTER TABLE "customers"
      ADD COLUMN IF NOT EXISTS "password" character varying NULL
    `);
        await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_customers_email"
      ON "customers" ("email")
      WHERE "email" IS NOT NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_customers_email"
    `);
        await queryRunner.query(`
      ALTER TABLE "customers" DROP COLUMN IF EXISTS "password"
    `);
        await queryRunner.query(`
      ALTER TABLE "customers" DROP COLUMN IF EXISTS "email"
    `);
    }
}
