import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Turn loyalty_transactions into a FIFO lot ledger: `earn` rows carry a remaining
 * balance + expiry so redemptions/expiry can consume oldest lots first.
 * Existing (pre-wallet) rows keep these columns NULL and are excluded from wallet logic.
 */
export class LoyaltyTransactionsLots1760000000027 implements MigrationInterface {
    name = 'LoyaltyTransactionsLots1760000000027';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "loyalty_transactions"
                ADD COLUMN IF NOT EXISTS "wallet_id" integer,
                ADD COLUMN IF NOT EXISTS "wallet_type" character varying(8),
                ADD COLUMN IF NOT EXISTS "brand_id" integer,
                ADD COLUMN IF NOT EXISTS "expiry_date" TIMESTAMP,
                ADD COLUMN IF NOT EXISTS "points_remaining" integer,
                ADD COLUMN IF NOT EXISTS "expired" boolean NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS "expired_at" TIMESTAMP
        `);
        await queryRunner.query(`
            ALTER TABLE "loyalty_transactions"
            ADD CONSTRAINT "FK_loyalty_tx_wallet"
            FOREIGN KEY ("wallet_id") REFERENCES "loyalty_wallets"("id") ON DELETE CASCADE
        `);
        // FIFO scan: oldest spendable lots per wallet
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_loyalty_tx_lot_fifo"
            ON "loyalty_transactions" ("wallet_id", "created_at")
            WHERE "type" = 'earn' AND "expired" = false
        `);
        // Daily expiry cron scan
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_loyalty_tx_expirable"
            ON "loyalty_transactions" ("expiry_date")
            WHERE "type" = 'earn' AND "expired" = false
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_loyalty_tx_expirable"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_loyalty_tx_lot_fifo"`,
        );
        await queryRunner.query(`
            ALTER TABLE "loyalty_transactions"
            DROP CONSTRAINT IF EXISTS "FK_loyalty_tx_wallet"
        `);
        await queryRunner.query(`
            ALTER TABLE "loyalty_transactions"
                DROP COLUMN IF EXISTS "wallet_id",
                DROP COLUMN IF EXISTS "wallet_type",
                DROP COLUMN IF EXISTS "brand_id",
                DROP COLUMN IF EXISTS "expiry_date",
                DROP COLUMN IF EXISTS "points_remaining",
                DROP COLUMN IF EXISTS "expired",
                DROP COLUMN IF EXISTS "expired_at"
        `);
    }
}
