import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddPurchaseRequisitionNumber1760000000005 implements MigrationInterface {
    name = 'AddPurchaseRequisitionNumber1760000000005';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE purchase_requisitions
            ADD COLUMN IF NOT EXISTS pr_number character varying
        `);

        await queryRunner.query(`
            UPDATE purchase_requisitions
            SET pr_number = 'PR-' || tenant_id::text || '-' || LPAD(id::text, 6, '0')
            WHERE pr_number IS NULL
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS UQ_pr_tenant_pr_number
            ON purchase_requisitions (tenant_id, pr_number)
            WHERE pr_number IS NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS UQ_pr_tenant_pr_number`);
        await queryRunner.query(`
            ALTER TABLE purchase_requisitions
            DROP COLUMN IF EXISTS pr_number
        `);
    }
}
