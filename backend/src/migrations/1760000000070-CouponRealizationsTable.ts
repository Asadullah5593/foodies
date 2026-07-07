import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 — coupon_realizations: append-only redemption ledger. Enforces
 * per-order idempotency via UNIQUE(offer_id, order_id); per-customer/global
 * limits are counted (reversed_at IS NULL) under an advisory lock at
 * order-create. Depends on vouchers (069).
 */
export class CouponRealizationsTable1760000000070 implements MigrationInterface {
  name = 'CouponRealizationsTable1760000000070';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS coupon_realizations (
        id serial PRIMARY KEY,
        tenant_id integer NOT NULL,
        offer_id integer NOT NULL,
        voucher_id integer,
        customer_id integer,
        customer_phone varchar,
        order_id integer NOT NULL,
        source varchar,
        amount numeric(12,2) NOT NULL DEFAULT 0,
        created_at timestamp NOT NULL DEFAULT now(),
        reversed_at timestamp,
        reversal_reason varchar,
        CONSTRAINT "FK_coupon_realizations_offer" FOREIGN KEY (offer_id)
          REFERENCES discounts(id) ON DELETE CASCADE,
        CONSTRAINT "FK_coupon_realizations_voucher" FOREIGN KEY (voucher_id)
          REFERENCES vouchers(id) ON DELETE SET NULL,
        CONSTRAINT "FK_coupon_realizations_order" FOREIGN KEY (order_id)
          REFERENCES orders(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_coupon_realizations_offer_order" ON coupon_realizations (offer_id, order_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_coupon_realizations_offer_customer" ON coupon_realizations (offer_id, customer_id)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_coupon_realizations_offer_phone" ON coupon_realizations (offer_id, customer_phone)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_coupon_realizations_voucher" ON coupon_realizations (voucher_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_coupon_realizations_voucher"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_coupon_realizations_offer_phone"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_coupon_realizations_offer_customer"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_coupon_realizations_offer_order"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS coupon_realizations`);
  }
}
