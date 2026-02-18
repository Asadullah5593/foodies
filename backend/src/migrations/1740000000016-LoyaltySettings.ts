import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add configurable loyalty settings per tenant (earning rules, redeem rules, display name, expiry).
 */
export class LoyaltySettings1740000000016 implements MigrationInterface {
    name = 'LoyaltySettings1740000000016';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "tenants"
      ADD COLUMN IF NOT EXISTS "loyalty_settings" json NULL
    `);
        // Default: 1 point per 1000 spent, min order 1; 1 point = 10 cash, min order 1; expiry 365 days
        await queryRunner.query(`
      UPDATE "tenants" SET "loyalty_settings" = '{"displayName":"Reward Points","spendPerPoint":1000,"minOrderToEarn":1,"cashValuePerPoint":10,"minOrderToRedeem":1,"expiryPeriod":365,"expiryUnit":"day"}'::json
      WHERE "loyalty_settings" IS NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "tenants" DROP COLUMN IF EXISTS "loyalty_settings"
    `);
    }
}
