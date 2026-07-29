import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Mid-shift cash-outs ("cash drops"): the owner collects takings from the
 * cashier while the shift is still running, so that money must stop being
 * expected in the drawer at close.
 *
 * Three parts:
 *
 * 1. `shift_cash_outs` — append-only log, one row per hand-over (amount, who,
 *    when, note). Corrections VOID a row (voided_at) rather than deleting it,
 *    mirroring coupon_realizations' reversed_at convention; every SUM filters
 *    `voided_at IS NULL`.
 *
 * 2. `shifts:cash-out` permission — recording/voiding a cash-out. Standalone,
 *    NOT implied by the shifts:manage umbrella (same reasoning as
 *    shifts:override), and granted only to owner/super admin initially: every
 *    other role can SEE the entries but not add them. Grant it from the Roles
 *    UI to widen access.
 *
 * 3. Drops `shifts.rider_cash_collected`. Rider cash is being removed from
 *    shift reconciliation entirely: the till now reconciles purely on money
 *    that physically passed through it, so expected cash no longer adds the
 *    balance riders are carrying and the close no longer asks what they handed
 *    in. Already-closed shifts keep their frozen `expected_cash` and their
 *    `closing_cash`, so past variances are unchanged — but the recorded rider
 *    figure itself is dropped and cannot be recovered.
 */
export class ShiftCashOuts1760000000102 implements MigrationInterface {
    name = 'ShiftCashOuts1760000000102';

    private readonly permission = {
        name: 'shifts:cash-out',
        resource: 'shifts',
        action: 'cash-out',
        description:
            'Record and void mid-shift cash-outs (cash handed from the till to the owner); everyone else sees them read-only',
    };

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS shift_cash_outs (
                id serial PRIMARY KEY,
                shift_id integer NOT NULL,
                amount numeric(12,2) NOT NULL,
                note character varying,
                created_by integer,
                created_at timestamp NOT NULL DEFAULT now(),
                voided_at timestamp,
                voided_by integer,
                void_reason character varying,
                CONSTRAINT "FK_shift_cash_outs_shift" FOREIGN KEY (shift_id)
                    REFERENCES shifts(id) ON DELETE CASCADE,
                CONSTRAINT "FK_shift_cash_outs_created_by" FOREIGN KEY (created_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "FK_shift_cash_outs_voided_by" FOREIGN KEY (voided_by)
                    REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_shift_cash_outs_shift" ON shift_cash_outs (shift_id)`,
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
        // Owner / super admin only — the client wants this admin-held to start.
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug IN ('owner', 'super_admin')
               AND p.name = $1
               AND NOT EXISTS (
                   SELECT 1 FROM role_permissions rp
                   WHERE rp.role_id = r.id AND rp.permission_id = p.id
               )`,
            [this.permission.name],
        );

        await queryRunner.query(
            `ALTER TABLE "shifts" DROP COLUMN IF EXISTS "rider_cash_collected"`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // The column comes back empty — the recorded rider figures are gone.
        await queryRunner.query(
            `ALTER TABLE "shifts" ADD COLUMN IF NOT EXISTS "rider_cash_collected" numeric(12,2)`,
        );
        await queryRunner.query(`DELETE FROM permissions WHERE name = $1`, [
            this.permission.name,
        ]);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_shift_cash_outs_shift"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS shift_cash_outs`);
    }
}
