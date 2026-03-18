import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Set default currency for tenants to PKR (currency is fixed and hidden from business settings UI).
 */
export class TenantDefaultCurrencyPKR1740000000036 implements MigrationInterface {
    name = 'TenantDefaultCurrencyPKR1740000000036';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "tenants"
            ALTER COLUMN "default_currency" SET DEFAULT 'PKR'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "tenants"
            ALTER COLUMN "default_currency" SET DEFAULT 'USD'
        `);
    }
}
