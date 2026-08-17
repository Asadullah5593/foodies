import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employee HRM — Phase 4: payroll.
 *
 * Spec: docs/HRM.md §10. Purely additive — eight new tables, six new
 * permissions. `rider_payroll_*` and `rider_comp_plans` are left completely
 * untouched: they stay readable for historical runs while new runs go through
 * this engine (docs/HRM.md §12).
 *
 * Things worth knowing:
 *
 * 1. `payroll_line_items` carries `calc_meta`. That column is the module's
 *    answer to "why is my salary short" — every figure keeps the arithmetic
 *    that produced it. Same pattern as rider_payroll_line_items.formula_meta.
 *
 * 2. `waiver` and `adjustment` are line KINDS alongside `deduction`. A forgiven
 *    deduction prints as two lines, never as a quietly reduced one, so the
 *    machine's decision and the human's override stay separately visible.
 *
 * 3. `payroll_adjustments` requires a non-empty reason at the database level.
 *    An unexplained override is precisely what decision #9 exists to prevent.
 *
 * 4. Approving a run locks attendance_days in the period. There is no edit path
 *    afterwards — only reversal (which unlocks) or an adjustment carried into
 *    the next period.
 *
 * 5. One salary structure may be open per employee at a time, enforced by a
 *    partial unique index — the same invariant as employee_assignments. Two
 *    open structures would make "what are they paid" ambiguous.
 */
export class EmployeeHrmPhase4Payroll1760000000113 implements MigrationInterface {
    name = 'EmployeeHrmPhase4Payroll1760000000113';

    private readonly permissions = [
        {
            name: 'payroll:view',
            resource: 'payroll',
            action: 'view',
            description: 'View payroll runs and payslips',
        },
        {
            name: 'payroll:run',
            resource: 'payroll',
            action: 'run',
            description: 'Create and compute payroll runs',
        },
        {
            name: 'payroll:approve',
            resource: 'payroll',
            action: 'approve',
            description: 'Approve a payroll run (locks the attendance period)',
        },
        {
            name: 'payroll:reverse',
            resource: 'payroll',
            action: 'reverse',
            description: 'Reverse an approved payroll run, with a reason',
        },
        {
            name: 'payroll:adjust',
            resource: 'payroll',
            action: 'adjust',
            description:
                'Waive a deduction or add one to a payslip, with a mandatory reason',
        },
        {
            name: 'payroll:export',
            resource: 'payroll',
            action: 'export',
            description: 'Export the payroll register and payslips',
        },
    ];

    /** Payroll is Owner / GM / HR only. Branch managers get nothing here. */
    private readonly adminRoleSlugs = [
        'super_admin',
        'owner',
        'general_manager',
        'hr_manager',
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- salary structures --------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_salary_structures (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                effective_from date NOT NULL,
                effective_to date,
                pay_type character varying(16) NOT NULL DEFAULT 'monthly',
                basic_amount numeric(12,2) NOT NULL DEFAULT 0,
                currency character varying(8) NOT NULL DEFAULT 'PKR',
                daily_rate_basis character varying(24) NOT NULL DEFAULT 'fixed_30',
                per_delivered_order_amount numeric(12,2) NOT NULL DEFAULT 0,
                change_reason character varying(48),
                source_review_id integer,
                approved_by integer,
                approved_at timestamp,
                created_by integer,
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_ess_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ess_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ess_creator" FOREIGN KEY (created_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_ess_basis" CHECK (daily_rate_basis IN (
                    'fixed_30', 'days_in_month', 'working_days'
                )),
                CONSTRAINT "CHK_ess_dates" CHECK (
                    effective_to IS NULL OR effective_to >= effective_from
                )
            )
        `);
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ess_current"
             ON employee_salary_structures (employee_id) WHERE effective_to IS NULL`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_salary_components (
                id serial PRIMARY KEY,
                structure_id integer NOT NULL,
                component_key character varying(80) NOT NULL,
                name character varying(120) NOT NULL,
                kind character varying(16) NOT NULL DEFAULT 'earning',
                calc_type character varying(24) NOT NULL DEFAULT 'flat',
                amount numeric(12,2) NOT NULL DEFAULT 0,
                is_taxable boolean NOT NULL DEFAULT true,
                sort_order integer NOT NULL DEFAULT 0,
                CONSTRAINT "FK_esc_structure" FOREIGN KEY (structure_id)
                    REFERENCES employee_salary_structures(id) ON DELETE CASCADE,
                CONSTRAINT "CHK_esc_kind" CHECK (kind IN ('earning', 'deduction')),
                CONSTRAINT "CHK_esc_calc" CHECK (calc_type IN ('flat', 'percent_of_basic'))
            )
        `);

        // --- overtime policies ----------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS overtime_policies (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                branch_id integer,
                designation_id integer,
                is_enabled boolean NOT NULL DEFAULT true,
                min_minutes_to_qualify integer NOT NULL DEFAULT 30,
                rounding_minutes integer NOT NULL DEFAULT 15,
                rate_type character varying(32) NOT NULL DEFAULT 'multiplier_of_hourly',
                rate_value numeric(8,2) NOT NULL DEFAULT 1,
                weekly_off_multiplier numeric(8,2) NOT NULL DEFAULT 1,
                holiday_multiplier numeric(8,2) NOT NULL DEFAULT 1,
                daily_cap_minutes integer DEFAULT 240,
                monthly_cap_minutes integer,
                requires_approval boolean NOT NULL DEFAULT true,
                effective_from date,
                effective_to date,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_op_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_op_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "FK_op_designation" FOREIGN KEY (designation_id)
                    REFERENCES designations(id) ON DELETE CASCADE,
                CONSTRAINT "CHK_op_rate_type" CHECK (rate_type IN (
                    'multiplier_of_hourly', 'flat_per_hour'
                ))
            )
        `);

