import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Records where each customer signed up: 'pos' (staff added them at the counter
 * / admin, or a POS order created them), 'consumer_app', 'consumer_web' or
 * 'kiosk'. Mirrors the `orders.source` convention (plain varchar, default
 * 'pos') so both modules filter the same way.
 *
 * Backfill for rows that predate the column: only the consumer signup flow ever
 * sets a password (staff-created customers have none), so a password is a
 * reliable marker of a self-registered account. Those become 'consumer_app' —
 * the app is the only consumer client in production today; pre-existing web
 * signups (if any) are indistinguishable and land there too. Everything else
 * keeps the 'pos' default. New rows are stamped precisely at creation.
 */
export class CustomerSource1760000000100 implements MigrationInterface {
    name = 'CustomerSource1760000000100';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "customers"
             ADD COLUMN IF NOT EXISTS "source" character varying NOT NULL DEFAULT 'pos'`,
        );
        await queryRunner.query(
            `UPDATE "customers" SET "source" = 'consumer_app'
             WHERE "password" IS NOT NULL AND "source" = 'pos'`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_customers_source" ON "customers" ("source")`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_customers_source"`);
        await queryRunner.query(
            `ALTER TABLE "customers" DROP COLUMN IF EXISTS "source"`,
        );
    }
}
