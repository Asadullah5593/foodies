import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Staff discounts — preset give-aways a cashier grants at the till.
 *
 * Its own module rather than a `discounts` row with a new offer_kind: an offer
 * is earned by the cart, a staff discount is discretion exercised by a person,
 * and mixing them made the admin UI ambiguous. Pricing still runs through the
 * one engine (`staff_discount` stage, fed by an adapter) so the tenant cap, the
 * cost floor and deal/override exclusion all apply — there is no second pricing
 * path.
 *
 * Five parts:
 *
 * 1. `staff_discounts` — the preset catalog (label, percentage or flat value,
 *    optional rupee cap, brand/branch scope, sort order). Deliberately small:
 *    no codes, audiences, per-customer limits, vouchers, day-parts or channels.
 *    Seeded with 5/10/15/20/25% per tenant so the till is usable immediately.
 *
 * 2. `orders` split columns — `staff_discount_amount` joins the existing four
 *    (promo/order/coupon/card), which together sum to `discount_amount`. The
 *    preset id gets its OWN column: `orders.discount_id` is FK-constrained to
 *    discounts(id) and the id spaces are unrelated, so a preset id written there
 *    would silently resolve to whichever offer happens to share the number.
 *    `type`/`value` are snapshotted so editing a preset later cannot rewrite
 *    what a past order was actually given.
 *
 * 3. `roles.max_staff_discount_percent` / `max_staff_discount_amount` — the
 *    ceiling, enforced server-side on both quote and createOrder. Percent gates
 *    percentage presets; the amount gates the resulting rupees for ANY preset,
 *    which is what keeps flat presets in check. null = no ceiling of that kind
 *    (the tenant cap still applies). Follows roles.order_history_days.
 *
 * 4. `staff-discounts:view|create|edit|delete|apply` — admin CRUD split from the
 *    till right. The long-dormant, never-enforced `discounts:apply` is left
 *    alone rather than repurposed.
 *
 * 5. Role grants + starting ceilings: till roles may grant up to 10%, managers
 *    25%, owner/GM uncapped. Both demo (`branch_manager`) and live client
 *    (`branchmanager`) slugs are targeted.
 */
export class StaffDiscounts1760000000103 implements MigrationInterface {
    name = 'StaffDiscounts1760000000103';

    private readonly permissions = [
        {
            name: 'staff-discounts:view',
            action: 'view',
            description: 'View staff discount presets',
        },
        {
            name: 'staff-discounts:create',
            action: 'create',
            description: 'Create staff discount presets',
        },
        {
            name: 'staff-discounts:edit',
            action: 'edit',
            description: 'Edit staff discount presets',
        },
        {
            name: 'staff-discounts:delete',
            action: 'delete',
            description: 'Delete staff discount presets',
        },
        {
            name: 'staff-discounts:apply',
            action: 'apply',
            description: 'Grant a staff discount on an order at the till',
        },
    ];

    /** Full CRUD + apply. */
    private readonly adminRoleSlugs = [
        'super_admin',
        'owner',
        'general_manager',
    ];
    /** View + apply, with a 25% ceiling. */
    private readonly managerRoleSlugs = [
        'manager',
        'branch_manager',
        'branchmanager',
        'brand_admin',
        'brandadmin',
    ];
    /** Apply only, with a 10% ceiling. */
    private readonly tillRoleSlugs = [
        'cashier',
        'pos_cashier',
        'call_centre_agent',
        'call_center_agent',
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS staff_discounts (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                name character varying NOT NULL,
                discount_type character varying NOT NULL DEFAULT 'percentage',
                value numeric(10,2) NOT NULL,
                max_discount_amount numeric(10,2),
                eligibility_brand_ids text,
                eligibility_branch_ids text,
                sort_order integer NOT NULL DEFAULT 0,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_staff_discounts_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "CHK_staff_discounts_type" CHECK (discount_type IN ('percentage', 'flat')),
                CONSTRAINT "CHK_staff_discounts_value" CHECK (value > 0),
                -- A 100% comp is not grantable at the till. Voids/refunds are a
                -- different control with a different audit trail.
                CONSTRAINT "CHK_staff_discounts_percent_below_100" CHECK (
                    discount_type <> 'percentage' OR value < 100
                )
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_staff_discounts_tenant" ON staff_discounts (tenant_id)`,
        );

        // --- orders: the fifth discount split + who granted it ---------------
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "staff_discount_amount" numeric(12,2) NOT NULL DEFAULT 0`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "staff_discount_id" integer`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "staff_discount_type" character varying(16)`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "staff_discount_value" numeric(12,2)`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "staff_discount_by" integer`,
        );
        // Preset deletion must never destroy order history: SET NULL keeps the
        // snapshotted type/value/amount readable after the button is retired.
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_staff_discount"
                    FOREIGN KEY ("staff_discount_id") REFERENCES staff_discounts(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_staff_discount_by"
                    FOREIGN KEY ("staff_discount_by") REFERENCES users(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_orders_staff_discount_by" ON orders (staff_discount_by) WHERE staff_discount_by IS NOT NULL`,
        );

