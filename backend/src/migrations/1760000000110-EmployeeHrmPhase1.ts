import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employee HRM — Phase 1: the employee master and the history spine.
 *
 * Spec of record: docs/HRM.md. This migration creates only what Phase 1 needs;
 * attendance, leaves, payroll, reviews and training land in later phases with
 * their own migrations.
 *
 * Six things worth knowing before reading the SQL:
 *
 * 1. `employees` is NOT `users`. Most staff — cooks, cleaners, porters,
 *    security — never log in, so `user_id` is nullable. When it IS set the two
 *    are 1:1, enforced by a partial unique index rather than a plain UNIQUE so
 *    the many nulls don't collide.
 *
 * 2. `employee_assignments` is the history spine. Current assignment = the row
 *    with `effective_to IS NULL`, and a partial unique index guarantees exactly
 *    one. Transfers and promotions close a row and open another; nothing is
 *    ever updated in place, which is what makes employment history a query
 *    rather than four bespoke audit tables.
 *
 * 3. `brand_id` on an assignment is nullable on purpose. Cleaners and security
 *    belong to the branch, not a brand, and must stay visible to any manager on
 *    that floor.
 *
 * 4. PIN columns live on `employees` from the start even though the attendance
 *    station is Phase 2 — cheaper than ALTERing a table that will by then hold
 *    live staff records.
 *
 * 5. `hr_manager` is a new GLOBAL role (tenant_id NULL, following
 *    general_manager). It carries `all-branches:access` because HR is
 *    tenant-wide: an HR manager typically has no `branch_users` rows at all and
 *    would otherwise see nobody.
 *
 * 6. `salary:view` is granted to owner/GM/HR ONLY. Branch managers get
 *    `employees:view` + `employee-docs:view` and nothing else. This is the one
 *    grant in here that is hard to reverse in practice — pay figures cannot be
 *    un-seen — so it starts closed.
 */
export class EmployeeHrmPhase11760000000110 implements MigrationInterface {
    name = 'EmployeeHrmPhase11760000000110';

    private readonly permissions = [
        {
            name: 'employees:view',
            resource: 'employees',
            action: 'view',
            description: 'View employee records and employment history',
        },
        {
            name: 'employees:create',
            resource: 'employees',
            action: 'create',
            description: 'Create employee records',
        },
        {
            name: 'employees:edit',
            resource: 'employees',
            action: 'edit',
            description:
                'Edit employees, assignments, transfers and promotions',
        },
        {
            name: 'employees:terminate',
            resource: 'employees',
            action: 'terminate',
            description: 'Record resignations and terminations',
        },
        {
            name: 'employee-docs:view',
            resource: 'employee-docs',
            action: 'view',
            description: 'View employee documents',
        },
        {
            name: 'employee-docs:manage',
            resource: 'employee-docs',
            action: 'manage',
            description: 'Upload, verify and remove employee documents',
        },
        {
            name: 'employee-pin:reset',
            resource: 'employee-pin',
            action: 'reset',
            description: 'Reset an employee attendance PIN or QR card',
        },
        {
            name: 'salary:view',
            resource: 'salary',
            action: 'view',
            description: 'View salary figures and payslips',
        },
        {
            name: 'salary:edit',
            resource: 'salary',
            action: 'edit',
            description: 'Set and revise employee salary structures',
        },
        {
            name: 'hr-settings:manage',
            resource: 'hr-settings',
            action: 'manage',
            description: 'Manage designations and HR policy configuration',
        },
        {
            name: 'hr-audit:view',
            resource: 'hr-audit',
            action: 'view',
            description: 'View the HR audit trail',
        },
    ];

    /** Full HR access. */
    private readonly adminRoleSlugs = [
        'super_admin',
        'owner',
        'general_manager',
        'hr_manager',
    ];

    /**
     * Read-only people access. NOT salary, NOT terminate, NOT hr-settings —
     * see docs/HRM.md §14.1.
     *
     * Every known manager slug across environments: seeds use `branch_manager`
     * / `brand_admin`, the live client DB uses `branchmanager` / `brandadmin`,
     * and this project's own dev DB uses the `pos_*` family. Targeting one
     * naming style silently grants nothing in the others.
     */
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

