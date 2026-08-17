import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Registered attendance devices, so the station works with NOBODY logged in.
 *
 * Staff have no user accounts, and requiring a manager to stay signed in all day
 * means the first person to walk away leaves an authenticated admin session on a
 * shared screen. A device gets its own token instead — the same class of
 * credential as KIOSK_API_KEY, but per branch and revocable from the admin.
 *
 * Additive: one new table, one nullable column on `attendance_punches`, one new
 * permission.
 *
 * The tradeoff worth recording: a station punch has no `pos_user_id` because no
 * user is signed in. Burst detection therefore groups by STATION, which is why
 * every punch now records the device it came from.
 */
export class AttendanceStations1760000000114 implements MigrationInterface {
    name = 'AttendanceStations1760000000114';

    private readonly permissions = [
        {
            name: 'attendance-stations:manage',
            resource: 'attendance-stations',
            action: 'manage',
            description:
                'Register and revoke attendance station devices, and read their tokens',
        },
    ];

    private readonly adminRoleSlugs = [
        'super_admin',
        'owner',
        'general_manager',
        'hr_manager',
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS attendance_stations (
                id serial PRIMARY KEY,
                tenant_id integer NOT NULL,
                branch_id integer NOT NULL,
                label character varying(120) NOT NULL,
                token character varying(64) NOT NULL,
                is_active boolean NOT NULL DEFAULT true,
                last_seen_at timestamp,
                created_by integer,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_ast_tenant" FOREIGN KEY (tenant_id)
                    REFERENCES tenants(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ast_branch" FOREIGN KEY (branch_id)
                    REFERENCES branches(id) ON DELETE CASCADE,
                CONSTRAINT "FK_ast_creator" FOREIGN KEY (created_by)
                    REFERENCES users(id) ON DELETE SET NULL,
                CONSTRAINT "UQ_ast_token" UNIQUE (token)
            )
        `);
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_ast_branch"
             ON attendance_stations (branch_id) WHERE is_active = true`,
        );

        await queryRunner.query(
            `ALTER TABLE attendance_punches ADD COLUMN IF NOT EXISTS station_id integer`,
        );
        await queryRunner.query(`
            DO $$ BEGIN
                ALTER TABLE attendance_punches ADD CONSTRAINT "FK_ap_station"
                    FOREIGN KEY (station_id)
                    REFERENCES attendance_stations(id) ON DELETE SET NULL;
            EXCEPTION WHEN duplicate_object THEN NULL; END $$;
        `);
        // Burst detection for station punches, which have no pos_user_id.
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_ap_station_time"
             ON attendance_punches (station_id, punched_at DESC) WHERE station_id IS NOT NULL`,
        );

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
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM role_permissions WHERE permission_id IN (
                 SELECT id FROM permissions WHERE name = ANY($1)
             )`,
            [this.permissions.map((p) => p.name)],
        );
        await queryRunner.query(`DELETE FROM permissions WHERE name = ANY($1)`, [
            this.permissions.map((p) => p.name),
        ]);
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_ap_station_time"`);
        await queryRunner.query(
            `ALTER TABLE attendance_punches DROP CONSTRAINT IF EXISTS "FK_ap_station"`,
        );
        await queryRunner.query(
            `ALTER TABLE attendance_punches DROP COLUMN IF EXISTS station_id`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS attendance_stations`);
    }
}
