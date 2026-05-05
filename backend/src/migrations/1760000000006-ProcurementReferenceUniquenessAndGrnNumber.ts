import { MigrationInterface, QueryRunner } from 'typeorm';

export class ProcurementReferenceUniquenessAndGrnNumber1760000000006 implements MigrationInterface {
    name = 'ProcurementReferenceUniquenessAndGrnNumber1760000000006';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE goods_receipt_notes
            ADD COLUMN IF NOT EXISTS grn_number character varying
        `);

        await queryRunner.query(`
            UPDATE goods_receipt_notes
            SET grn_number = 'GRN-' || tenant_id::text || '-' || LPAD(id::text, 6, '0')
            WHERE grn_number IS NULL
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS UQ_grn_tenant_grn_number
            ON goods_receipt_notes (tenant_id, grn_number)
            WHERE grn_number IS NOT NULL
        `);

        await queryRunner.query(`
            ALTER TABLE purchase_orders
            DROP CONSTRAINT IF EXISTS UQ_purchase_orders_po_number
        `);
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS UQ_po_tenant_po_number
            ON purchase_orders (tenant_id, po_number)
            WHERE po_number IS NOT NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS UQ_po_tenant_po_number`);
        await queryRunner.query(`
            ALTER TABLE purchase_orders
            ADD CONSTRAINT UQ_purchase_orders_po_number UNIQUE (po_number)
        `);

        await queryRunner.query(
            `DROP INDEX IF EXISTS UQ_grn_tenant_grn_number`,
        );
        await queryRunner.query(`
            ALTER TABLE goods_receipt_notes
            DROP COLUMN IF EXISTS grn_number
        `);
    }
}
