import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Race-condition backstop for order placement: an optional client idempotency key
 * so a retried / double-tapped "Place order" (POS, mobile app, consumer web) returns
 * the already-created order group instead of creating a second real order that
 * double-charges, double-depletes inventory and re-redeems loyalty points. The key
 * is carried on the first order of a group; `createOrder` checks it up front and
 * treats a unique-violation as an idempotent replay.
 */
export class OrderIdempotency1760000000063 implements MigrationInterface {
    name = 'OrderIdempotency1760000000063';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotency_key varchar`,
        );
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_orders_tenant_idempotency"
            ON orders (tenant_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_orders_tenant_idempotency"`,
        );
        await queryRunner.query(
            `ALTER TABLE orders DROP COLUMN IF EXISTS idempotency_key`,
        );
    }
}
