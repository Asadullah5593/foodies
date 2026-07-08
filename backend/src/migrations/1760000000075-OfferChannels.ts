import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Channel targeting for offers: `channels` restricts where an offer applies
 * ('pos' | 'app' | 'web' | 'kiosk'). NULL/empty = every channel (legacy rows
 * keep behaving exactly as before). Complements the older boolean pos_only.
 */
export class OfferChannels1760000000075 implements MigrationInterface {
    name = 'OfferChannels1760000000075';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS channels text`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE discounts DROP COLUMN IF EXISTS channels`,
        );
    }
}
