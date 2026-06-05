import { MigrationInterface, QueryRunner } from 'typeorm';

export class ShiftClosedBy1760000000016 implements MigrationInterface {
    name = 'ShiftClosedBy1760000000016';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "shifts"
      ADD COLUMN IF NOT EXISTS "closed_by_user_id" integer NULL
    `);
        await queryRunner.query(`
      DO $$ BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'FK_shifts_closed_by_user'
        ) THEN
          ALTER TABLE "shifts"
          ADD CONSTRAINT "FK_shifts_closed_by_user"
          FOREIGN KEY ("closed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL;
        END IF;
      END $$;
    `);
        await queryRunner.query(`
      COMMENT ON COLUMN "shifts"."closed_by_user_id" IS
      'User who closed the shift (set from the authenticated user on close).'
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "shifts" DROP CONSTRAINT IF EXISTS "FK_shifts_closed_by_user"
    `);
        await queryRunner.query(`
      ALTER TABLE "shifts" DROP COLUMN IF EXISTS "closed_by_user_id"
    `);
    }
}
