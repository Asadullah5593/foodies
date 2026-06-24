import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dynamic, role-targeted real-time notifications:
 * - `notifications`           — event instances (open → resolved lifecycle)
 * - `notification_recipients` — per-user delivery + read state
 * - `notification_settings`   — admin role-targeting config, scoped tenant/branch/brand
 * Plus the `notifications:manage` permission for the config admin module.
 */
export class Notifications1760000000038 implements MigrationInterface {
    name = 'Notifications1760000000038';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "notifications" (
                "id" SERIAL PRIMARY KEY,
                "tenant_id" integer NOT NULL,
                "branch_id" integer,
                "brand_id" integer,
                "type" varchar NOT NULL,
                "category" varchar NOT NULL,
                "surface" varchar NOT NULL,
                "severity" varchar NOT NULL DEFAULT 'info',
                "resolution_mode" varchar NOT NULL DEFAULT 'shared',
                "title" varchar NOT NULL,
                "body" text,
                "data" jsonb,
                "actions" jsonb,
                "sound_enabled" boolean NOT NULL DEFAULT false,
                "dedupe_key" varchar,
                "status" varchar NOT NULL DEFAULT 'open',
                "resolved_at" timestamp,
                "resolved_by_user_id" integer,
                "resolved_action" varchar,
                "created_at" timestamp NOT NULL DEFAULT now(),
                "updated_at" timestamp NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_notifications_tenant_status"
                ON "notifications" ("tenant_id", "status")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_notifications_type_branch_status"
                ON "notifications" ("type", "branch_id", "status")
        `);
        // Collapse recurring conditions: only one OPEN notification per dedupe key.
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notifications_dedupe_open"
                ON "notifications" ("dedupe_key")
                WHERE "status" = 'open' AND "dedupe_key" IS NOT NULL
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "notification_recipients" (
                "id" SERIAL PRIMARY KEY,
                "notification_id" integer NOT NULL
                    REFERENCES "notifications" ("id") ON DELETE CASCADE,
                "user_id" integer NOT NULL,
                "read_at" timestamp,
                "dismissed_at" timestamp,
                "created_at" timestamp NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notification_recipient"
                ON "notification_recipients" ("notification_id", "user_id")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_notification_recipient_user"
                ON "notification_recipients" ("user_id", "read_at")
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "notification_settings" (
                "id" SERIAL PRIMARY KEY,
                "tenant_id" integer NOT NULL,
                "event_type" varchar NOT NULL,
                "branch_id" integer,
                "brand_id" integer,
                "target_role_ids" jsonb NOT NULL DEFAULT '[]'::jsonb,
                "sound_enabled" boolean NOT NULL DEFAULT true,
                "is_enabled" boolean NOT NULL DEFAULT true,
                "channels" jsonb,
                "created_at" timestamp NOT NULL DEFAULT now(),
                "updated_at" timestamp NOT NULL DEFAULT now()
            )
        `);
        // One row per (tenant, event, scope); NULL branch/brand treated as 0 sentinel.
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_notification_setting_scope"
                ON "notification_settings"
                ("tenant_id", "event_type", COALESCE("branch_id", 0), COALESCE("brand_id", 0))
        `);

        // —— Permission for the config admin module ——
        await queryRunner.query(
            `INSERT INTO permissions (name, resource, action, description)
             VALUES ('notifications:manage', 'notifications', 'manage', 'Configure which roles receive which notifications')
             ON CONFLICT (name) DO NOTHING`,
        );
        // Owner / super_admin always get it.
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug IN ('owner', 'super_admin') AND p.name = 'notifications:manage'
             AND NOT EXISTS (
                 SELECT 1 FROM role_permissions rp
                 WHERE rp.role_id = r.id AND rp.permission_id = p.id
             )`,
        );
        // Any role that already manages business settings (owner-tier admins) also gets it.
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT rp.role_id, np.id
             FROM role_permissions rp
             JOIN permissions bp ON bp.id = rp.permission_id AND bp.name = 'business-settings:access'
             CROSS JOIN permissions np
             WHERE np.name = 'notifications:manage'
             AND NOT EXISTS (
                 SELECT 1 FROM role_permissions x
                 WHERE x.role_id = rp.role_id AND x.permission_id = np.id
             )`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM permissions WHERE name = 'notifications:manage'`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS "notification_recipients"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "notification_settings"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "notifications"`);
    }
}
