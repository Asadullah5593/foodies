import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employee HRM — the two rules tables from docs/HRM.md §3.5 that Phases 1–6
 * left unbuilt, plus the permission the settings screens are gated on.
 *
 * `deduction_rules` makes the deduction arithmetic configurable instead of
 * hard-coded. It is seeded per tenant with rows that reproduce the CURRENT
 * behaviour exactly — 1st late free / 2nd half / 3rd half restarting every 3,
 * one day per absence, half a day per half day, one day per unpaid leave day —
 * so applying this migration changes no payslip. The engine falls back to the
 * same constants when a tenant has no rows at all, which makes the seeding a
 * convenience rather than a dependency.
 *
 * `hr_approval_rules` makes "a branch manager may waive up to PKR 2,000, above
 * that needs the GM" a row rather than a code change. Deliberately seeded EMPTY:
 * no rules means the existing @RequirePermission gates are the only check, which
 * is exactly today's behaviour. A rule only ever ADDS a requirement.
 *
 * Purely additive: two tables, one permission, no column changes.
 */
export class HrRulesAndSettings1760000000116 implements MigrationInterface {
    name = 'HrRulesAndSettings1760000000116';

    private readonly permissions = [
        {
            name: 'hr-settings:view',
            resource: 'hr-settings',
            action: 'view',
            description:
                'View HR configuration: schedules, capture policy, overtime, offs, deductions, approvals',
        },
    ];

    private readonly adminRoleSlugs = [
        'super_admin',
        'owner',
        'general_manager',
        'hr_manager',
    ];

    /** Managers read the configuration they work under; they do not change it. */
    private readonly managerRoleSlugs = [
        'manager',
        'branch_manager',
        'branchmanager',
        'pos_branch_manager',
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS deduction_rules (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                branch_id integer,
                designation_id integer,
                trigger character varying(32) NOT NULL,
                condition jsonb NOT NULL DEFAULT '{}',
                effect_type character varying(32) NOT NULL,
                effect_value numeric(10,2) NOT NULL DEFAULT 0,
                priority integer NOT NULL DEFAULT 0,
                effective_from date,
                effective_to date,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_dr_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_dr_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "FK_dr_designation" FOREIGN KEY (designation_id)
                    REFERENCES designations(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_dr_trigger" CHECK (trigger IN (
                    'late', 'absent', 'half_day', 'early_leave',
                    'missed_punch', 'unapproved_leave'
                )),
                CONSTRAINT "CHK_dr_effect" CHECK (effect_type IN (
                    'deduct_days', 'deduct_amount', 'deduct_percent_of_daily'
                ))
            )
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_dr_scope"
                ON deduction_rules (tenant_id, trigger, is_active)
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS hr_approval_rules (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                branch_id integer,
                subject character varying(32) NOT NULL,
                condition jsonb NOT NULL DEFAULT '{}',
                required_permission character varying(120) NOT NULL,
                escalate_to_permission character varying(120),
                priority integer NOT NULL DEFAULT 0,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_har_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_har_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "CHK_har_subject" CHECK (subject IN (
                    'attendance_waiver', 'leave_request', 'overtime',
                    'payroll_run', 'salary_change', 'promotion',
                    'payroll_adjustment'
                ))
            )
        `);

        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_har_scope"
                ON hr_approval_rules (tenant_id, subject, is_active)
        `);

        // Seed the deduction rules that describe what the engine already does.
        // `ON CONFLICT` is not usable here (no natural key), so each row is
        // guarded by its own NOT EXISTS on (tenant, trigger, branch IS NULL) —
        // re-running the migration cannot duplicate them.
        const defaults: Array<{
            trigger: string;
            condition: string;
            effectType: string;
            effectValue: number;
        }> = [
            {
                trigger: 'late',
                // Days deducted at ladder positions 1, 2, 3 — then it restarts.
                condition: JSON.stringify({ ladder: [0, 0.5, 0.5] }),
                effectType: 'deduct_days',
                effectValue: 0,
            },
            {
                trigger: 'absent',
                condition: JSON.stringify({}),
                effectType: 'deduct_days',
                effectValue: 1,
            },
            {
                trigger: 'half_day',
                condition: JSON.stringify({}),
                effectType: 'deduct_days',
                effectValue: 0.5,
            },
            {
                trigger: 'unapproved_leave',
                condition: JSON.stringify({}),
                effectType: 'deduct_days',
                effectValue: 1,
            },
        ];

        for (const d of defaults) {
            await queryRunner.query(
                // Every parameter is cast explicitly: $1 is compared against a
                // varchar column AND inserted into one, and Postgres refuses to
                // infer a single type for it ("text versus character varying").
                `INSERT INTO deduction_rules
                     (tenant_id, branch_id, designation_id, trigger, condition,
                      effect_type, effect_value, priority, is_active)
                 SELECT t.id, NULL, NULL, $1::varchar, $2::jsonb, $3::varchar,
                        $4::numeric, 0, true
                   FROM tenants t
                  WHERE NOT EXISTS (
                        SELECT 1 FROM deduction_rules dr
                         WHERE dr.tenant_id = t.id
                           AND dr.trigger = $1::varchar
                           AND dr.branch_id IS NULL
                           AND dr.designation_id IS NULL
                  )`,
                [d.trigger, d.condition, d.effectType, d.effectValue],
            );
        }

        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
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

        await grant(this.adminRoleSlugs, ['hr-settings:view']);
        await grant(this.managerRoleSlugs, ['hr-settings:view']);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM role_permissions WHERE permission_id IN (
                 SELECT id FROM permissions WHERE name = ANY($1)
             )`,
            [this.permissions.map((p) => p.name)],
        );
        await queryRunner.query(
            `DELETE FROM permissions WHERE name = ANY($1)`,
            [this.permissions.map((p) => p.name)],
        );
        await queryRunner.query(`DROP TABLE IF EXISTS hr_approval_rules`);
        await queryRunner.query(`DROP TABLE IF EXISTS deduction_rules`);
    }
}
