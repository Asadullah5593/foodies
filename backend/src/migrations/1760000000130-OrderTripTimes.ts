import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `orders.picked_up_at` / `orders.delivered_at` — when the rider marked the
 * order picked up and delivered, so a delivery's trip time (pickup → door) can
 * be shown.
 *
 * Neither moment was stored: the rider's tap only overwrote `delivery_status`,
 * and `completed_at` is not the delivered time — staff can complete a delivery
 * order from the admin panel before (or without) the rider tapping anything.
 *
 * Both are stamped by the server when the rider's existing status call arrives,
 * so no client changes. Nullable with no backfill: orders delivered before
 * this ran have no recorded pickup, and inventing one would be worse than
 * showing nothing.
 */
export class OrderTripTimes1760000000130 implements MigrationInterface {
    name = 'OrderTripTimes1760000000130';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE orders
                ADD COLUMN IF NOT EXISTS picked_up_at timestamp,
                ADD COLUMN IF NOT EXISTS delivered_at timestamp`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE orders
                DROP COLUMN IF EXISTS picked_up_at,
                DROP COLUMN IF EXISTS delivered_at`,
        );
    }
}
