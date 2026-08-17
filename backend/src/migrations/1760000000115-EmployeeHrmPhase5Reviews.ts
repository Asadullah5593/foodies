import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Employee HRM — Phase 5: reviews, promotions and training.
 *
 * Spec: docs/HRM.md §§3.7, 13. Purely additive — six tables, seven permissions.
 *
 * The load-bearing decision is `review_cycles.origin`. The scheduler that
 * generates upcoming cycles filters `origin = 'system'`, which makes an ad-hoc
 * review structurally incapable of delaying, replacing or satisfying a scheduled
 * one. The client asked for exactly that, and enforcing it in the data model
 * rather than by convention is what keeps it true a year from now.
 *
 * A partial unique index also stops two open SCHEDULED cycles existing for one
 * employee — the cadence must be a single line, not a fork. Ad-hoc cycles are
 * deliberately exempt: several can be open at once.
 */
export class EmployeeHrmPhase5Reviews1760000000115 implements MigrationInterface {
    name = 'EmployeeHrmPhase5Reviews1760000000115';

    private readonly permissions = [
        {
            name: 'reviews:view',
            resource: 'reviews',
            action: 'view',
            description: 'View review cycles and completed reviews',
        },
        {
            name: 'reviews:conduct',
            resource: 'reviews',
            action: 'conduct',
            description: 'Fill in and submit a review',
        },
        {
            name: 'reviews:approve',
            resource: 'reviews',
            action: 'approve',
            description:
                'Approve a review, applying its outcome (promotion, increment)',
        },
        {
            name: 'reviews:initiate-adhoc',
            resource: 'reviews',
            action: 'initiate-adhoc',
            description:
                'Raise an out-of-cycle review; never affects the scheduled cadence',
        },
        {
            name: 'training:view',
            resource: 'training',
            action: 'view',
            description: 'View training programs and employee records',
        },
        {
            name: 'training:manage',
            resource: 'training',
            action: 'manage',
            description: 'Create programs and set designation requirements',
        },
        {
            name: 'training:record',
            resource: 'training',
            action: 'record',
            description: 'Assign training and record completions',
        },
    ];

    private readonly adminRoleSlugs = [
        'super_admin',
        'owner',
        'general_manager',
        'hr_manager',
    ];

