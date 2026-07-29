import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-item sale-channel restriction: menu_items.available_channels (jsonb
 * array of OfferChannel values: 'pos' | 'app' | 'web' | 'kiosk').
 *
 * NULL = sellable on every channel (the default; nothing changes for existing
 * rows). A non-null array limits where the item is shown AND ordered — e.g.
 * the Fireaway sheet marks BOGO and the lunch deals "FIREAWAY APP & E-Pos
 * ONLY" → ['pos','app'].
 *
 * Same vocabulary as discounts.channels (offer-preview.util.ts), enforced in
 * getBranchMenu / getTenantBrandMenu / assertBranchItemOrderable.
 */
export class MenuItemAvailableChannels1760000000104 implements MigrationInterface {
    name = 'MenuItemAvailableChannels1760000000104';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "menu_items" ADD COLUMN IF NOT EXISTS "available_channels" jsonb`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "menu_items" DROP COLUMN IF EXISTS "available_channels"`,
        );
    }
}
