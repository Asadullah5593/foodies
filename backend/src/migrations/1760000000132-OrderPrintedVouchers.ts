import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Printed vouchers combine: three pizza vouchers price three pizzas, and
 * Peperi Co's three meal vouchers can sit on one order (a percentage voucher
 * still stands alone). An order therefore needs one row per voucher kind it
 * used, with a count of papers — `orders.printed_voucher_id` could only name
 * one.
 *
 * `order_printed_vouchers` holds those rows. The order-level columns stay:
 * `orders.voucher_discount_amount` is the total of the rows and
 * `orders.voucher_name` a one-line summary ("Any Large Pizza ×3"), which is
 * what receipts, the Orders list and the report's order list show.
 *
 * Every order that already used a voucher gets its one row copied in, so the
 * report has a single source. Re-runnable: rows are only copied for orders
 * that have none yet.
 */
export class OrderPrintedVouchers1760000000132 implements MigrationInterface {
    name = 'OrderPrintedVouchers1760000000132';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS order_printed_vouchers (
                id serial PRIMARY KEY,
                order_id integer NOT NULL,
                printed_voucher_id integer,
                voucher_name character varying NOT NULL,
                quantity integer NOT NULL DEFAULT 1,
                discount_amount numeric(12,2) NOT NULL DEFAULT 0,
                applied_by integer,
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_order_printed_vouchers_order" FOREIGN KEY (order_id)
                    REFERENCES orders(id) ON DELETE CASCADE,
                CONSTRAINT "FK_order_printed_vouchers_voucher" FOREIGN KEY (printed_voucher_id)
                    REFERENCES printed_vouchers(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_order_printed_vouchers_quantity" CHECK (quantity > 0)
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_order_printed_vouchers_order" ON order_printed_vouchers (order_id)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_order_printed_vouchers_voucher" ON order_printed_vouchers (printed_voucher_id)`,
        );
        // Orders placed before vouchers could combine used exactly one.
        await queryRunner.query(`
            INSERT INTO order_printed_vouchers
                (order_id, printed_voucher_id, voucher_name, quantity, discount_amount, applied_by, created_at)
            SELECT o.id, o.printed_voucher_id, o.voucher_name, 1,
                   COALESCE(o.voucher_discount_amount, 0), o.voucher_by,
                   COALESCE(o.placed_at, o.created_at, now())
            FROM orders o
            WHERE o.voucher_name IS NOT NULL
              AND NOT EXISTS (
                  SELECT 1 FROM order_printed_vouchers v WHERE v.order_id = o.id
              )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS order_printed_vouchers`);
    }
}
