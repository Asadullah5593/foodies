import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dual-wallet cutover: the old single pooled balance can't be attributed to a
 * specific brand/channel wallet, so balances start fresh at zero. Historical
 * loyalty_transactions rows are kept untouched for audit (they have NULL wallet
 * columns and are excluded from all wallet logic).
 */
export class LoyaltyResetBalances1760000000029 implements MigrationInterface {
    name = 'LoyaltyResetBalances1760000000029';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            UPDATE "customers" SET "loyalty_points_balance" = 0
            WHERE "loyalty_points_balance" <> 0
        `);
    }

    public async down(): Promise<void> {
        // Irreversible: zeroed balances cannot be reconstructed.
    }
}
