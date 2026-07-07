import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Second round of DB backstops surfaced by the fix-verification pass:
 *
 * 1. UQ_loyalty_tx_order_redeem — a single order must debit loyalty points at most
 *    once. redeemForOrder had no per-order idempotency (unlike earn), so a retried
 *    createOrder could double-debit. The service now inserts the redeem lot with
 *    ON CONFLICT DO NOTHING against this index.
 *
 * 2. UQ_stl_stocktake_item_loc_coalesce — the existing unique index on
 *    (stocktake_id, inventory_item_id, location_id) treats NULL locations as
 *    distinct, so two concurrent counts of a NULL-location (branch pool) item BOTH
 *    insert and closeStocktake double-counts the item. This COALESCE(location_id,0)
 *    expression index closes that hole and backs an ON CONFLICT upsert.
 */
export class ConcurrencyBackstopsRound21760000000064
    implements MigrationInterface
{
    name = 'ConcurrencyBackstopsRound21760000000064';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DELETE FROM loyalty_transactions lt
            USING loyalty_transactions keep
            WHERE lt.type = 'redeem' AND keep.type = 'redeem'
              AND lt.order_id IS NOT NULL
              AND lt.order_id = keep.order_id
              AND lt.id > keep.id
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_loyalty_tx_order_redeem"
            ON loyalty_transactions (order_id)
            WHERE type = 'redeem' AND order_id IS NOT NULL
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_stl_stocktake_item_loc_coalesce"
            ON stocktake_lines (stocktake_id, inventory_item_id, COALESCE(location_id, 0))
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_stl_stocktake_item_loc_coalesce"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_loyalty_tx_order_redeem"`,
        );
    }
}
