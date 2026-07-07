import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Allow a voucher with no customer — a "template" voucher for a new-customer
 * coupon (shown in admin as the master; a linked per-customer copy is minted
 * when each customer registers).
 */
export class VoucherTemplateNullableCustomer1760000000074
    implements MigrationInterface
{
    name = 'VoucherTemplateNullableCustomer1760000000074';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE vouchers ALTER COLUMN customer_id DROP NOT NULL`,
        );

        // Backfill a template voucher for existing new-customer coupons so the
        // admin sees the master immediately (no re-save needed). Idempotent.
        await queryRunner.query(`
            INSERT INTO vouchers
                (tenant_id, offer_id, customer_id, code, qr_token, status, expires_at, uses, granted_at)
            SELECT d.tenant_id, d.id, NULL, COALESCE(d.code, ''),
                   md5(random()::text || clock_timestamp()::text || d.id::text),
                   'template', d.valid_until, 0, now()
            FROM discounts d
            WHERE d.offer_kind = 'coupon'
              AND d.audience = 'new_customer'
              AND NOT EXISTS (
                  SELECT 1 FROM vouchers v
                  WHERE v.offer_id = d.id AND v.customer_id IS NULL
              )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Templates would violate NOT NULL — drop them first if reverting.
        await queryRunner.query(
            `DELETE FROM vouchers WHERE customer_id IS NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE vouchers ALTER COLUMN customer_id SET NOT NULL`,
        );
    }
}
