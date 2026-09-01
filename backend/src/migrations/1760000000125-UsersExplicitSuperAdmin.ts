import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Super admin was inferred from ABSENCE: a user with no tenant_users row was
 * treated as the platform owner, in three places (findById, RoleAccessGuard,
 * RequirePermissionGuard). Deleting a user removes their tenant row first and
 * the users row last, so a delete that failed part way through did not remove
 * access — it PROMOTED the account to unrestricted, still logging in on its old
 * password. Four accounts reached production that way.
 *
 * Being a super admin is now something a row says, not something it fails to
 * say. The column defaults to false, so the fallout of any future half-finished
 * delete is an account that can reach nothing.
 *
 * Backfill keeps today's behaviour for accounts that can actually sign in:
 * orphaned AND active. An orphan that is already deactivated stays powerless —
 * which is exactly the four, so they cannot come back by being re-enabled.
 */
export class UsersExplicitSuperAdmin1760000000125 implements MigrationInterface {
    name = 'UsersExplicitSuperAdmin1760000000125';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "is_super_admin" boolean NOT NULL DEFAULT false`,
        );
        await queryRunner.query(
            `UPDATE "users" u
             SET "is_super_admin" = true
             WHERE u."status" = 'active'
               AND NOT EXISTS (
                   SELECT 1 FROM "tenant_users" tu WHERE tu."user_id" = u."id"
               )`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "users" DROP COLUMN IF EXISTS "is_super_admin"`,
        );
    }
}
