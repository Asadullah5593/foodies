import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Printed vouchers — the paper "Discount Coupon Book" a customer hands over at
 * the till ("Any large pizza for Rs 999", "30% off").
 *
 * Its own module, for the same reason staff discounts are: these are not offers
 * a cart earns. A cashier applies one by hand, it replaces every other discount
 * on the order, and nothing about it may reach the customer app or the website
 * — which read the `discounts` table. (`vouchers` is already taken: that table
 * is the app's coupon instances.) Pricing still runs through the one engine, as
 * a `voucher` stage.
 *
 * Four parts:
 *
 * 1. `printed_vouchers` — one row per kind of voucher, per brand. Two types:
 *    `fixed_price` (one qualifying item is charged at `value`; extras on top)
 *    and `percentage` (`value`% off the qualifying lines). Scope is a list of
 *    categories and/or products; `included_modifier_ids` are the options a
 *    fixed price also covers (the "+ chips + drink" of a meal voucher).
 *    `valid_from` / `valid_until` are DATES, inclusive of both whole days in
 *    the branch's own timezone: a voucher printed "valid until 30/11" has to
 *    work all day on the 30th.
 *
 * 2. `orders` — which voucher an order used, what it took off, and who applied
 *    it. `voucher_discount_amount` joins the other split columns that sum to
 *    `discount_amount`. The name is snapshotted and the id is ON DELETE SET
 *    NULL, so retiring a voucher never rewrites or orphans order history.
 *
 * 3. `printed-vouchers:view|create|edit|delete|apply` — admin CRUD split from
 *    the till right, as for staff discounts.
 *
 * 4. Role grants. Each new permission is given to the roles that already hold
 *    its staff-discount counterpart, so whoever can give a staff discount at
 *    the till can apply a voucher and whoever manages one can manage the other
 *    — including roles the owner created by hand, which a slug list would miss.
 *    `apply` also follows `orders:apply-manual-offer`.
 */
export class PrintedVouchers1760000000131 implements MigrationInterface {
    name = 'PrintedVouchers1760000000131';

    private readonly permissions = [
        {
            name: 'printed-vouchers:view',
            action: 'view',
            description: 'View printed vouchers and the voucher report',
        },
        {
            name: 'printed-vouchers:create',
            action: 'create',
            description: 'Create printed vouchers',
        },
        {
            name: 'printed-vouchers:edit',
            action: 'edit',
            description: 'Edit printed vouchers',
        },
        {
            name: 'printed-vouchers:delete',
            action: 'delete',
            description: 'Delete printed vouchers',
        },
        {
            name: 'printed-vouchers:apply',
            action: 'apply',
            description: 'Apply a printed voucher to an order at the till',
        },
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS printed_vouchers (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                brand_id integer NOT NULL,
                name character varying NOT NULL,
                voucher_type character varying(16) NOT NULL,
                value numeric(10,2) NOT NULL,
                max_discount_amount numeric(10,2),
                category_ids jsonb,
                product_ids jsonb,
                included_modifier_ids jsonb,
                eligibility_branch_ids jsonb,
                order_types jsonb,
                valid_from date,
                valid_until date,
                sort_order integer NOT NULL DEFAULT 0,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_printed_vouchers_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_printed_vouchers_brand" FOREIGN KEY (brand_id)
                    REFERENCES brands(id) ON DELETE CASCADE,
                CONSTRAINT "CHK_printed_vouchers_type" CHECK (
                    voucher_type IN ('fixed_price', 'percentage')
                ),
                CONSTRAINT "CHK_printed_vouchers_value" CHECK (value > 0),
                CONSTRAINT "CHK_printed_vouchers_percent" CHECK (
                    voucher_type <> 'percentage' OR value <= 100
                )
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_printed_vouchers_tenant_brand" ON printed_vouchers (tenant_id, brand_id)`,
        );

        // --- orders: the voucher an order used -------------------------------
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "voucher_discount_amount" numeric(12,2) NOT NULL DEFAULT 0`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "printed_voucher_id" integer`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "voucher_name" character varying`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "voucher_by" integer`,
        );
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_printed_voucher"
                    FOREIGN KEY ("printed_voucher_id") REFERENCES printed_vouchers(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_voucher_by"
                    FOREIGN KEY ("voucher_by") REFERENCES users(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);
        // The voucher report reads "orders that used a voucher, by date". The
        // snapshot name is the marker: it outlives a deleted voucher.
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_orders_voucher_placed" ON orders (tenant_id, placed_at) WHERE voucher_name IS NOT NULL`,
        );

        // --- permissions -----------------------------------------------------
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, 'printed-vouchers', $2, $3)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.action, p.description],
            );
        }

        // --- role grants: follow the staff-discount holders ------------------
        const copyGrants = async (fromPermission: string, to: string) => {
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT DISTINCT rp.role_id, np.id
                 FROM role_permissions rp
                 JOIN permissions sp ON sp.id = rp.permission_id AND sp.name = $1
                 JOIN permissions np ON np.name = $2
                 WHERE NOT EXISTS (
                     SELECT 1 FROM role_permissions x
                     WHERE x.role_id = rp.role_id AND x.permission_id = np.id
                 )`,
                [fromPermission, to],
            );
        };
        for (const action of ['view', 'create', 'edit', 'delete', 'apply']) {
            await copyGrants(
                `staff-discounts:${action}`,
                `printed-vouchers:${action}`,
            );
        }
        await copyGrants('orders:apply-manual-offer', 'printed-vouchers:apply');
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // role_permissions rows go with the permissions (FK cascade).
        await queryRunner.query(
            `DELETE FROM permissions WHERE name = ANY($1)`,
            [this.permissions.map((p) => p.name)],
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_orders_voucher_placed"`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "FK_orders_voucher_by"`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "FK_orders_printed_voucher"`,
        );
        for (const col of [
            'voucher_by',
            'voucher_name',
            'printed_voucher_id',
            'voucher_discount_amount',
        ]) {
            await queryRunner.query(
                `ALTER TABLE "orders" DROP COLUMN IF EXISTS "${col}"`,
            );
        }
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_printed_vouchers_tenant_brand"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS printed_vouchers`);
    }
}
