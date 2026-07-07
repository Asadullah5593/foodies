import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Race-condition backstop for payments: an optional client idempotency key so a
 * retried / double-submitted tender does not record a second payment (over-payment).
 * `processPayment` now serializes on the order row and, when a key is supplied,
 * dedupes on (order_id, idempotency_key).
 */
export class PaymentIdempotency1760000000061 implements MigrationInterface {
    name = 'PaymentIdempotency1760000000061';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE payments ADD COLUMN IF NOT EXISTS idempotency_key varchar`,
        );
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payments_order_idempotency"
            ON payments (order_id, idempotency_key)
            WHERE idempotency_key IS NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_payments_order_idempotency"`,
        );
        await queryRunner.query(
            `ALTER TABLE payments DROP COLUMN IF EXISTS idempotency_key`,
        );
    }
}
