import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cash a rider collected at the door and handed to the till when the shift is
 * closed. Recorded separately from `closing_cash` (the money counted in the
 * drawer) so the two are auditable on their own; the shift's actual cash is the
 * sum of the pair.
 *
 * Nullable with no default: existing closed shifts keep a NULL, which reads as
 * "not recorded" rather than "no rider cash", and their stored expected_cash is
 * left frozen exactly as it was.
 */
export class ShiftRiderCashCollected1760000000092 implements MigrationInterface {
    name = 'ShiftRiderCashCollected1760000000092';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE shifts ADD COLUMN IF NOT EXISTS rider_cash_collected numeric(12,2)`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE shifts DROP COLUMN IF EXISTS rider_cash_collected`,
        );
    }
}
