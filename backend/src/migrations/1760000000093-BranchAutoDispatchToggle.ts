import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-branch off switch for automatic rider assignment.
 *
 * Until now auto-dispatch fired unconditionally from four entry points (KDS
 * moving to Preparing, the admin status change, the every-minute sweep, and the
 * admin retry button) with no way to stop it — the "Auto-assign on" pill in the
 * admin UI was a hardcoded label, not a control.
 *
 * Defaults to true so behaviour is unchanged on deploy. When false, delivery
 * orders for that branch are simply left unassigned for an admin to hand out;
 * manual assignment is unaffected.
 */
export class BranchAutoDispatchToggle1760000000093 implements MigrationInterface {
    name = 'BranchAutoDispatchToggle1760000000093';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "branches"
             ADD COLUMN IF NOT EXISTS "auto_dispatch_enabled" boolean NOT NULL DEFAULT true`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "branches" DROP COLUMN IF EXISTS "auto_dispatch_enabled"`,
        );
    }
}
