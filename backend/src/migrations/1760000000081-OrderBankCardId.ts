import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Record which bank card an order was paid with.
 *
 * Orders stored `card_discount_amount` but never the card that earned it, so
 * "how did the HBL offer perform?" was unanswerable — the selected card reached
 * the pricing engine and was then thrown away. This keeps it.
 *
 * Nullable and un-backfilled: historical orders genuinely do not know their card,
 * and guessing one would invent data. ON DELETE SET NULL so removing a card from
 * the catalog never blocks or rewrites order history.
 */
export class OrderBankCardId1760000000081 implements MigrationInterface {
    name = 'OrderBankCardId1760000000081';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE orders ADD COLUMN IF NOT EXISTS bank_card_id integer`,
        );
        await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'FK_orders_bank_card'
                ) THEN
                    ALTER TABLE orders
                        ADD CONSTRAINT "FK_orders_bank_card"
                        FOREIGN KEY (bank_card_id) REFERENCES bank_cards(id)
                        ON DELETE SET NULL;
                END IF;
            END $$;
        `);
        // Reporting reads "orders for this card in a date range".
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_orders_bank_card" ON orders (bank_card_id, created_at)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_orders_bank_card"`);
        await queryRunner.query(
            `ALTER TABLE orders DROP CONSTRAINT IF EXISTS "FK_orders_bank_card"`,
        );
        await queryRunner.query(
            `ALTER TABLE orders DROP COLUMN IF EXISTS bank_card_id`,
        );
    }
}