    private readonly defaultDesignations = [
        ['Branch Manager', 'branch-manager', 60, 'management'],
        ['Shift Supervisor', 'shift-supervisor', 50, 'management'],
        ['Head Chef', 'head-chef', 50, 'kitchen'],
        ['Cook', 'cook', 30, 'kitchen'],
        ['Kitchen Helper', 'kitchen-helper', 10, 'kitchen'],
        ['Cashier', 'cashier', 30, 'front_of_house'],
        ['Waiter', 'waiter', 20, 'front_of_house'],
        ['Rider', 'rider', 20, 'delivery'],
        ['Cleaner', 'cleaner', 10, 'support'],
        ['Security Guard', 'security-guard', 10, 'support'],
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- designations ----------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS designations (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                name character varying(120) NOT NULL,
                slug character varying(120) NOT NULL,
                level integer NOT NULL DEFAULT 0,
                department character varying(32) NOT NULL DEFAULT 'support',
                default_role_id integer,
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_designations_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_designations_role" FOREIGN KEY (default_role_id)
                    REFERENCES roles(id) ON DELETE SET NULL,
                CONSTRAINT "UQ_designations_tenant_slug" UNIQUE (tenant_id, slug),
                CONSTRAINT "CHK_designations_department" CHECK (department IN (
                    'kitchen', 'front_of_house', 'delivery', 'management', 'support'
                ))
            )
        `);

        // --- employees -------------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employees (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_code character varying(32) NOT NULL,
                full_name character varying(160) NOT NULL,
                father_name character varying(160),
                cnic character varying(32),
                date_of_birth date,
                gender character varying(16),
                phone character varying(32),
                address text,
                emergency_contact_name character varying(160),
                emergency_contact_phone character varying(32),
                photo_url text,
                user_id integer,
                primary_branch_id integer,
                employment_type character varying(32) NOT NULL DEFAULT 'full_time',
                date_of_joining date NOT NULL,
                probation_end_date date,
                confirmation_date date,
                status character varying(32) NOT NULL DEFAULT 'active',
                date_of_leaving date,
                leaving_reason text,
                rehire_eligible boolean,
                bank_name character varying(120),
                account_title character varying(160),
                account_number_iban character varying(64),
                payment_method character varying(32) NOT NULL DEFAULT 'cash',
                pin_hash character varying(255),
                pin_set_at timestamp,
                pin_failed_attempts integer NOT NULL DEFAULT 0,
                pin_locked_until timestamp,
                qr_token character varying(64),
                qr_token_issued_at timestamp,
                metadata jsonb NOT NULL DEFAULT '{}',
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_employees_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_employees_user" FOREIGN KEY (user_id)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "FK_employees_branch" FOREIGN KEY (primary_branch_id)
                    REFERENCES branches(id) ON DELETE SET NULL,
                CONSTRAINT "UQ_employees_tenant_code" UNIQUE (tenant_id, employee_code),
                CONSTRAINT "CHK_employees_status" CHECK (status IN (
                    'active', 'on_leave', 'suspended', 'notice_period',
                    'resigned', 'terminated'
                )),
                CONSTRAINT "CHK_employees_employment_type" CHECK (employment_type IN (
                    'full_time', 'part_time', 'contract', 'probation'
                )),
                CONSTRAINT "CHK_employees_payment_method" CHECK (payment_method IN (
                    'cash', 'bank_transfer'
                ))
            )
        `);
        // Partial uniques: plain UNIQUE would be satisfied by nulls in Postgres,
        // but being explicit documents that duplicates are only allowed absent.
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_employees_user"
             ON employees (user_id) WHERE user_id IS NOT NULL`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_employees_tenant_cnic"
             ON employees (tenant_id, cnic) WHERE cnic IS NOT NULL`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_employees_qr_token"
             ON employees (qr_token) WHERE qr_token IS NOT NULL`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_employees_tenant_status"
             ON employees (tenant_id, status)`,
        );

        // --- employee_assignments (the history spine) ------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_assignments (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                branch_id integer NOT NULL,
                brand_id integer,
                designation_id integer NOT NULL,
                employment_type character varying(32) NOT NULL DEFAULT 'full_time',
                effective_from date NOT NULL,
                effective_to date,
                change_reason character varying(32) NOT NULL,
                source_review_id integer,
                note text,
                created_by integer,
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_emp_assign_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_assign_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_assign_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE RESTRICT,
                CONSTRAINT "FK_emp_assign_brand" FOREIGN KEY (brand_id)
                    REFERENCES brands(id) ON DELETE SET NULL,
                CONSTRAINT "FK_emp_assign_designation" FOREIGN KEY (designation_id)
                    REFERENCES designations(id) ON DELETE RESTRICT,
                CONSTRAINT "FK_emp_assign_creator" FOREIGN KEY (created_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_emp_assign_reason" CHECK (change_reason IN (
                    'hire', 'confirmation', 'promotion', 'demotion',
                    'transfer_branch', 'transfer_brand', 'designation_change',
                    'rehire', 'exit'
                )),
                CONSTRAINT "CHK_emp_assign_dates" CHECK (
                    effective_to IS NULL OR effective_to >= effective_from
                )
            )
        `);
        // Exactly one open assignment per employee. This is the invariant the
        // whole history model rests on — without it, "current branch" becomes
        // ambiguous and every scoping query silently picks a row at random.
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_emp_assign_current"
             ON employee_assignments (employee_id) WHERE effective_to IS NULL`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_emp_assign_employee"
             ON employee_assignments (employee_id, effective_from DESC)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_emp_assign_branch_brand"
             ON employee_assignments (branch_id, brand_id)`,
        );

        // --- employee_documents ----------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_documents (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                doc_type character varying(48) NOT NULL,
                file_url text NOT NULL,
                document_number character varying(64),
                issued_on date,
                expires_on date,
                verified_by integer,
                verified_at timestamp,
                note text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_emp_docs_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_docs_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_docs_verifier" FOREIGN KEY (verified_by)
                    REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_emp_docs_employee"
             ON employee_documents (employee_id)`,
        );
        // Drives the expiry alert sweep; partial so it stays small.
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_emp_docs_expiry"
             ON employee_documents (tenant_id, expires_on) WHERE expires_on IS NOT NULL`,
        );

        // --- employee_events (the timeline) ----------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_events (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                event_type character varying(48) NOT NULL,
                event_date date NOT NULL,
                title character varying(200) NOT NULL,
                description text,
                ref_table character varying(64),
                ref_id integer,
                payload jsonb NOT NULL DEFAULT '{}',
                created_by integer,
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_emp_events_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_events_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_events_creator" FOREIGN KEY (created_by)
                    REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_emp_events_employee"
             ON employee_events (employee_id, event_date DESC, id DESC)`,
        );

        // --- employee_warnings ------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_warnings (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                warning_type character varying(48) NOT NULL,
                severity character varying(16) NOT NULL DEFAULT 'low',
                issued_by integer,
                issued_on date NOT NULL,
                reason text NOT NULL,
                employee_response text,
                document_url text,
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_emp_warn_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_warn_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_warn_issuer" FOREIGN KEY (issued_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_emp_warn_severity" CHECK (severity IN (
                    'low', 'medium', 'high', 'final'
                ))
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_emp_warn_employee"
             ON employee_warnings (employee_id, issued_on DESC)`,
        );

        // --- employee_exits + clearance ---------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_exits (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                exit_type character varying(32) NOT NULL,
                initiated_by integer,
                initiated_on date NOT NULL,
                notice_period_days integer NOT NULL DEFAULT 0,
                last_working_date date NOT NULL,
                reason text,
                exit_interview_notes text,
                rehire_eligible boolean NOT NULL DEFAULT true,
                clearance_status character varying(32) NOT NULL DEFAULT 'pending',
                settlement_payroll_line_id integer,
                settled_at timestamp,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_emp_exits_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_exits_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_exits_initiator" FOREIGN KEY (initiated_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_emp_exits_type" CHECK (exit_type IN (
                    'resignation', 'termination', 'end_of_contract', 'abandonment'
                )),
                CONSTRAINT "CHK_emp_exits_clearance" CHECK (clearance_status IN (
                    'pending', 'in_progress', 'cleared', 'withheld'
                ))
            )
        `);
        // One live exit per employee. A rehire re-opens employment through a new
        // assignment; it does not need a second open exit record.
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_emp_exits_open"
             ON employee_exits (employee_id) WHERE settled_at IS NULL`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_clearance_items (
                id serial PRIMARY KEY,
                exit_id integer NOT NULL,
                item_type character varying(32) NOT NULL,
                description character varying(200) NOT NULL,
                responsible_role character varying(64),
                status character varying(32) NOT NULL DEFAULT 'pending',
                cleared_by integer,
                cleared_at timestamp,
                note text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_emp_clear_exit" FOREIGN KEY (exit_id)
                    REFERENCES employee_exits(id) ON DELETE CASCADE,
                CONSTRAINT "FK_emp_clear_user" FOREIGN KEY (cleared_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_emp_clear_status" CHECK (status IN (
                    'pending', 'cleared', 'withheld', 'not_applicable'
                ))
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_emp_clear_exit"
             ON employee_clearance_items (exit_id)`,
        );

        // --- hr_audit_log -----------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS hr_audit_log (
                id serial PRIMARY KEY,
                tenant_id integer,
                actor_user_id integer,
                action character varying(64) NOT NULL,
                entity_table character varying(64) NOT NULL,
                entity_id integer,
                "before" jsonb NOT NULL DEFAULT '{}',
                "after" jsonb NOT NULL DEFAULT '{}',
                ip_address character varying(64),
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_hr_audit_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_hr_audit_actor" FOREIGN KEY (actor_user_id)
                    REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_hr_audit_entity"
             ON hr_audit_log (entity_table, entity_id, created_at DESC)`,
        );

        // --- permissions -------------------------------------------------------
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
        }

        // --- hr_manager role ----------------------------------------------------
        await queryRunner.query(`
            INSERT INTO roles (name, slug, tenant_id)
            SELECT 'HR Manager', 'hr_manager', NULL
            WHERE NOT EXISTS (SELECT 1 FROM roles WHERE slug = 'hr_manager')
        `);

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
        // HR is tenant-wide and its holder usually has no branch_users rows, so
        // without all-branches:access an HR manager would see an empty roster.
        await grant(['hr_manager'], ['dashboard:view', 'all-branches:access']);
        await grant(this.managerRoleSlugs, [
            'employees:view',
            'employee-docs:view',
        ]);

        // --- default designations ------------------------------------------------
        // Seeded per tenant so the module is usable the moment it is deployed.
        //
        // Idempotency is per (tenant, slug) via ON CONFLICT, NOT "skip tenants
        // that already have any designation": that cheaper-looking guard is
        // satisfied by the first row inserted, so every designation after the
        // first is silently dropped and the tenant ends up with exactly one.
        for (const [name, slug, level, department] of this
            .defaultDesignations) {
            await queryRunner.query(
                `INSERT INTO designations (tenant_id, name, slug, level, department)
                 SELECT t.id, $1, $2, $3, $4 FROM tenants t
                 ON CONFLICT (tenant_id, slug) DO NOTHING`,
                [name, slug, level, department],
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
            `DELETE FROM role_permissions WHERE role_id IN (
                 SELECT id FROM roles WHERE slug = 'hr_manager'
             )`,
        );
        await queryRunner.query(`DELETE FROM roles WHERE slug = 'hr_manager'`);
        await queryRunner.query(
            `DELETE FROM permissions WHERE name = ANY($1)`,
            [this.permissions.map((p) => p.name)],
        );

        await queryRunner.query(`DROP TABLE IF EXISTS hr_audit_log`);
        await queryRunner.query(
            `DROP TABLE IF EXISTS employee_clearance_items`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS employee_exits`);
        await queryRunner.query(`DROP TABLE IF EXISTS employee_warnings`);
        await queryRunner.query(`DROP TABLE IF EXISTS employee_events`);
        await queryRunner.query(`DROP TABLE IF EXISTS employee_documents`);
        await queryRunner.query(`DROP TABLE IF EXISTS employee_assignments`);
        await queryRunner.query(`DROP TABLE IF EXISTS employees`);
        await queryRunner.query(`DROP TABLE IF EXISTS designations`);
    }
}