        // --- roles: the ceiling ---------------------------------------------
        await queryRunner.query(
            `ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "max_staff_discount_percent" numeric(5,2)`,
        );
        await queryRunner.query(
            `ALTER TABLE "roles" ADD COLUMN IF NOT EXISTS "max_staff_discount_amount" numeric(10,2)`,
        );

        // --- permissions -----------------------------------------------------
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, 'staff-discounts', $2, $3)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.action, p.description],
            );
        }

        const grant = async (slugs: string[], permNames: string[]) => {
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT r.id, p.id FROM roles r
                 CROSS JOIN permissions p
                 WHERE r.slug = ANY($1)
                   AND p.name = ANY($2)
                   AND NOT EXISTS (
                       SELECT 1 FROM role_permissions rp
                       WHERE rp.role_id = r.id AND rp.permission_id = p.id
                   )`,
                [slugs, permNames],
            );
        };

        const allNames = this.permissions.map((p) => p.name);
        await grant(this.adminRoleSlugs, allNames);
        await grant(this.managerRoleSlugs, [
            'staff-discounts:view',
            'staff-discounts:apply',
        ]);
        await grant(this.tillRoleSlugs, ['staff-discounts:apply']);

        // --- starting ceilings ----------------------------------------------
        // Owner/GM stay null (uncapped by role; the tenant cap still binds).
        await queryRunner.query(
            `UPDATE roles SET max_staff_discount_percent = 25 WHERE slug = ANY($1) AND max_staff_discount_percent IS NULL`,
            [this.managerRoleSlugs],
        );
        await queryRunner.query(
            `UPDATE roles SET max_staff_discount_percent = 10 WHERE slug = ANY($1) AND max_staff_discount_percent IS NULL`,
            [this.tillRoleSlugs],
        );

        // --- seed the presets the client asked for --------------------------
        await queryRunner.query(`
            INSERT INTO staff_discounts (tenant_id, name, discount_type, value, sort_order)
            SELECT t.id, v.name, 'percentage', v.value, v.sort_order
            FROM tenants t
            CROSS JOIN (VALUES
                ('5% off',  5,  1),
                ('10% off', 10, 2),
                ('15% off', 15, 3),
                ('20% off', 20, 4),
                ('25% off', 25, 5)
            ) AS v(name, value, sort_order)
            WHERE NOT EXISTS (
                SELECT 1 FROM staff_discounts sd WHERE sd.tenant_id = t.id
            )
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM permissions WHERE name = ANY($1)`,
            [this.permissions.map((p) => p.name)],
        );
        await queryRunner.query(
            `ALTER TABLE "roles" DROP COLUMN IF EXISTS "max_staff_discount_amount"`,
        );
        await queryRunner.query(
            `ALTER TABLE "roles" DROP COLUMN IF EXISTS "max_staff_discount_percent"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_orders_staff_discount_by"`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "FK_orders_staff_discount_by"`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "FK_orders_staff_discount"`,
        );
        for (const col of [
            'staff_discount_by',
            'staff_discount_value',
            'staff_discount_type',
            'staff_discount_id',
            'staff_discount_amount',
        ]) {
            await queryRunner.query(
                `ALTER TABLE "orders" DROP COLUMN IF EXISTS "${col}"`,
            );
        }
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_staff_discounts_tenant"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS staff_discounts`);
    }
}
