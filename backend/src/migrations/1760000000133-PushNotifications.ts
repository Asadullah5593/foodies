import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Push notifications sent from the admin panel (promos, announcements,
 * repeating automations) to the customer app.
 *
 * The app saves each phone's FCM token in Firestore at
 * `users/{customerId}/tokens/{token}` and can never change (no new builds), so
 * everything here works around that contract:
 *
 * 1. `push_devices` — our copy of those Firestore token docs, refreshed by a
 *    job. It lets the audience builder count reachable customers in SQL, and
 *    tells a phone's current owner apart when the same token sits under two
 *    accounts (newest `last_updated` wins). Riders share the Firestore path
 *    (`users/{staffUserId}`), so customer ids equal to a rider's user id are
 *    never sent to.
 *
 * 2. `push_settings` — one row per tenant: time zone, quiet hours, the
 *    per-customer cap (per 24 h / per 7 days), default expiry, whether an order
 *    in progress excludes a customer by default, and the test phones.
 *
 * 3. `push_messages` — what to send (title, body, optional image), to whom
 *    (`audience` rules or a saved `push_audiences` row) and when: now, once at
 *    `send_at`, or a `repeat` rule (daily / chosen weekdays / monthly / every N
 *    days, with an end). `next_run_at` is the queue: the minute job claims a
 *    due row atomically by moving it on. `per_customer` limits how often one
 *    customer can get a repeating message (every time / once ever / once every
 *    N days). `variant_b` + `ab_split` and `holdout_percent` are the A/B test
 *    and the hold-back group. `scope` keeps the author's brand / branch reach
 *    (brand-locked or branch-limited staff), because a repeating message is
 *    sent by the job long after the request that created it.
 *
 * 4. `push_message_runs` — one row per actual send, with its counts. Unique on
 *    (message, scheduled_for) so a send can never be claimed twice.
 *
 * 5. `push_message_recipients` — one row per customer per send, written before
 *    sending and marked after each batch, so a restart resumes without sending
 *    anyone a second copy. It also drives the caps, "once ever", the per-
 *    customer history, and the orders-after-sending results.
 *
 * 6. `push_audiences` / `push_templates` — saved audiences and messages.
 *
 * 7. `customers.push_opt_out` — staff can stop promos for a customer who asks.
 *    It never affects the automatic order-status notifications.
 *
 * 8. `push-notifications:view|send|settings`, granted to the Owner role only;
 *    every other role gets them from the Roles page.
 */
export class PushNotifications1760000000133 implements MigrationInterface {
    name = 'PushNotifications1760000000133';

    private readonly permissions = [
        {
            name: 'push-notifications:view',
            action: 'view',
            description:
                'View push notifications, their results, saved audiences and templates',
        },
        {
            name: 'push-notifications:send',
            action: 'send',
            description:
                'Create, schedule, test, edit, pause and cancel push notifications to app customers',
        },
        {
            name: 'push-notifications:settings',
            action: 'settings',
            description:
                'Change push notification settings: quiet hours, per-customer caps, expiry, test phones',
        },
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- 1. our copy of the app's Firestore token docs -------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS push_devices (
                doc_path character varying PRIMARY KEY,
                owner_ref character varying NOT NULL,
                owner_id integer,
                token text NOT NULL,
                platform character varying(16),
                last_updated timestamptz,
                synced_at timestamptz NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_push_devices_owner" ON push_devices (owner_id)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_push_devices_token" ON push_devices (token)`,
        );

        // --- 2. per-tenant settings ------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS push_settings (
                tenant_id integer PRIMARY KEY,
                timezone character varying NOT NULL DEFAULT 'Asia/Karachi',
                quiet_hours_enabled boolean NOT NULL DEFAULT true,
                quiet_start character varying(5) NOT NULL DEFAULT '01:00',
                quiet_end character varying(5) NOT NULL DEFAULT '10:00',
                cap_per_day integer DEFAULT 1,
                cap_per_week integer DEFAULT 3,
                default_expiry_hours integer NOT NULL DEFAULT 12,
                skip_order_in_progress boolean NOT NULL DEFAULT true,
                test_phones jsonb NOT NULL DEFAULT '[]'::jsonb,
                updated_by integer,
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "FK_push_settings_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_push_settings_updated_by" FOREIGN KEY (updated_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_push_settings_caps" CHECK (
                    (cap_per_day IS NULL OR cap_per_day > 0)
                    AND (cap_per_week IS NULL OR cap_per_week > 0)
                ),
                CONSTRAINT "CHK_push_settings_expiry" CHECK (
                    default_expiry_hours BETWEEN 1 AND 672
                )
            )
        `);

