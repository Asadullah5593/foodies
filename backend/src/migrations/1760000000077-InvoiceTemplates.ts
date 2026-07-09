import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Selectable invoice schemas: tenant-owned records with an optional per-brand
 * override, a layout skeleton + a JSON config of field toggles. A partial unique
 * index enforces at most one default per (tenant, brand) scope. Boot-run.
 */
export class InvoiceTemplates1760000000077 implements MigrationInterface {
  name = 'InvoiceTemplates1760000000077';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS invoice_templates (
        id SERIAL PRIMARY KEY,
        tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        brand_id integer,
        name varchar NOT NULL,
        layout varchar NOT NULL DEFAULT 'thermal_80mm',
        is_active boolean NOT NULL DEFAULT true,
        is_default boolean NOT NULL DEFAULT false,
        config text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now()
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_invoice_templates_tenant_brand" ON invoice_templates (tenant_id, brand_id)`,
    );
    // At most one default per scope. Two partial indexes because a NULL brand_id
    // is not equal to itself in a normal UNIQUE across rows.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_templates_default_brand" ON invoice_templates (tenant_id, brand_id) WHERE is_default AND brand_id IS NOT NULL`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_invoice_templates_default_tenant" ON invoice_templates (tenant_id) WHERE is_default AND brand_id IS NULL`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_invoice_templates_default_tenant"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_invoice_templates_default_brand"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_invoice_templates_tenant_brand"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS invoice_templates`);
  }
}
