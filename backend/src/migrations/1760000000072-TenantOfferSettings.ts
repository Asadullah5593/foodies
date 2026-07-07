import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 — tenant-level offer engine settings (stacking order, within-group
 * rule, max-total-discount cap + base, cost floor, deals/override/voucher
 * toggles). simple-json → text column. Null = code defaults apply (cap off),
 * so existing tenants are unaffected.
 */
export class TenantOfferSettings1760000000072 implements MigrationInterface {
  name = 'TenantOfferSettings1760000000072';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS offer_settings text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE tenants DROP COLUMN IF EXISTS offer_settings`,
    );
  }
}
