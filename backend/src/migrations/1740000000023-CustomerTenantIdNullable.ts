import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Allow customers to have no tenant (consumer app: tenant_id nullable).
 */
export class CustomerTenantIdNullable1740000000023 implements MigrationInterface {
    name = 'CustomerTenantIdNullable1740000000023';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "customers"
      ALTER COLUMN "tenant_id" DROP NOT NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "customers"
      ALTER COLUMN "tenant_id" SET NOT NULL
    `);
    }
}
