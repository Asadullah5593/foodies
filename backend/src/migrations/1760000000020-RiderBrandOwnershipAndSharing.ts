import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Rider brand-ownership & sharing.
 *
 * - rider_brands: which brands a rider serves (source 'owned' | 'shared');
 *   single source of truth for ownership/availability. "Pool rider" = no row.
 * - rider_share_requests: a brand admin requests a pool rider; owner/GM
 *   approves (creating a 'shared' link) or declines. Partial-unique pending.
 * - rider_dispatch_states gains brand_id so round-robin is per (tenant, branch,
 *   brand) — two brands sharing riders at one branch keep separate rotations.
 * - Two new permissions: rider-share:request (brand admin), rider-sharing:manage
 *   (owner/GM/super admin).
 *
 * CLEAN SLATE: no backfill. After this runs, every rider has zero brand links,
 * so delivery auto-dispatch returns nobody until an admin links riders to
 * brands. (Deploy gate — link riders before going live.)
 */
export class RiderBrandOwnershipAndSharing1760000000020 implements MigrationInterface {
    name = 'RiderBrandOwnershipAndSharing1760000000020';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // —— rider_brands ——
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "rider_brands" (
                "rider_user_id" integer NOT NULL,
                "brand_id" integer NOT NULL,
                "tenant_id" integer NOT NULL,
                "source" varchar(16) NOT NULL DEFAULT 'shared',
                "created_by" integer,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_rider_brands" PRIMARY KEY ("rider_user_id", "brand_id"),
                CONSTRAINT "FK_rider_brands_rider" FOREIGN KEY ("rider_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_rider_brands_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_rider_brands_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_rider_brands_brand_rider"
            ON "rider_brands" ("brand_id", "rider_user_id")
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_rider_brands_tenant_rider"
            ON "rider_brands" ("tenant_id", "rider_user_id")
        `);

        // —— rider_share_requests ——
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "rider_share_requests" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "requesting_brand_id" integer NOT NULL,
                "rider_user_id" integer NOT NULL,
                "status" varchar(16) NOT NULL DEFAULT 'pending',
                "note" text,
                "requested_by" integer,
                "reviewed_by" integer,
                "reviewed_at" TIMESTAMP,
                "review_note" text,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_rider_share_requests" PRIMARY KEY ("id"),
                CONSTRAINT "FK_rider_share_requests_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_rider_share_requests_brand" FOREIGN KEY ("requesting_brand_id") REFERENCES "brands"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
                CONSTRAINT "FK_rider_share_requests_rider" FOREIGN KEY ("rider_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_rider_share_requests_tenant_status"
            ON "rider_share_requests" ("tenant_id", "status")
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rider_share_requests_pending"
            ON "rider_share_requests" ("requesting_brand_id", "rider_user_id")
            WHERE "status" = 'pending'
        `);

        // —— rider_dispatch_states: per-brand round-robin ——
        await queryRunner.query(`
            ALTER TABLE "rider_dispatch_states"
            ADD COLUMN IF NOT EXISTS "brand_id" integer NULL
        `);
        // ADD CONSTRAINT has no IF NOT EXISTS; the migrations table prevents re-runs.
        await queryRunner.query(`
            ALTER TABLE "rider_dispatch_states"
            ADD CONSTRAINT "FK_rider_dispatch_states_brand"
            FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
        `);
        // Replace the (tenant, branch) unique with brand-aware uniqueness.
        await queryRunner.query(`
            ALTER TABLE "rider_dispatch_states"
            DROP CONSTRAINT IF EXISTS "UQ_rider_dispatch_state_scope"
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rider_dispatch_state_brand_scope"
            ON "rider_dispatch_states" ("tenant_id", "branch_id", "brand_id")
            WHERE "brand_id" IS NOT NULL
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rider_dispatch_state_null_brand_scope"
            ON "rider_dispatch_states" ("tenant_id", "branch_id")
            WHERE "brand_id" IS NULL
        `);

        // —— permissions ——
        const permissions = [
            {
                name: 'rider-share:request',
                resource: 'rider-share',
                action: 'request',
                description: 'Request a Foodies-pool rider for your brand',
            },
            {
                name: 'rider-sharing:manage',
                resource: 'rider-sharing',
                action: 'manage',
                description:
                    'Manage the rider pool: link riders to brands and approve share requests',
            },
        ];
        for (const p of permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
        }
        // Owner / GM / super admin can manage the pool and approve.
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug IN ('owner', 'super_admin', 'general_manager')
               AND p.name = 'rider-sharing:manage'
               AND NOT EXISTS (
                 SELECT 1 FROM role_permissions rp
                 WHERE rp.role_id = r.id AND rp.permission_id = p.id
               )`,
        );
        // Brand admins (and owner/super admin) can submit/view requests.
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug IN ('brand_admin', 'owner', 'super_admin')
               AND p.name = 'rider-share:request'
               AND NOT EXISTS (
                 SELECT 1 FROM role_permissions rp
                 WHERE rp.role_id = r.id AND rp.permission_id = p.id
               )`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM role_permissions WHERE permission_id IN (SELECT id FROM permissions WHERE name IN ('rider-share:request', 'rider-sharing:manage'))`,
        );
        await queryRunner.query(
            `DELETE FROM permissions WHERE name IN ('rider-share:request', 'rider-sharing:manage')`,
        );

        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_rider_dispatch_state_null_brand_scope"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_rider_dispatch_state_brand_scope"`,
        );
        await queryRunner.query(
            `ALTER TABLE "rider_dispatch_states" DROP CONSTRAINT IF EXISTS "FK_rider_dispatch_states_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE "rider_dispatch_states" DROP COLUMN IF EXISTS "brand_id"`,
        );
        await queryRunner.query(
            `ALTER TABLE "rider_dispatch_states" ADD CONSTRAINT "UQ_rider_dispatch_state_scope" UNIQUE ("tenant_id", "branch_id")`,
        );

        await queryRunner.query(`DROP TABLE IF EXISTS "rider_share_requests"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "rider_brands"`);
    }
}
