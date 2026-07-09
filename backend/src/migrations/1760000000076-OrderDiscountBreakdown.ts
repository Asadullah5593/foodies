import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Persist the per-stage discount split on orders (product_promotion / order
 * discount / coupon / card). The pricing engine already computes these; storing
 * them lets invoices render each as its own line. Additive; existing rows keep
 * 0 (their combined discount_amount is unchanged).
 */
export class OrderDiscountBreakdown1760000000076 implements MigrationInterface {
  name = 'OrderDiscountBreakdown1760000000076';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS promo_discount_amount numeric(12,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS order_discount_amount numeric(12,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS coupon_discount_amount numeric(12,2) NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS card_discount_amount numeric(12,2) NOT NULL DEFAULT 0`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders DROP COLUMN IF EXISTS card_discount_amount`,
    );
    await queryRunner.query(
      `ALTER TABLE orders DROP COLUMN IF EXISTS coupon_discount_amount`,
    );
    await queryRunner.query(
      `ALTER TABLE orders DROP COLUMN IF EXISTS order_discount_amount`,
    );
    await queryRunner.query(
      `ALTER TABLE orders DROP COLUMN IF EXISTS promo_discount_amount`,
    );
  }
}
