import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Deleting ANY user failed, and failed destructively.
 *
 * activity_logs.actor_user_id carried ON DELETE SET NULL, but the table has an
 * append-only trigger that refuses UPDATE. So the cascade Postgres runs to null
 * the column was rejected, and the whole DELETE errored — for every user who
 * had ever done anything, which is every user. The admin saw an error; what
 * they did not see is that the tenant link had already been removed by an
 * earlier statement, leaving an account attached to no business. That is what
 * the system used to read as the platform administrator.
 *
 * The foreign key was never needed: the log snapshots actorLabel (name/email at
 * write time) precisely so a renamed or deleted user still reads, and nothing
 * joins back to users. Dropping it lets actor_user_id be what an audit trail
 * wants — the id as it was, whether or not that user still exists.
 */
export class ActivityLogActorNoFk1760000000126 implements MigrationInterface {
    name = 'ActivityLogActorNoFk1760000000126';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "activity_logs" DROP CONSTRAINT IF EXISTS "FK_activity_logs_actor_user"`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Restoring it re-breaks user deletion, so only ever as part of a full
        // rollback. Rows pointing at a since-deleted user are cleared first, or
        // the constraint cannot be added back.
        await queryRunner.query(
            `UPDATE "activity_logs" SET "actor_user_id" = NULL
             WHERE "actor_user_id" IS NOT NULL
               AND NOT EXISTS (SELECT 1 FROM "users" u WHERE u."id" = "actor_user_id")`,
        );
        await queryRunner.query(
            `ALTER TABLE "activity_logs"
             ADD CONSTRAINT "FK_activity_logs_actor_user"
             FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL`,
        );
    }
}