        // --- 6. saved audiences and templates (referenced by messages) -------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS push_audiences (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                brand_id integer,
                name character varying NOT NULL,
                description text,
                rules jsonb NOT NULL,
                created_by integer,
                updated_by integer,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "FK_push_audiences_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_push_audiences_brand" FOREIGN KEY (brand_id)
                    REFERENCES brands(id) ON DELETE CASCADE,
                CONSTRAINT "FK_push_audiences_created_by" FOREIGN KEY (created_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "FK_push_audiences_updated_by" FOREIGN KEY (updated_by)
                    REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_push_audiences_tenant" ON push_audiences (tenant_id)`,
        );
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS push_templates (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                brand_id integer,
                name character varying NOT NULL,
                title character varying(120) NOT NULL,
                body text NOT NULL,
                image_url text,
                created_by integer,
                updated_by integer,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "FK_push_templates_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_push_templates_brand" FOREIGN KEY (brand_id)
                    REFERENCES brands(id) ON DELETE CASCADE,
                CONSTRAINT "FK_push_templates_created_by" FOREIGN KEY (created_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "FK_push_templates_updated_by" FOREIGN KEY (updated_by)
                    REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_push_templates_tenant" ON push_templates (tenant_id)`,
        );

        // --- 3. the messages -------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS push_messages (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                brand_id integer,
                name character varying,
                title character varying(120) NOT NULL,
                body text NOT NULL,
                image_url text,
                expiry_hours integer NOT NULL DEFAULT 12,
                replace_previous boolean NOT NULL DEFAULT false,
                audience jsonb NOT NULL DEFAULT '{"match":"all","include":[],"exclude":[]}'::jsonb,
                audience_id integer,
                scope jsonb NOT NULL DEFAULT '{}'::jsonb,
                skip_order_in_progress boolean NOT NULL DEFAULT true,
                respect_cap boolean NOT NULL DEFAULT true,
                per_customer character varying(8) NOT NULL DEFAULT 'every',
                per_customer_days integer,
                schedule_type character varying(8) NOT NULL,
                send_at timestamptz,
                repeat jsonb,
                timezone character varying NOT NULL DEFAULT 'Asia/Karachi',
                status character varying(12) NOT NULL DEFAULT 'draft',
                next_run_at timestamptz,
                last_run_at timestamptz,
                runs_count integer NOT NULL DEFAULT 0,
                skip_dates jsonb NOT NULL DEFAULT '[]'::jsonb,
                variant_b jsonb,
                ab_split integer,
                holdout_percent integer NOT NULL DEFAULT 0,
                created_by integer,
                updated_by integer,
                cancelled_by integer,
                created_at timestamptz NOT NULL DEFAULT now(),
                updated_at timestamptz NOT NULL DEFAULT now(),
                cancelled_at timestamptz,
                CONSTRAINT "FK_push_messages_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_push_messages_brand" FOREIGN KEY (brand_id)
                    REFERENCES brands(id) ON DELETE SET NULL,
                CONSTRAINT "FK_push_messages_audience" FOREIGN KEY (audience_id)
                    REFERENCES push_audiences(id) ON DELETE SET NULL,
                CONSTRAINT "FK_push_messages_created_by" FOREIGN KEY (created_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "FK_push_messages_updated_by" FOREIGN KEY (updated_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "FK_push_messages_cancelled_by" FOREIGN KEY (cancelled_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "CHK_push_messages_schedule_type" CHECK (
                    schedule_type IN ('now', 'once', 'repeat')
                ),
                CONSTRAINT "CHK_push_messages_status" CHECK (
                    status IN ('draft', 'scheduled', 'active', 'paused', 'sending',
                               'sent', 'completed', 'cancelled', 'failed')
                ),
                CONSTRAINT "CHK_push_messages_per_customer" CHECK (
                    per_customer IN ('every', 'once', 'days')
                    AND (per_customer <> 'days' OR per_customer_days > 0)
                ),
                CONSTRAINT "CHK_push_messages_expiry" CHECK (
                    expiry_hours BETWEEN 1 AND 672
                ),
                CONSTRAINT "CHK_push_messages_ab" CHECK (
                    ab_split IS NULL OR ab_split BETWEEN 1 AND 99
                ),
                CONSTRAINT "CHK_push_messages_holdout" CHECK (
                    holdout_percent BETWEEN 0 AND 50
                )
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_push_messages_tenant_created" ON push_messages (tenant_id, created_at DESC)`,
        );
        // The minute job's queue: only rows with a next send are ever scanned.
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_push_messages_due" ON push_messages (next_run_at) WHERE next_run_at IS NOT NULL`,
        );

        // --- 4. each send ----------------------------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS push_message_runs (
                id serial PRIMARY KEY,
                message_id integer NOT NULL,
                tenant_id integer NOT NULL,
                scheduled_for timestamptz NOT NULL,
                started_at timestamptz,
                finished_at timestamptz,
                heartbeat_at timestamptz,
                status character varying(12) NOT NULL DEFAULT 'sending',
                matched integer NOT NULL DEFAULT 0,
                with_app integer NOT NULL DEFAULT 0,
                recipients integer NOT NULL DEFAULT 0,
                phones integer NOT NULL DEFAULT 0,
                sent integer NOT NULL DEFAULT 0,
                failed integer NOT NULL DEFAULT 0,
                skipped_opt_out integer NOT NULL DEFAULT 0,
                skipped_cap integer NOT NULL DEFAULT 0,
                skipped_in_progress integer NOT NULL DEFAULT 0,
                skipped_repeat integer NOT NULL DEFAULT 0,
                skipped_rider integer NOT NULL DEFAULT 0,
                holdout integer NOT NULL DEFAULT 0,
                note text,
                CONSTRAINT "FK_push_message_runs_message" FOREIGN KEY (message_id)
                    REFERENCES push_messages(id) ON DELETE CASCADE,
                CONSTRAINT "UQ_push_message_runs_slot" UNIQUE (message_id, scheduled_for),
                CONSTRAINT "CHK_push_message_runs_status" CHECK (
                    status IN ('sending', 'sent', 'failed', 'skipped')
                )
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_push_message_runs_tenant_started" ON push_message_runs (tenant_id, started_at DESC)`,
        );

        // --- 5. each customer in each send -----------------------------------
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS push_message_recipients (
                id bigserial PRIMARY KEY,
                run_id integer NOT NULL,
                message_id integer NOT NULL,
                tenant_id integer NOT NULL,
                customer_id integer NOT NULL,
                variant character varying(1),
                status character varying(10) NOT NULL DEFAULT 'pending',
                phones integer NOT NULL DEFAULT 0,
                sent integer NOT NULL DEFAULT 0,
                failed integer NOT NULL DEFAULT 0,
                error character varying,
                sent_at timestamptz,
                CONSTRAINT "FK_push_message_recipients_run" FOREIGN KEY (run_id)
                    REFERENCES push_message_runs(id) ON DELETE CASCADE,
                CONSTRAINT "FK_push_message_recipients_customer" FOREIGN KEY (customer_id)
                    REFERENCES customers(id) ON DELETE CASCADE,
                CONSTRAINT "UQ_push_message_recipients_run_customer" UNIQUE (run_id, customer_id),
                CONSTRAINT "CHK_push_message_recipients_status" CHECK (
                    status IN ('pending', 'sending', 'sent', 'failed', 'unknown', 'holdout', 'cancelled')
                )
            )
        `);
        // Caps and the customer's history read "what did this customer get lately".
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_push_message_recipients_customer" ON push_message_recipients (customer_id, sent_at DESC)`,
        );
        // "Once ever" / "once every N days" read "has this customer had this message".
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_push_message_recipients_message_customer" ON push_message_recipients (message_id, customer_id)`,
        );
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_push_message_recipients_run_status" ON push_message_recipients (run_id, status)`,
        );

        // --- 7. "stop promos" on a customer ----------------------------------
        await queryRunner.query(
            `ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "push_opt_out" boolean NOT NULL DEFAULT false`,
        );
        await queryRunner.query(
            `ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "push_opt_out_at" timestamptz`,
        );
        await queryRunner.query(
            `ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "push_opt_out_by" integer`,
        );
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE "customers" ADD CONSTRAINT "FK_customers_push_opt_out_by"
                    FOREIGN KEY ("push_opt_out_by") REFERENCES users(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);

        // --- 8. permissions, Owner only ---------------------------------------
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, 'push-notifications', $2, $3)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.action, p.description],
            );
        }
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id
             FROM roles r
             JOIN permissions p ON p.name = ANY($1)
             WHERE r.slug = 'owner'
               AND NOT EXISTS (
                   SELECT 1 FROM role_permissions x
                   WHERE x.role_id = r.id AND x.permission_id = p.id
               )`,
            [this.permissions.map((p) => p.name)],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // role_permissions rows go with the permissions (FK cascade).
        await queryRunner.query(
            `DELETE FROM permissions WHERE name = ANY($1)`,
            [this.permissions.map((p) => p.name)],
        );
        await queryRunner.query(
            `ALTER TABLE "customers" DROP CONSTRAINT IF EXISTS "FK_customers_push_opt_out_by"`,
        );
        for (const col of [
            'push_opt_out_by',
            'push_opt_out_at',
            'push_opt_out',
        ]) {
            await queryRunner.query(
                `ALTER TABLE "customers" DROP COLUMN IF EXISTS "${col}"`,
            );
        }
        await queryRunner.query(`DROP TABLE IF EXISTS push_message_recipients`);
        await queryRunner.query(`DROP TABLE IF EXISTS push_message_runs`);
        await queryRunner.query(`DROP TABLE IF EXISTS push_messages`);
        await queryRunner.query(`DROP TABLE IF EXISTS push_templates`);
        await queryRunner.query(`DROP TABLE IF EXISTS push_audiences`);
        await queryRunner.query(`DROP TABLE IF EXISTS push_settings`);
        await queryRunner.query(`DROP TABLE IF EXISTS push_devices`);
    }
}
