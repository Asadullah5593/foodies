import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * GST on the menu price instead of the discounted price (Business Settings).
 *
 * tenants.tax_on_menu_price — off (false) = today's rule, tax on the price
 *   after every discount. On = tax on the menu price of everything ordered,
 *   extras included; discounts, vouchers, staff discount and loyalty points
 *   then lower the bill but not the tax.
 * orders.tax_base — the amount the order's GST was charged on, written only
 *   when the menu-price rule priced it. Null = the order was taxed on its
 *   discounted price (every order placed before this, and every order while
 *   the switch is off), so receipts and FBR treat it exactly as before.
 *
 * Both default to "as today" → no backfill, no change until the switch is on.
 */
export class TaxOnMenuPrice1760000000135 implements MigrationInterface {
    name = 'TaxOnMenuPrice1760000000135';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "tenants"
                ADD COLUMN IF NOT EXISTS "tax_on_menu_price" boolean NOT NULL DEFAULT false
        `);
        await queryRunner.query(`
            ALTER TABLE "orders"
                ADD COLUMN IF NOT EXISTS "tax_base" numeric(12,2)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "orders" DROP COLUMN IF EXISTS "tax_base"
        `);
        await queryRunner.query(`
            ALTER TABLE "tenants" DROP COLUMN IF EXISTS "tax_on_menu_price"
        `);
    }
}
