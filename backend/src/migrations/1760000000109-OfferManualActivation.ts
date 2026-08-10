import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Till-activated offers: an offer the cashier switches on for one cart, instead
 * of one that fires for everybody who qualifies.
 *
 * The client wants a BOGO that only some customers get. Customer targeting
 * (audience / eligible_customer_ids / vouchers) already exists but is only
 * consulted on the coupon stage, and it needs the customer attached to the cart
 * before pricing. This is the other half of the answer: the offer still lives in
 * the auto `discount` stage, but a `manual` offer is skipped there unless the
 * cashier explicitly activated it for that order.
 *
 * Three parts:
 *
 * 1. `discounts.activation` — 'auto' (default, today's behaviour) or 'manual'.
 *    PER OFFER on purpose. Flipping every buy_x_get_y to opt-in would silently
 *    switch BOGO off for consumer web and app, where there is no cashier to
 *    press anything and no error would ever be raised. Existing rows default to
 *    'auto', so nothing changes until an offer is deliberately marked manual.
 *
 * 2. `orders.manual_offer_id` / `_amount` / `_by` — which offer the cashier
 *    activated, what it actually produced, and who did it. The amount is
 *    recorded separately from order_discount_amount because the `discount`
 *    stage keeps only the single best offer: an activated offer that LOSES to a
 *    better automatic one books 0 here while order_discount_amount shows the
 *    winner. Without that distinction "who gave away 40 free coffees" is
 *    unanswerable.
 *
 * 3. `orders:apply-manual-offer` — the right to switch one on. Granted to till
 *    and manager roles; it is discretion at the counter, so it needs to be
 *    revocable per role and reportable, exactly like staff discounts.
 */
export class OfferManualActivation1760000000109 implements MigrationInterface {
    name = 'OfferManualActivation1760000000109';

    private readonly permission = {
        name: 'orders:apply-manual-offer',
        resource: 'orders',
        action: 'apply-manual-offer',
        description:
            'Switch a till-activated offer (e.g. BOGO) on for a single cart',
    };

    /** Till + manager roles, demo and live client slugs alike. */
    private readonly roleSlugs = [
        'owner',
        'general_manager',
        'manager',
        'branch_manager',
        'branchmanager',
        'pos_branch_manager',
        'brand_admin',
        'brandadmin',
        'cashier',
        'pos_cashier',
        'call_centre_agent',
        'call_center_agent',
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "discounts" ADD COLUMN IF NOT EXISTS "activation" character varying NOT NULL DEFAULT 'auto'`,
        );
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "discounts" ADD CONSTRAINT "CHK_discounts_activation"
                    CHECK (activation IN ('auto', 'manual'));
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);

        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "manual_offer_id" integer`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "manual_offer_amount" numeric(12,2) NOT NULL DEFAULT 0`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "manual_offer_by" integer`,
        );
        // Deleting an offer must not destroy order history, so both FKs null out
        // rather than cascade.
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_manual_offer"
                    FOREIGN KEY ("manual_offer_id") REFERENCES discounts(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "orders" ADD CONSTRAINT "FK_orders_manual_offer_by"
                    FOREIGN KEY ("manual_offer_by") REFERENCES users(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_orders_manual_offer_by" ON orders (manual_offer_by) WHERE manual_offer_by IS NOT NULL`,
        );

        await queryRunner.query(
            `INSERT INTO permissions (name, resource, action, description)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (name) DO NOTHING`,
            [
                this.permission.name,
                this.permission.resource,
                this.permission.action,
                this.permission.description,
            ],
        );
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug = ANY($1)
               AND p.name = $2
               AND NOT EXISTS (
                   SELECT 1 FROM role_permissions rp
                   WHERE rp.role_id = r.id AND rp.permission_id = p.id
               )`,
            [this.roleSlugs, this.permission.name],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM permissions WHERE name = $1`, [
            this.permission.name,
        ]);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_orders_manual_offer_by"`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "FK_orders_manual_offer_by"`,
        );
        await queryRunner.query(
            `ALTER TABLE "orders" DROP CONSTRAINT IF EXISTS "FK_orders_manual_offer"`,
        );
        for (const col of [
            'manual_offer_by',
            'manual_offer_amount',
            'manual_offer_id',
        ]) {
            await queryRunner.query(
                `ALTER TABLE "orders" DROP COLUMN IF EXISTS "${col}"`,
            );
        }
        await queryRunner.query(
            `ALTER TABLE "discounts" DROP CONSTRAINT IF EXISTS "CHK_discounts_activation"`,
        );
        await queryRunner.query(
            `ALTER TABLE "discounts" DROP COLUMN IF EXISTS "activation"`,
        );
    }
}
