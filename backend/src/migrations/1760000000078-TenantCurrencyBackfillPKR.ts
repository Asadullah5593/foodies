import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill any tenant still on the legacy 'USD' default currency to 'PKR'.
 *
 * The column DEFAULT was switched to PKR in 1740000000036, but tenants created
 * before that (or seeded with the old default) kept 'USD' — which surfaced as a
 * "$" sign on printed invoices (the invoice renderer maps the currency code to a
 * symbol; every other surface hardcodes "Rs."). Currency is fixed to PKR and
 * hidden from the settings UI, so this simply aligns the data. Boot-run.
 */
export class TenantCurrencyBackfillPKR1760000000078
    implements MigrationInterface
{
    name = 'TenantCurrencyBackfillPKR1760000000078';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE "tenants" SET "default_currency" = 'PKR' WHERE "default_currency" <> 'PKR'`,
        );
    }

    public async down(): Promise<void> {
        // No-op: original per-tenant values are not recoverable, and the system
        // is PKR-only, so there is nothing meaningful to revert to.
    }
}
