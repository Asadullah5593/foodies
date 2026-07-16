import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separate template defaults per print type: is_default stays the customer
 * invoice marker, is_default_kitchen marks the kitchen (KOT) template. A
 * template can be both. Partial unique indexes mirror the customer ones —
 * at most one kitchen default per (tenant, brand) scope. Kitchen printing
 * falls back to the customer default when no kitchen default is set.
 */
export class InvoiceTemplateKitchenDefault1760000000083 implements MigrationInterface {
    name = 'InvoiceTemplateKitchenDefault1760000000083';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE invoice_templates ADD COLUMN IF NOT EXISTS is_default_kitchen boolean NOT NULL DEFAULT false`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_templates_kitchen_default_brand" ON invoice_templates (tenant_id, brand_id) WHERE is_default_kitchen AND brand_id IS NOT NULL`,
        );
        await queryRunner.query(
            `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_templates_kitchen_default_tenant" ON invoice_templates (tenant_id) WHERE is_default_kitchen AND brand_id IS NULL`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_invoice_templates_kitchen_default_tenant"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_invoice_templates_kitchen_default_brand"`,
        );
        await queryRunner.query(
            `ALTER TABLE invoice_templates DROP COLUMN IF EXISTS is_default_kitchen`,
        );
    }
}
