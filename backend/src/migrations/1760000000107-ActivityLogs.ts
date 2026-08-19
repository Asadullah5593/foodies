import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Activity / audit log — Phase 0 (schema only; nothing writes to this table yet).
 *
 * See docs/ACTIVITY_LOG_PLAN.md. The short version:
 *
 * 1. `activity_logs`, RANGE-partitioned monthly on `created_at`. Partitioning is
 *    what makes a year of retention cheap: expiring a month is `DROP TABLE
 *    <partition>` — instant, no vacuum storm — instead of a mass DELETE.
 *
 * 2. Append-only by grant, not by convention: UPDATE and DELETE are REVOKEd from
 *    the app role. Retention still works, because dropping a partition needs
 *    ownership rather than DELETE.
 *
 * 3. Four permissions (view / export / purge / configure), granted to
 *    owner + super_admin only. Purge and configure are deliberately separate
 *    rights: reading the log and being able to destroy or silence it are
 *    different powers.
 *
 * PRODUCTION SAFETY — this migration runs at app boot (`migrationsRun: true`),
 * so a migration that blocks blocks startup:
 *
 * - It only CREATEs new objects. It issues no ALTER against any existing table,
 *   so it cannot queue behind — or block — live traffic.
 * - `lock_timeout` / `statement_timeout` are set for the transaction, so if it
 *   ever does wait on a lock it fails fast and the deploy stops, rather than
 *   stalling every request behind it.
 * - Index creation is on an empty table, so it is instant (no CONCURRENTLY
 *   needed, which TypeORM's transaction wrapper would forbid anyway).
 *
 * Deliberate deviations from house convention, both for retention correctness:
 * `timestamptz` (not bare `timestamp`) so partition boundaries and retention
 * cuts are unambiguous across DST/deploys, and a DEFAULT partition so a row is
 * never lost if the maintenance job ever falls behind. A non-empty default
 * partition is an alarm, not a resting state.
 */
export class ActivityLogs1760000000107 implements MigrationInterface {
    name = 'ActivityLogs1760000000107';

    /** Months of partitions created up front (this month + the next two). */
    private readonly MONTHS_AHEAD = 3;

    private readonly permissions = [
        {
            name: 'activity-log:view',
            resource: 'activity-log',
            action: 'view',
            description:
                'View the activity log (who did what, when, from where) and the before/after changes on a record',
        },
        {
            name: 'activity-log:export',
            resource: 'activity-log',
            action: 'export',
            description:
                'Download activity log entries and archived log files; the download is itself logged',
        },
        {
            name: 'activity-log:purge',
            resource: 'activity-log',
            action: 'purge',
            description:
                'Archive and purge whole past months of the activity log; requires re-entering your password and can never reach the last 90 days',
        },
        {
            name: 'activity-log:configure',
            resource: 'activity-log',
            action: 'configure',
            description:
                'Change what the activity log captures and how long it is kept; every change is itself logged before it takes effect',
        },
    ];

    /** `activity_logs_2026_01` — the name the maintenance service also derives. */
    private partitionName(year: number, month: number): string {
        return `activity_logs_${year}_${String(month).padStart(2, '0')}`;
    }

    /** First day of a month as `YYYY-MM-DD`, normalising month overflow. */
    private monthStart(year: number, month: number): string {
        const y = year + Math.floor((month - 1) / 12);
        const m = ((month - 1) % 12) + 1;
        return `${y}-${String(m).padStart(2, '0')}-01`;
    }

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Fail fast instead of queueing traffic behind a lock wait. Scoped to
        // this transaction, so nothing leaks into the app's session.
        await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
        await queryRunner.query(`SET LOCAL statement_timeout = '60s'`);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS activity_logs (
                id bigserial NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now(),

                -- correlation: ties an action to the request and the device it came from
                request_id uuid,
                session_id character varying(64),
                device_id character varying(64),

                -- actor: WHO, and what they could do AT THE TIME (roles are edited,
                -- so resolving them at read time would answer the wrong question)
                actor_type character varying(16) NOT NULL DEFAULT 'system',
                actor_user_id integer,
                actor_customer_id integer,
                actor_label character varying(160),
                actor_role_slugs text[],
                actor_role_names text[],
                actor_is_super_admin boolean NOT NULL DEFAULT false,

                -- scope: taken from the SUBJECT of the action, never from the
                -- actor's own access scope
                tenant_id integer,
                branch_id integer,
                brand_id integer,

                -- what happened
                action character varying(96) NOT NULL,
                action_group character varying(48),
                entity_type character varying(64),
                entity_id character varying(64),
                entity_label character varying(200),
                summary character varying(400),

                -- how it arrived
                http_method character varying(10),
                route character varying(300),
                query jsonb,
                request_body jsonb,
                response_meta jsonb,
                status_code integer,
                outcome character varying(16) NOT NULL DEFAULT 'success',
                duration_ms integer,

                -- what changed
                changes jsonb,
                changed_fields text[],

                -- forensics
                ip character varying(64),
                user_agent character varying(400),
                payload_truncated boolean NOT NULL DEFAULT false,
                diff_expected boolean NOT NULL DEFAULT false,

                CONSTRAINT "PK_activity_logs" PRIMARY KEY (created_at, id)
            ) PARTITION BY RANGE (created_at)
        `);

        // Deleting a user must never destroy the trail, so the actor FKs null out
        // rather than cascade. Same choice as shift_cash_outs.
        await queryRunner.query(`
            ALTER TABLE activity_logs
                ADD CONSTRAINT "FK_activity_logs_actor_user"
                FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
        `);

        // Indexes on the parent are inherited by every partition, existing and
        // future — one definition, no per-partition maintenance.
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_activity_logs_tenant_created"
             ON activity_logs (tenant_id, created_at DESC)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_activity_logs_actor_created"
             ON activity_logs (actor_user_id, created_at DESC)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_activity_logs_entity_created"
             ON activity_logs (entity_type, entity_id, created_at DESC)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_activity_logs_action_created"
             ON activity_logs (tenant_id, action, created_at DESC)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_activity_logs_request"
             ON activity_logs (request_id)`,
        );

        const now = new Date();
        for (let i = 0; i < this.MONTHS_AHEAD; i++) {
            const year = now.getUTCFullYear();
            const month = now.getUTCMonth() + 1 + i;
            const name = this.partitionName(
                year + Math.floor((month - 1) / 12),
                ((month - 1) % 12) + 1,
            );
            await queryRunner.query(`
                CREATE TABLE IF NOT EXISTS ${name}
                PARTITION OF activity_logs
                FOR VALUES FROM ('${this.monthStart(year, month)}')
                             TO ('${this.monthStart(year, month + 1)}')
            `);
        }

        // Safety net: a row can never be rejected because the maintenance job
        // fell behind. The job keeps 2 months ahead, so this stays empty.
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS activity_logs_default
            PARTITION OF activity_logs DEFAULT
        `);

        // — Append-only —
        //
        // The REVOKE below is NOT sufficient on its own, and this was verified
        // rather than assumed: the app user OWNS this table, and Postgres gives
        // owners their privileges implicitly, so revoking UPDATE/DELETE from the
        // owner changes information_schema but not behaviour. Tested on 14.23:
        // after the REVOKE, UPDATE, DELETE and TRUNCATE all still succeeded.
        //
        // The trigger is what actually bites. It fires for the owner too, and
        // (PG 13+) a row trigger on a partitioned parent cascades to every
        // partition, present and future. DDL is unaffected, so retention can
        // still DROP a partition and down() can still drop the table.
        //
        // A determined table owner can drop the trigger — that is unavoidable
        // with a single DB role, and is precisely why real tamper-evidence comes
        // from the write-once S3 archive in Phase 6, not from in-database
        // guarantees. What this stops is every accidental and casual path: an
        // ORM save(), a stray script, a careless UPDATE in psql.
        await queryRunner.query(`
            CREATE OR REPLACE FUNCTION activity_logs_append_only()
            RETURNS trigger AS $$
            BEGIN
                RAISE EXCEPTION
                    'activity_logs is append-only: % is not permitted. Expire history by dropping a monthly partition.',
                    TG_OP
                    USING ERRCODE = 'insufficient_privilege';
            END;
            $$ LANGUAGE plpgsql;
        `);
        await queryRunner.query(`
            CREATE TRIGGER activity_logs_no_update_delete
            BEFORE UPDATE OR DELETE ON activity_logs
            FOR EACH ROW EXECUTE FUNCTION activity_logs_append_only()
        `);
        await queryRunner.query(`
            CREATE TRIGGER activity_logs_no_truncate
            BEFORE TRUNCATE ON activity_logs
            FOR EACH STATEMENT EXECUTE FUNCTION activity_logs_append_only()
        `);

        // Belt and braces: effective the moment the table is owned by a role
        // other than the app's, which is the right end state on RDS.
        await queryRunner.query(`
            DO $$
            BEGIN
                EXECUTE format(
                    'REVOKE UPDATE, DELETE, TRUNCATE ON activity_logs FROM %I',
                    current_user
                );
            EXCEPTION WHEN OTHERS THEN
                RAISE NOTICE 'activity_logs: could not REVOKE UPDATE/DELETE/TRUNCATE (%). The trigger still applies.', SQLERRM;
            END $$;
        `);

        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
            // Owner / super admin only to start. Widen from the Roles UI.
            // Live-DB slugs differ from seed slugs in places, so match both spellings.
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT r.id, p.id FROM roles r
                 CROSS JOIN permissions p
                 WHERE r.slug IN ('owner', 'super_admin', 'superadmin')
                   AND p.name = $1
                   AND NOT EXISTS (
                       SELECT 1 FROM role_permissions rp
                       WHERE rp.role_id = r.id AND rp.permission_id = p.id
                   )`,
                [p.name],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Dropping the parent takes every partition and both triggers with it.
        // Nothing else in the database was touched by up(), so a rollback cannot
        // affect live data.
        await queryRunner.query(`DROP TABLE IF EXISTS activity_logs CASCADE`);
        await queryRunner.query(
            `DROP FUNCTION IF EXISTS activity_logs_append_only()`,
        );
        for (const p of this.permissions) {
            await queryRunner.query(`DELETE FROM permissions WHERE name = $1`, [
                p.name,
            ]);
        }
    }
}
