import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Race-condition backstop: a single order must earn loyalty points at most once.
 *
 * `earnOnOrderComplete` guarded only on an unlocked `order.loyaltyPointsEarned > 0`
 * read taken outside the wallet transaction, so two concurrent completions
 * (KDS + POS, a double-click, or a retried socket event) could both pass the
 * check and insert two `earn` lots. This partial unique index makes the duplicate
 * `earn` insert fail at the database, and the service now inserts with
 * ON CONFLICT DO NOTHING and only credits the wallet when the row was actually
 * inserted — so double-earn is impossible regardless of caller concurrency.
 */
export class LoyaltyEarnIdempotency1760000000060
    implements MigrationInterface
{
    name = 'LoyaltyEarnIdempotency1760000000060';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Defensive: collapse any pre-existing duplicate earn lots (keep the earliest)
        // so the unique index can be created even on dirty data.
        await queryRunner.query(`
            DELETE FROM loyalty_transactions lt
            USING loyalty_transactions keep
            WHERE lt.type = 'earn'
              AND keep.type = 'earn'
              AND lt.order_id IS NOT NULL
              AND lt.order_id = keep.order_id
              AND lt.id > keep.id
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_loyalty_tx_order_earn"
            ON loyalty_transactions (order_id)
            WHERE type = 'earn' AND order_id IS NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_loyalty_tx_order_earn"`,
        );
    }
}
