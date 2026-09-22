import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `discounts.order_types` — limits an offer to delivery, pickup and/or dine-in.
 *
 * Until now an offer could be aimed at a sale CHANNEL (`channels`: pos / app /
 * web / kiosk) but not at how the food leaves the shop, so a delivery-only
 * promotion had no way to say so and would discount dine-in too.
 *
 * Stored the same way as `channels` on this table: a `text` column read through
 * TypeORM's `simple-json`, holding a subset of delivery|pickup|dine_in. NULL
 * means every order type, and the service normalises "all three selected" back
 * to NULL so "no restriction" has exactly one representation.
 *
 * Nullable with no backfill, so every existing offer keeps applying to every
 * order type and nothing changes for offers already live.
 */
export class DiscountOrderTypes1760000000129 implements MigrationInterface {
    name = 'DiscountOrderTypes1760000000129';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS order_types text`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE discounts DROP COLUMN IF EXISTS order_types`,
        );
    }
}
