import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Race-condition backstop: at most one non-reversed payroll run per
 * (tenant, branch, period). `runPayroll` had no dedup, so a slow run plus a
 * retry/double-click created two finalized runs and paid every rider twice.
 * A re-run after reversing the prior run is still allowed (reversed runs excluded).
 */
export class PayrollRunUniqueScope1760000000062 implements MigrationInterface {
    name = 'PayrollRunUniqueScope1760000000062';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_payroll_run_scope_active"
            ON rider_payroll_runs (tenant_id, COALESCE(branch_id, 0), period_from, period_to)
            WHERE status <> 'reversed'
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_payroll_run_scope_active"`,
        );
    }
}