    /** Managers conduct reviews and record training; they do not approve outcomes. */
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
            CREATE TABLE IF NOT EXISTS review_templates (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                name character varying(160) NOT NULL,
                applies_to_cycle_types jsonb NOT NULL DEFAULT '["quarterly"]',
                schema jsonb NOT NULL DEFAULT '{}',
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_rt_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE
            )
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS review_cycles (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                sequence_no integer,
                cycle_type character varying(24) NOT NULL,
                origin character varying(16) NOT NULL DEFAULT 'system',
                ad_hoc_reason character varying(48),
                period_from date NOT NULL,
                period_to date NOT NULL,
                due_date date NOT NULL,
                reviewer_user_id integer,
                template_id integer,
                status character varying(24) NOT NULL DEFAULT 'scheduled',
                skip_reason text,
                created_by integer,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_rc_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_rc_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_rc_reviewer" FOREIGN KEY (reviewer_user_id)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "FK_rc_template" FOREIGN KEY (template_id)
                    REFERENCES review_templates(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_rc_type" CHECK (cycle_type IN ('probation_3m', 'quarterly', 'ad_hoc')),
                CONSTRAINT "CHK_rc_origin" CHECK (origin IN ('system', 'manual')),
                CONSTRAINT "CHK_rc_status" CHECK (status IN (
                    'scheduled', 'in_progress', 'submitted', 'approved', 'closed', 'skipped'
                )),
                -- An ad-hoc cycle is always manual, and a scheduled one always
                -- system-generated. Mixing them is what would let an ad-hoc
                -- review leak into the cadence.
                CONSTRAINT "CHK_rc_adhoc_origin" CHECK (
                    (cycle_type = 'ad_hoc') = (origin = 'manual')
                ),
                CONSTRAINT "CHK_rc_adhoc_reason" CHECK (
                    cycle_type <> 'ad_hoc' OR ad_hoc_reason IS NOT NULL
                ),
                -- Ad-hoc reviews carry no position in the scheduled sequence.
                CONSTRAINT "CHK_rc_sequence" CHECK (
                    (cycle_type = 'ad_hoc') = (sequence_no IS NULL)
                )
            )
        `);
        // One open SCHEDULED cycle per employee: the cadence is a single line,
        // not a fork. Ad-hoc cycles are exempt — several may be open.
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rc_open_scheduled"
             ON review_cycles (employee_id)
             WHERE origin = 'system' AND status IN ('scheduled', 'in_progress', 'submitted')`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_rc_due"
             ON review_cycles (tenant_id, due_date)
             WHERE status IN ('scheduled', 'in_progress')`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_rc_employee"
             ON review_cycles (employee_id, due_date DESC)`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_reviews (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                cycle_id integer NOT NULL,
                employee_id integer NOT NULL,
                reviewer_user_id integer,
                template_snapshot jsonb NOT NULL DEFAULT '{}',
                answers jsonb NOT NULL DEFAULT '{}',
                total_score numeric(8,2) NOT NULL DEFAULT 0,
                max_score numeric(8,2) NOT NULL DEFAULT 0,
                normalized_percent numeric(5,2),
                strengths text,
                improvements text,
                reviewer_comments text,
                employee_comments text,
                acknowledged_at timestamp,
                outcome character varying(24),
                promoted_to_designation_id integer,
                new_basic_amount numeric(12,2),
                effective_from date,
                training_gaps jsonb NOT NULL DEFAULT '[]',
                status character varying(16) NOT NULL DEFAULT 'draft',
                submitted_at timestamp,
                approved_by integer,
                approved_at timestamp,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_er_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_er_cycle" FOREIGN KEY (cycle_id)
                    REFERENCES review_cycles(id) ON DELETE CASCADE,
                CONSTRAINT "FK_er_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_er_designation" FOREIGN KEY (promoted_to_designation_id)
                    REFERENCES designations(id) ON DELETE SET NULL,
                CONSTRAINT "FK_er_reviewer" FOREIGN KEY (reviewer_user_id)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "UQ_er_cycle" UNIQUE (cycle_id),
                CONSTRAINT "CHK_er_status" CHECK (status IN ('draft', 'submitted', 'approved')),
                CONSTRAINT "CHK_er_outcome" CHECK (outcome IS NULL OR outcome IN (
                    'promoted', 'no_promotion', 'increment_only', 'pip', 'terminate'
                )),
                -- A promotion must say what to. Approving one without a target
                -- designation would have nothing to write to the assignment.
                CONSTRAINT "CHK_er_promotion_target" CHECK (
                    outcome <> 'promoted' OR promoted_to_designation_id IS NOT NULL
                )
            )
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS training_programs (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                name character varying(160) NOT NULL,
                code character varying(48) NOT NULL,
                category character varying(48),
                level integer NOT NULL DEFAULT 1,
                duration_hours numeric(6,2) NOT NULL DEFAULT 0,
                validity_months integer,
                is_mandatory boolean NOT NULL DEFAULT false,
                prerequisite_program_ids jsonb NOT NULL DEFAULT '[]',
                material_urls jsonb NOT NULL DEFAULT '[]',
                is_active boolean NOT NULL DEFAULT true,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_tp_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "UQ_tp_tenant_code" UNIQUE (tenant_id, code)
            )
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS employee_trainings (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                employee_id integer NOT NULL,
                program_id integer NOT NULL,
                status character varying(16) NOT NULL DEFAULT 'assigned',
                assigned_on date,
                started_on date,
                completed_on date,
                expires_on date,
                score numeric(6,2),
                certificate_url text,
                verified_by integer,
                note text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_et_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_et_employee" FOREIGN KEY (employee_id)
                    REFERENCES employees(id) ON DELETE CASCADE,
                CONSTRAINT "FK_et_program" FOREIGN KEY (program_id)
                    REFERENCES training_programs(id) ON DELETE CASCADE,
                CONSTRAINT "FK_et_verifier" FOREIGN KEY (verified_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "UQ_et_employee_program" UNIQUE (employee_id, program_id),
                CONSTRAINT "CHK_et_status" CHECK (status IN (
                    'assigned', 'in_progress', 'completed', 'failed', 'expired'
                )),
                -- A completion needs a date; without one the expiry cannot be
                -- computed and the record silently never lapses.
                CONSTRAINT "CHK_et_completed_on" CHECK (
                    status <> 'completed' OR completed_on IS NOT NULL
                )
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_et_expiry"
             ON employee_trainings (tenant_id, expires_on)
             WHERE expires_on IS NOT NULL AND status = 'completed'`,
        );

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS designation_training_requirements (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                designation_id integer NOT NULL,
                program_id integer NOT NULL,
                required_for character varying(24) NOT NULL DEFAULT 'promotion_into',
                min_score numeric(6,2),
                created_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_dtr_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_dtr_designation" FOREIGN KEY (designation_id)
                    REFERENCES designations(id) ON DELETE CASCADE,
                CONSTRAINT "FK_dtr_program" FOREIGN KEY (program_id)
                    REFERENCES training_programs(id) ON DELETE CASCADE,
                CONSTRAINT "UQ_dtr_unique" UNIQUE (designation_id, program_id, required_for),
                CONSTRAINT "CHK_dtr_required_for" CHECK (required_for IN (
                    'promotion_into', 'holding_role'
                ))
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
        // Conduct and record, but NOT approve: applying a promotion and a raise
        // is not a branch manager's decision.
        await grant(this.managerRoleSlugs, [
            'reviews:view',
            'reviews:conduct',
            'training:view',
            'training:record',
        ]);

        // --- seed a default quarterly form ----------------------------------
        await queryRunner.query(
            `
            INSERT INTO review_templates (tenant_id, name, applies_to_cycle_types, schema)
            SELECT t.id, 'Standard review', '["probation_3m","quarterly","ad_hoc"]'::jsonb,
                   $1::jsonb
            FROM tenants t
            WHERE NOT EXISTS (
                SELECT 1 FROM review_templates rt WHERE rt.tenant_id = t.id
            )
        `,
            [
                JSON.stringify({
                    sections: [
                        {
                            title: 'Performance',
                            questions: [
                                {
                                    key: 'punctuality',
                                    label: 'Punctuality',
                                    type: 'rating',
                                    max: 5,
                                },
                                {
                                    key: 'quality',
                                    label: 'Quality of work',
                                    type: 'rating',
                                    max: 5,
                                },
                                {
                                    key: 'hygiene',
                                    label: 'Hygiene & safety',
                                    type: 'rating',
                                    max: 5,
                                },
                                {
                                    key: 'teamwork',
                                    label: 'Teamwork',
                                    type: 'rating',
                                    max: 5,
                                },
                                {
                                    key: 'customer',
                                    label: 'Customer handling',
                                    type: 'rating',
                                    max: 5,
                                },
                            ],
                        },
                        {
                            title: 'Comments',
                            questions: [
                                {
                                    key: 'strengths_note',
                                    label: 'What is going well',
                                    type: 'text',
                                },
                                {
                                    key: 'improve_note',
                                    label: 'What needs to improve',
                                    type: 'text',
                                },
                            ],
                        },
                    ],
                }),
            ],
        );
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
            `DROP TABLE IF EXISTS designation_training_requirements`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS employee_trainings`);
        await queryRunner.query(`DROP TABLE IF EXISTS training_programs`);
        await queryRunner.query(`DROP TABLE IF EXISTS employee_reviews`);
        await queryRunner.query(`DROP TABLE IF EXISTS review_cycles`);
        await queryRunner.query(`DROP TABLE IF EXISTS review_templates`);
    }
}
