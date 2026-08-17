import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employee HRM — Phase 3: leaves, holidays and the monthly-off entitlement.
 *
 * Spec: docs/HRM.md §8. Purely additive — five new tables, four new
 * permissions, no change to anything that already exists.
 *
 * Design notes:
 *
 * 1. The client's "4 holidays per month" is a LEAVE TYPE (`monthly_off`), not a
 *    separate mechanism, so one balance ledger and one approval flow cover
 *    everything. What makes it distinctive is paid + no carry-forward +
 *    encash-unused, which `holiday_policies` also records so payroll can read
 *    the entitlement without inferring it from a leave type.
 *
 * 2. `public_holidays` is deliberately NOT the same thing and does not consume
 *    the monthly quota. A holiday is the business not opening; an off is the
 *    employee not coming in. Conflating them costs every employee a day of
 *    entitlement whenever Eid falls.
 *
 * 3. Approving a request writes into `attendance_days`. Leave is not a parallel
 *    universe from attendance, so payroll reads one source.
 *
 * 4. Seeds the agreed policy per tenant: 4 offs/month paid + encashed, plus
 *    casual, sick and unpaid leave types. All editable in HR Settings.
 */
export class EmployeeHrmPhase3Leaves1760000000112 implements MigrationInterface {
    name = 'EmployeeHrmPhase3Leaves1760000000112';

    private readonly permissions = [
        {
            name: 'leaves:view',
            resource: 'leaves',
            action: 'view',
            description: 'View leave requests and balances',
        },
        {
            name: 'leaves:request',
            resource: 'leaves',
            action: 'request',
            description: 'Raise a leave request on an employee’s behalf',
        },
        {
            name: 'leaves:approve',
            resource: 'leaves',
            action: 'approve',
            description: 'Approve or reject leave requests',
        },
        {
            name: 'holidays:manage',
            resource: 'holidays',
            action: 'manage',
            description:
                'Manage leave types, holiday policy and the public holiday calendar',
        },
    ];

    private readonly adminRoleSlugs = [
        'super_admin',
        'owner',
        'general_manager',
        'hr_manager',
    ];

