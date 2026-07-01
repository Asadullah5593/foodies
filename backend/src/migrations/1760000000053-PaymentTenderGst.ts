import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Payment-tender-dependent GST (Pakistan card-vs-cash reduced rate).
 *
 * branches.gst_rate_cash / gst_rate_card — per-tender GST fractions (null = inherit
 *   tenant.default_tax_rate, so existing branches are unchanged).
 * orders.tax_rate_cash / tax_rate_card / tax_basis — audit of the applied rate(s) per order.
 *
 * All nullable → zero backfill; behaviour is identical until a branch sets per-tender rates.
 */
export class PaymentTenderGst1760000000053 implements MigrationInterface {
    name = 'PaymentTenderGst1760000000053';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Business-Settings (tenant) per-tender GST — the sole tax config now. The old single
        // tenants.default_tax_rate is replaced by these two and dropped.
        await queryRunner.query(`
            ALTER TABLE "tenants"
                ADD COLUMN IF NOT EXISTS "gst_rate_cash" numeric(5,4),
                ADD COLUMN IF NOT EXISTS "gst_rate_card" numeric(5,4)
        `);
        await queryRunner.query(`
            ALTER TABLE "tenants" DROP COLUMN IF EXISTS "default_tax_rate"
        `);
        // Optional per-branch override (multi-jurisdiction tenants); null = inherit tenant.
        await queryRunner.query(`
            ALTER TABLE "branches"
                ADD COLUMN IF NOT EXISTS "gst_rate_cash" numeric(5,4),
                ADD COLUMN IF NOT EXISTS "gst_rate_card" numeric(5,4)
        `);
        await queryRunner.query(`
            ALTER TABLE "orders"
                ADD COLUMN IF NOT EXISTS "tax_rate_cash" numeric(5,4),
                ADD COLUMN IF NOT EXISTS "tax_rate_card" numeric(5,4),
                ADD COLUMN IF NOT EXISTS "tax_basis" character varying(8)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "orders"
                DROP COLUMN IF EXISTS "tax_basis",
                DROP COLUMN IF EXISTS "tax_rate_card",
                DROP COLUMN IF EXISTS "tax_rate_cash"
        `);
        await queryRunner.query(`
            ALTER TABLE "branches"
                DROP COLUMN IF EXISTS "gst_rate_card",
                DROP COLUMN IF EXISTS "gst_rate_cash"
        `);
        await queryRunner.query(`
            ALTER TABLE "tenants"
                ADD COLUMN IF NOT EXISTS "default_tax_rate" numeric(5,4) NOT NULL DEFAULT 0,
                DROP COLUMN IF EXISTS "gst_rate_card",
                DROP COLUMN IF EXISTS "gst_rate_cash"
        `);
    }
}
