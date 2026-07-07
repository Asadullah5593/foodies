import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 — vouchers: the customer-facing instance of a coupon. `code` is
 * internal; `qr_token` is the opaque, leak-safe token encoded in the QR.
 * Must be created BEFORE coupon_realizations (FK voucher_id → vouchers).
 */
export class VouchersTable1760000000069 implements MigrationInterface {
  name = 'VouchersTable1760000000069';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS vouchers (
        id serial PRIMARY KEY,
        tenant_id integer NOT NULL,
        offer_id integer NOT NULL,
        customer_id integer NOT NULL,
        code varchar NOT NULL,
        qr_token varchar NOT NULL,
        status varchar NOT NULL DEFAULT 'active',
        granted_at timestamp NOT NULL DEFAULT now(),
        expires_at timestamp,
        uses integer NOT NULL DEFAULT 0,
        last_used_at timestamp,
        CONSTRAINT "FK_vouchers_offer" FOREIGN KEY (offer_id)
          REFERENCES discounts(id) ON DELETE CASCADE,
        CONSTRAINT "FK_vouchers_customer" FOREIGN KEY (customer_id)
          REFERENCES customers(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_vouchers_offer_customer" ON vouchers (offer_id, customer_id)`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_vouchers_qr_token" ON vouchers (qr_token)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_vouchers_customer_status" ON vouchers (customer_id, status)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_vouchers_customer_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_vouchers_qr_token"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_vouchers_offer_customer"`);
    await queryRunner.query(`DROP TABLE IF EXISTS vouchers`);
  }
}
