import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employee HRM — Phase 2: attendance capture.
 *
 * Spec: docs/HRM.md §§5, 6, 7, 11. Purely additive — new tables, new
 * permissions, one nullable column on `employees` (itself introduced in Phase 1
 * and not yet carrying production data).
 *
 * Notes that matter when reading the SQL:
 *
 * 1. `attendance_punches` is IMMUTABLE. Corrections live in
 *    `attendance_exceptions` and change the derived `attendance_days` row, so
 *    what the machine saw and what a human decided stay separately readable.
 *
 * 2. `attendance_days` is unique on (employee, work_date) — where work_date is
 *    the branch-local date the shift STARTS. A 17:00→02:00 shift produces ONE
 *    row, not two.
 *
 * 3. No `pos_terminals` table (decision #22). Punches bind to the branch and
 *    stamp `pos_user_id`; burst detection groups by that.
 *
 * 4. `branches.timezone` is NOT touched. It already exists, live rows are
 *    already Asia/Karachi, and it also gates time-restricted menu items, lunch
 *    deals and bank-card offer windows — blanket-updating it would move all of
 *    those. The service warns instead when a branch is left on UTC.
 *
 * 5. Seeds one default schedule template and one capture policy per tenant so
 *    the station is usable immediately; both are editable in HR Settings.
 */
export class EmployeeHrmPhase2Attendance1760000000111 implements MigrationInterface {
    name = 'EmployeeHrmPhase2Attendance1760000000111';

    private readonly permissions = [
        {
            name: 'attendance:view',
            resource: 'attendance',
            action: 'view',
            description: 'View the attendance register and exceptions',
        },
        {
            name: 'attendance:punch',
            resource: 'attendance',
            action: 'punch',
            description: 'Operate the attendance station (clock staff in/out)',
        },
        {
            name: 'attendance:attest',
            resource: 'attendance',
            action: 'attest',
            description:
                'Record attendance on an employee’s behalf (roll call)',
        },
        {
            name: 'attendance:adjust',
            resource: 'attendance',
            action: 'adjust',
            description: 'Request a correction to a recorded attendance day',
        },
        {
            name: 'attendance:approve',
            resource: 'attendance',
            action: 'approve',
            description: 'Approve or reject attendance corrections',
        },
        {
            name: 'attendance-waiver:approve',
            resource: 'attendance-waiver',
            action: 'approve',
            description: 'Waive a late or absence deduction, with a reason',
        },
        {
            name: 'attendance:recompute',
            resource: 'attendance',
            action: 'recompute',
            description: 'Force a recompute of derived attendance days',
        },
        {
            name: 'overtime:view',
            resource: 'overtime',
            action: 'view',
            description: 'View pending and approved overtime',
        },
        {
            name: 'overtime:approve',
            resource: 'overtime',
            action: 'approve',
            description: 'Approve overtime so payroll will pay it',
        },
    ];

    private readonly adminRoleSlugs = [
        'super_admin',
        'owner',
        'general_manager',
        'hr_manager',
    ];

    /** Branch/shift managers run the register day to day. */
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

    /** Till staff only operate the station; they approve nothing. */
    private readonly tillRoleSlugs = [
        'cashier',
        'pos_cashier',
        'call_centre_agent',
        'call_center_agent',
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- schedule templates ---------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS work_schedule_templates (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                branch_id integer,
                designation_id integer,
                name character varying(120) NOT NULL,
                start_time time NOT NULL,
                end_time time NOT NULL,
                crosses_midnight boolean NOT NULL DEFAULT false,
                break_minutes integer NOT NULL DEFAULT 0,
                grace_minutes integer NOT NULL DEFAULT 15,
                half_day_after_late_minutes integer DEFAULT 120,
                min_minutes_full_day integer NOT NULL DEFAULT 480,
                min_minutes_half_day integer NOT NULL DEFAULT 270,
                overtime_after_minutes integer NOT NULL DEFAULT 30,
                weekly_off_days jsonb NOT NULL DEFAULT '[]',
                attribution_lead_hours integer NOT NULL DEFAULT 6,
                attribution_trail_hours integer NOT NULL DEFAULT 6,
                is_default boolean NOT NULL DEFAULT true,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_wst_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_wst_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "FK_wst_designation" FOREIGN KEY (designation_id)
                    REFERENCES designations(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_wst_thresholds" CHECK (
                    min_minutes_half_day <= min_minutes_full_day
                ),
                -- crosses_midnight is DERIVABLE, so it must not be able to
                -- disagree with the times. Flagging 11:00→23:00 as crossing
                -- makes the engine treat the shift as ending at 23:00 the NEXT
                -- day: a 36-hour scheduled day, which silently zeroes overtime
                -- and stretches the punch-attribution window across two days.
                CONSTRAINT "CHK_wst_crosses_midnight" CHECK (
                    crosses_midnight = (end_time < start_time)
                )
            )
        `);

        await queryRunner.query(
            `ALTER TABLE employees ADD COLUMN IF NOT EXISTS default_schedule_template_id integer`,
        );
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE employees ADD CONSTRAINT "FK_employees_schedule_template"
                    FOREIGN KEY (default_schedule_template_id)
                    REFERENCES work_schedule_templates(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);

        // --- roster -----------------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_schedules (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                branch_id integer NOT NULL,
                work_date date NOT NULL,
                template_id integer,
                is_weekly_off boolean NOT NULL DEFAULT false,
                is_holiday boolean NOT NULL DEFAULT false,
                is_published boolean NOT NULL DEFAULT true,
                created_by integer,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_esch_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_esch_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_esch_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "FK_esch_template" FOREIGN KEY (template_id)
                    REFERENCES work_schedule_templates(id) ON DELETE SET NULL,
                CONSTRAINT "UQ_esch_employee_date" UNIQUE (employee_id, work_date)
            )
        `);

        // --- capture policy ----------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS attendance_capture_policies (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                branch_id integer,
                primary_method character varying(16) NOT NULL DEFAULT 'pin',
                require_photo boolean NOT NULL DEFAULT false,
                allow_manager_attestation boolean NOT NULL DEFAULT true,
                duplicate_window_seconds integer NOT NULL DEFAULT 60,
                photo_retention_days integer NOT NULL DEFAULT 90,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_acp_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_acp_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "CHK_acp_method" CHECK (primary_method IN ('pin', 'qr_card'))
            )
        `);
        // One policy per scope: a second tenant-wide row would make "which
        // policy applies" depend on insertion order.
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_acp_tenant_default"
             ON attendance_capture_policies (tenant_id) WHERE branch_id IS NULL`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_acp_tenant_branch"
             ON attendance_capture_policies (tenant_id, branch_id) WHERE branch_id IS NOT NULL`,
        );

        // --- punches (immutable) ------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS attendance_punches (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                branch_id integer NOT NULL,
                punch_type character varying(16) NOT NULL,
                punched_at timestamp NOT NULL,
                source character varying(32) NOT NULL DEFAULT 'pos',
                method character varying(16) NOT NULL DEFAULT 'pin',
                pos_user_id integer,
                photo_url text,
                latitude numeric(10,7),
                longitude numeric(10,7),
                is_manual boolean NOT NULL DEFAULT false,
                created_by integer,
                note text,
                work_date date,
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_ap_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ap_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ap_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ap_pos_user" FOREIGN KEY (pos_user_id)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_ap_type" CHECK (punch_type IN ('in', 'out', 'break_start', 'break_end')),
                CONSTRAINT "CHK_ap_source" CHECK (source IN ('pos', 'manager_attestation', 'admin_manual', 'rider_app'))
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_ap_employee_date"
             ON attendance_punches (employee_id, work_date)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_ap_branch_time"
             ON attendance_punches (branch_id, punched_at DESC)`,
        );
        // Burst detection: many punches under one till session in a short window.
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_ap_pos_user_time"
             ON attendance_punches (pos_user_id, punched_at DESC) WHERE pos_user_id IS NOT NULL`,
        );

        // --- derived days --------------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS attendance_days (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                branch_id integer NOT NULL,
                work_date date NOT NULL,
                schedule_template_id integer,
                planned_start_at timestamp,
                planned_end_at timestamp,
                first_in_at timestamp,
                last_out_at timestamp,
                worked_minutes integer NOT NULL DEFAULT 0,
                break_minutes integer NOT NULL DEFAULT 0,
                late_minutes integer NOT NULL DEFAULT 0,
                early_leave_minutes integer NOT NULL DEFAULT 0,
                overtime_minutes_pending integer NOT NULL DEFAULT 0,
                overtime_minutes_approved integer NOT NULL DEFAULT 0,
                status character varying(24) NOT NULL DEFAULT 'absent',
                leave_request_id integer,
                exception_flags jsonb NOT NULL DEFAULT '{}',
                is_locked boolean NOT NULL DEFAULT false,
                computed_at timestamp,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_ad_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ad_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ad_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ad_template" FOREIGN KEY (schedule_template_id)
                    REFERENCES work_schedule_templates(id) ON DELETE SET NULL,
                CONSTRAINT "UQ_ad_employee_date" UNIQUE (employee_id, work_date),
                CONSTRAINT "CHK_ad_status" CHECK (status IN (
                    'present', 'half_day', 'absent', 'leave_paid',
                    'leave_unpaid', 'weekly_off', 'holiday'
                ))
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_ad_branch_date"
             ON attendance_days (branch_id, work_date DESC)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_ad_tenant_date_status"
             ON attendance_days (tenant_id, work_date, status)`,
        );

        // --- exceptions ------------------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS attendance_exceptions (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                attendance_day_id integer NOT NULL,
                kind character varying(24) NOT NULL,
                subject character varying(24) NOT NULL,
                old_value jsonb NOT NULL DEFAULT '{}',
                new_value jsonb NOT NULL DEFAULT '{}',
                minutes_waived integer,
                amount_waived numeric(12,2),
                reason text NOT NULL,
                requested_by integer,
                approved_by integer,
                approved_at timestamp,
                status character varying(16) NOT NULL DEFAULT 'pending',
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_ae_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ae_day" FOREIGN KEY (attendance_day_id)
                    REFERENCES attendance_days(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ae_requester" FOREIGN KEY (requested_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "FK_ae_approver" FOREIGN KEY (approved_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_ae_kind" CHECK (kind IN ('adjustment', 'waiver', 'overtime_approval')),
                CONSTRAINT "CHK_ae_status" CHECK (status IN ('pending', 'approved', 'rejected')),
                -- An unexplained waiver is exactly what this table exists to
                -- make impossible.
                CONSTRAINT "CHK_ae_reason" CHECK (length(btrim(reason)) > 0)
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_ae_day" ON attendance_exceptions (attendance_day_id)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_ae_pending"
             ON attendance_exceptions (tenant_id, status) WHERE status = 'pending'`,
        );

        // --- permissions --------------------------------------------------------------
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
            'attendance:view',
            'attendance:punch',
            'attendance:attest',
            'attendance:adjust',
            'attendance:approve',
            'overtime:view',
            'overtime:approve',
        ]);
        // Operate the station, nothing else. Waiving a deduction for yourself
        // would be the obvious hole.
        await grant(this.tillRoleSlugs, ['attendance:punch']);

        // --- seed one default template + capture policy per tenant ------------------
        await queryRunner.query(`
            INSERT INTO work_schedule_templates
                (tenant_id, name, start_time, end_time, crosses_midnight, weekly_off_days)
            SELECT t.id, 'General shift', '11:00', '23:00', false, '[]'::jsonb
            FROM tenants t
            WHERE NOT EXISTS (
                SELECT 1 FROM work_schedule_templates w WHERE w.tenant_id = t.id
            )
        `);
        await queryRunner.query(`
            INSERT INTO attendance_capture_policies (tenant_id, branch_id)
            SELECT t.id, NULL FROM tenants t
            ON CONFLICT DO NOTHING
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
        await queryRunner.query(
            `ALTER TABLE employees DROP CONSTRAINT IF EXISTS "FK_employees_schedule_template"`,
        );
        await queryRunner.query(
            `ALTER TABLE employees DROP COLUMN IF EXISTS default_schedule_template_id`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS attendance_exceptions`);
        await queryRunner.query(`DROP TABLE IF EXISTS attendance_days`);
        await queryRunner.query(`DROP TABLE IF EXISTS attendance_punches`);
        await queryRunner.query(
            `DROP TABLE IF EXISTS attendance_capture_policies`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS employee_schedules`);
        await queryRunner.query(`DROP TABLE IF EXISTS work_schedule_templates`);
    }
}