        // --- advances ---------------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_loans_advances (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                principal_amount numeric(12,2) NOT NULL,
                installment_amount numeric(12,2) NOT NULL,
                installments_total integer NOT NULL DEFAULT 1,
                installments_paid integer NOT NULL DEFAULT 0,
                outstanding_amount numeric(12,2) NOT NULL,
                status character varying(16) NOT NULL DEFAULT 'active',
                approved_by integer,
                disbursed_on date,
                note text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_ela_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ela_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ela_approver" FOREIGN KEY (approved_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_ela_status" CHECK (status IN ('active', 'settled', 'written_off'))
            )
        `);

        // --- payroll runs -------------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS payroll_runs (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                branch_id integer,
                period_from date NOT NULL,
                period_to date NOT NULL,
                cycle_type character varying(24) NOT NULL DEFAULT 'calendar_month',
                status character varying(24) NOT NULL DEFAULT 'draft',
                rule_snapshot jsonb NOT NULL DEFAULT '{}',
                requested_by integer,
                computed_at timestamp,
                approved_by integer,
                approved_at timestamp,
                paid_at timestamp,
                reversed_by integer,
                reversed_at timestamp,
                reversal_reason text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_pr_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_pr_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "FK_pr_approver" FOREIGN KEY (approved_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_pr_status" CHECK (status IN (
                    'draft', 'computed', 'pending_approval', 'approved', 'paid', 'reversed'
                )),
                CONSTRAINT "CHK_pr_period" CHECK (period_to >= period_from),
                -- A reversal must say why. "Reversed" with no reason is the
                -- state auditors ask about and nobody can answer.
                CONSTRAINT "CHK_pr_reversal_reason" CHECK (
                    status <> 'reversed' OR length(btrim(coalesce(reversal_reason, ''))) > 0
                )
            )
        `);
        // One live run per period and scope. A second would double-pay whoever
        // appears in both.
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_pr_period_scope"
             ON payroll_runs (tenant_id, coalesce(branch_id, 0), period_from, period_to)
             WHERE status <> 'reversed'`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS payroll_lines (
                id serial PRIMARY KEY,
                run_id integer NOT NULL,
                employee_id integer NOT NULL,
                designation_id integer,
                salary_structure_id integer,
                present_days numeric(6,2) NOT NULL DEFAULT 0,
                half_days numeric(6,2) NOT NULL DEFAULT 0,
                paid_leave_days numeric(6,2) NOT NULL DEFAULT 0,
                unpaid_leave_days numeric(6,2) NOT NULL DEFAULT 0,
                absent_days numeric(6,2) NOT NULL DEFAULT 0,
                weekly_off_days numeric(6,2) NOT NULL DEFAULT 0,
                holiday_days numeric(6,2) NOT NULL DEFAULT 0,
                encashed_off_days numeric(6,2) NOT NULL DEFAULT 0,
                worked_minutes integer NOT NULL DEFAULT 0,
                overtime_minutes integer NOT NULL DEFAULT 0,
                late_count integer NOT NULL DEFAULT 0,
                delivered_orders integer NOT NULL DEFAULT 0,
                gross_earnings numeric(12,2) NOT NULL DEFAULT 0,
                total_deductions numeric(12,2) NOT NULL DEFAULT 0,
                net_payable numeric(12,2) NOT NULL DEFAULT 0,
                currency character varying(8) NOT NULL DEFAULT 'PKR',
                payment_status character varying(16) NOT NULL DEFAULT 'unpaid',
                payment_reference character varying(120),
                note text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_pl_run" FOREIGN KEY (run_id)
                    REFERENCES payroll_runs(id) ON DELETE CASCADE,
                CONSTRAINT "FK_pl_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "UQ_pl_run_employee" UNIQUE (run_id, employee_id),
                CONSTRAINT "CHK_pl_net" CHECK (net_payable >= 0)
            )
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS payroll_line_items (
                id serial PRIMARY KEY,
                payroll_line_id integer NOT NULL,
                component_key character varying(80) NOT NULL,
                component_name character varying(160) NOT NULL,
                kind character varying(16) NOT NULL,
                quantity numeric(12,2) NOT NULL DEFAULT 0,
                rate numeric(12,2) NOT NULL DEFAULT 0,
                amount numeric(12,2) NOT NULL DEFAULT 0,
                calc_meta jsonb NOT NULL DEFAULT '{}',
                sort_order integer NOT NULL DEFAULT 0,
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_pli_line" FOREIGN KEY (payroll_line_id)
                    REFERENCES payroll_lines(id) ON DELETE CASCADE,
                CONSTRAINT "CHK_pli_kind" CHECK (kind IN (
                    'earning', 'deduction', 'waiver', 'adjustment'
                ))
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_pli_line"
             ON payroll_line_items (payroll_line_id, sort_order)`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS payroll_adjustments (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                payroll_line_id integer NOT NULL,
                direction character varying(24) NOT NULL,
                target_component_key character varying(80),
                amount numeric(12,2) NOT NULL,
                reason text NOT NULL,
                created_by integer,
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_pa_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_pa_line" FOREIGN KEY (payroll_line_id)
                    REFERENCES payroll_lines(id) ON DELETE CASCADE,
                CONSTRAINT "FK_pa_creator" FOREIGN KEY (created_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_pa_direction" CHECK (direction IN (
                    'waive', 'add_deduction', 'add_earning'
                )),
                CONSTRAINT "CHK_pa_amount" CHECK (amount > 0),
                -- Decision #9: an override without a reason is the thing this
                -- table exists to make impossible.
                CONSTRAINT "CHK_pa_reason" CHECK (length(btrim(reason)) > 0)
            )
        `);

        // --- permissions ---------------------------------------------------------
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
        }
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
            [this.adminRoleSlugs, this.permissions.map((p) => p.name)],
        );

        // --- seed a tenant-default overtime policy ---------------------------------
        await queryRunner.query(`
            INSERT INTO overtime_policies (tenant_id)
            SELECT t.id FROM tenants t
            WHERE NOT EXISTS (
                SELECT 1 FROM overtime_policies o
                WHERE o.tenant_id = t.id AND o.branch_id IS NULL AND o.designation_id IS NULL
            )
        `);
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
        await queryRunner.query(`DROP TABLE IF EXISTS payroll_adjustments`);
        await queryRunner.query(`DROP TABLE IF EXISTS payroll_line_items`);
        await queryRunner.query(`DROP TABLE IF EXISTS payroll_lines`);
        await queryRunner.query(`DROP TABLE IF EXISTS payroll_runs`);
        await queryRunner.query(`DROP TABLE IF EXISTS employee_loans_advances`);
        await queryRunner.query(`DROP TABLE IF EXISTS overtime_policies`);
        await queryRunner.query(
            `DROP TABLE IF EXISTS employee_salary_components`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS employee_salary_structures`,
        );
    }
}