    /** Managers raise and approve leave; they do not configure the policy. */
    private readonly managerRoleSlugs = [
        'manager',
        'branch_manager',
        'branchmanager',
        'brand_admin',
        'brandadmin',
        'pos_branch_manager',
        'pos_shift_manager_tab',
        'delivery_manager',
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS leave_types (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                name character varying(120) NOT NULL,
                code character varying(48) NOT NULL,
                is_paid boolean NOT NULL DEFAULT true,
                accrual_mode character varying(16) NOT NULL DEFAULT 'monthly',
                quota_per_period numeric(6,2) NOT NULL DEFAULT 0,
                carry_forward boolean NOT NULL DEFAULT false,
                encash_unused boolean NOT NULL DEFAULT false,
                max_consecutive_days integer,
                requires_document boolean NOT NULL DEFAULT false,
                is_monthly_off boolean NOT NULL DEFAULT false,
                sort_order integer NOT NULL DEFAULT 0,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_lt_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "UQ_lt_tenant_code" UNIQUE (tenant_id, code),
                CONSTRAINT "CHK_lt_accrual" CHECK (accrual_mode IN ('monthly', 'annual', 'none'))
            )
        `);
        // Exactly one type may consume the monthly-off entitlement; two would
        // make "how many offs are left" depend on which one was picked.
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lt_monthly_off"
             ON leave_types (tenant_id) WHERE is_monthly_off = true`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS leave_balances (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                leave_type_id integer NOT NULL,
                period_year integer NOT NULL,
                period_month integer,
                entitled numeric(6,2) NOT NULL DEFAULT 0,
                used numeric(6,2) NOT NULL DEFAULT 0,
                carried_forward numeric(6,2) NOT NULL DEFAULT 0,
                adjusted numeric(6,2) NOT NULL DEFAULT 0,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_lb_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_lb_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_lb_type" FOREIGN KEY (leave_type_id)
                    REFERENCES leave_types(id) ON DELETE CASCADE,
                CONSTRAINT "CHK_lb_month" CHECK (period_month IS NULL OR period_month BETWEEN 1 AND 12)
            )
        `);
        // period_month is nullable for annual types, and NULLs do not collide in
        // a plain UNIQUE — so the two cases get separate partial indexes.
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lb_monthly"
             ON leave_balances (employee_id, leave_type_id, period_year, period_month)
             WHERE period_month IS NOT NULL`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lb_annual"
             ON leave_balances (employee_id, leave_type_id, period_year)
             WHERE period_month IS NULL`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS leave_requests (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                leave_type_id integer NOT NULL,
                from_date date NOT NULL,
                to_date date NOT NULL,
                first_day_part character varying(16) NOT NULL DEFAULT 'full',
                last_day_part character varying(16) NOT NULL DEFAULT 'full',
                total_days numeric(6,2) NOT NULL DEFAULT 0,
                paid_days numeric(6,2) NOT NULL DEFAULT 0,
                unpaid_days numeric(6,2) NOT NULL DEFAULT 0,
                reason text,
                attachment_url text,
                status character varying(16) NOT NULL DEFAULT 'pending',
                requested_by integer,
                approved_by integer,
                approved_at timestamp,
                decision_note text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_lr_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_lr_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_lr_type" FOREIGN KEY (leave_type_id)
                    REFERENCES leave_types(id) ON DELETE RESTRICT,
                CONSTRAINT "FK_lr_requester" FOREIGN KEY (requested_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "FK_lr_approver" FOREIGN KEY (approved_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_lr_status" CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
                CONSTRAINT "CHK_lr_range" CHECK (to_date >= from_date),
                CONSTRAINT "CHK_lr_parts" CHECK (
                    first_day_part IN ('full', 'first_half', 'second_half')
                    AND last_day_part IN ('full', 'first_half', 'second_half')
                )
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_lr_employee_range"
             ON leave_requests (employee_id, from_date, to_date)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_lr_pending"
             ON leave_requests (tenant_id, status) WHERE status = 'pending'`,
        );
        // One approved request may cover a date; overlapping approvals would
        // write conflicting statuses onto the same attendance day.
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_lr_approved_range"
             ON leave_requests (employee_id, from_date, to_date) WHERE status = 'approved'`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS public_holidays (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                branch_id integer,
                holiday_date date NOT NULL,
                name character varying(160) NOT NULL,
                is_paid boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_ph_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ph_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_ph_tenant_date"
             ON public_holidays (tenant_id, holiday_date)`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS holiday_policies (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                branch_id integer,
                designation_id integer,
                offs_per_month numeric(5,2) NOT NULL DEFAULT 4,
                offs_are_paid boolean NOT NULL DEFAULT true,
                carry_forward boolean NOT NULL DEFAULT false,
                encash_unused boolean NOT NULL DEFAULT true,
                off_selection character varying(24) NOT NULL DEFAULT 'floating',
                beyond_quota_treatment character varying(24) NOT NULL DEFAULT 'unpaid_leave',
                effective_from date,
                effective_to date,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_hp_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_hp_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "FK_hp_designation" FOREIGN KEY (designation_id)
                    REFERENCES designations(id) ON DELETE CASCADE,
                CONSTRAINT "CHK_hp_beyond" CHECK (beyond_quota_treatment IN ('unpaid_leave', 'absent'))
            )
        `);

        // --- permissions -----------------------------------------------------
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

        await grant(
            this.adminRoleSlugs,
            this.permissions.map((p) => p.name),
        );
        await grant(this.managerRoleSlugs, [
            'leaves:view',
            'leaves:request',
            'leaves:approve',
        ]);

        // --- seed the agreed policy ------------------------------------------
        await queryRunner.query(`
            INSERT INTO holiday_policies (tenant_id)
            SELECT t.id FROM tenants t
            WHERE NOT EXISTS (
                SELECT 1 FROM holiday_policies h
                WHERE h.tenant_id = t.id AND h.branch_id IS NULL AND h.designation_id IS NULL
            )
        `);

        const leaveTypes: Array<
            [string, string, boolean, string, number, boolean, boolean]
        > = [
            // name, code, isPaid, accrual, quota, encashUnused, isMonthlyOff
            ['Monthly Off', 'monthly_off', true, 'monthly', 4, true, true],
            ['Casual Leave', 'casual', true, 'monthly', 1, false, false],
            ['Sick Leave', 'sick', true, 'annual', 8, false, false],
            ['Unpaid Leave', 'unpaid', false, 'none', 0, false, false],
        ];
        let sortOrder = 0;
        for (const [
            name,
            code,
            isPaid,
            accrual,
            quota,
            encash,
            isMonthlyOff,
        ] of leaveTypes) {
            sortOrder += 1;
            await queryRunner.query(
                `INSERT INTO leave_types
                    (tenant_id, name, code, is_paid, accrual_mode, quota_per_period,
                     encash_unused, is_monthly_off, sort_order)
                 SELECT t.id, $1, $2, $3, $4, $5, $6, $7, $8 FROM tenants t
                 ON CONFLICT (tenant_id, code) DO NOTHING`,
                [
                    name,
                    code,
                    isPaid,
                    accrual,
                    quota,
                    encash,
                    isMonthlyOff,
                    sortOrder,
                ],
            );
        }
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
        await queryRunner.query(`DROP TABLE IF EXISTS holiday_policies`);
        await queryRunner.query(`DROP TABLE IF EXISTS public_holidays`);
        await queryRunner.query(`DROP TABLE IF EXISTS leave_requests`);
        await queryRunner.query(`DROP TABLE IF EXISTS leave_balances`);
        await queryRunner.query(`DROP TABLE IF EXISTS leave_types`);
    }
}
