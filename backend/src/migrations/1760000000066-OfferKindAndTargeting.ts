import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 — turn `discounts` into the single offers store with an `offer_kind`
 * discriminator + coupon targeting/limit columns. Additive & idempotent;
 * legacy rows keep behaving exactly as before (nulls = permissive).
 */
export class OfferKindAndTargeting1760000000066 implements MigrationInterface {
  name = 'OfferKindAndTargeting1760000000066';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS offer_kind varchar NOT NULL DEFAULT 'discount'`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS audience varchar`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS eligible_customer_ids text`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS per_customer_limit integer`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS voucher_validity_days integer`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS global_limit integer`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS priority integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts ADD COLUMN IF NOT EXISTS funding varchar NOT NULL DEFAULT 'merchant'`,
    );

    // One-time backfill: classify existing discounts into offer kinds.
    await queryRunner.query(`
      UPDATE discounts SET offer_kind = CASE
        WHEN requires_card = true THEN 'card_offer'
        WHEN requires_code = true THEN 'coupon'
        WHEN application_scope = 'products' THEN 'product_promotion'
        ELSE 'discount' END
      WHERE offer_kind = 'discount'
    `);
    await queryRunner.query(
      `UPDATE discounts SET funding = 'bank' WHERE requires_card = true`,
    );

    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_discounts_tenant_kind_active" ON discounts (tenant_id, offer_kind, is_active)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_discounts_tenant_kind_active"`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts DROP COLUMN IF EXISTS funding`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts DROP COLUMN IF EXISTS priority`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts DROP COLUMN IF EXISTS global_limit`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts DROP COLUMN IF EXISTS voucher_validity_days`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts DROP COLUMN IF EXISTS per_customer_limit`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts DROP COLUMN IF EXISTS eligible_customer_ids`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts DROP COLUMN IF EXISTS audience`,
    );
    await queryRunner.query(
      `ALTER TABLE discounts DROP COLUMN IF EXISTS offer_kind`,
    );
  }
}
