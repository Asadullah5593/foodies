import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Runtime controls for the activity log (§8 of docs/ACTIVITY_LOG_PLAN.md).
 *
 * One row per tenant (tenant_id NULL = the global default). Kept in its own
 * table rather than on `tenants` because capture has to be resolvable for
 * requests that have no tenant yet — an anonymous 401 is exactly the row we
 * most want, and it arrives before anyone is identified.
 *
 * The env var stays the hard override: an emergency brake must not depend on
 * the database being reachable.
 */
export class ActivityLogSettings1760000000108 implements MigrationInterface {
    name = 'ActivityLogSettings1760000000108';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS activity_log_settings (
                id serial PRIMARY KEY,
                tenant_id integer UNIQUE,
                capture_level character varying(32) NOT NULL DEFAULT 'mutations+sensitive_reads',
                pii_mode character varying(16) NOT NULL DEFAULT 'mask',
                hot_months integer NOT NULL DEFAULT 3,
                retention_months integer NOT NULL DEFAULT 13,
                updated_by integer,
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "FK_activity_log_settings_updated_by"
                    FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
            )
        `);
        // The global default row. Capture level here is only consulted when the
        // feature is switched on at all.
        await queryRunner.query(
            `INSERT INTO activity_log_settings (tenant_id) VALUES (NULL)
             ON CONFLICT DO NOTHING`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS activity_log_settings`);
    }
}
