import { MigrationInterface, QueryRunner } from 'typeorm';

export class RiderBreakSessions1760000000014 implements MigrationInterface {
    name = 'RiderBreakSessions1760000000014';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "rider_break_sessions" (
        "id" SERIAL NOT NULL,
        "rider_user_id" integer NOT NULL,
        "attendance_session_id" integer,
        "branch_id" integer,
        "started_at" TIMESTAMP NOT NULL,
        "ended_at" TIMESTAMP,
        "reason" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_rider_break_sessions" PRIMARY KEY ("id"),
        CONSTRAINT "FK_rider_break_sessions_user" FOREIGN KEY ("rider_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_break_sessions_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
        CONSTRAINT "FK_rider_break_sessions_attendance" FOREIGN KEY ("attendance_session_id") REFERENCES "rider_attendance_sessions"("id") ON DELETE SET NULL ON UPDATE NO ACTION
      )
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_rider_break_sessions_rider_started"
      ON "rider_break_sessions" ("rider_user_id", "started_at" DESC)
    `);
        await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_rider_break_sessions_one_open_per_rider"
      ON "rider_break_sessions" ("rider_user_id")
      WHERE "ended_at" IS NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_rider_break_sessions_one_open_per_rider"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_rider_break_sessions_rider_started"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "rider_break_sessions"`);
    }
}
