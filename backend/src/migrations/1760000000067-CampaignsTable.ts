import { MigrationInterface, QueryRunner } from 'typeorm';

/** Phase 1 — campaigns: the advertising umbrella grouping campaign_items. */
export class CampaignsTable1760000000067 implements MigrationInterface {
  name = 'CampaignsTable1760000000067';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS campaigns (
        id serial PRIMARY KEY,
        tenant_id integer NOT NULL,
        name varchar NOT NULL,
        description text,
        image_url varchar,
        is_active boolean NOT NULL DEFAULT true,
        sort_order integer NOT NULL DEFAULT 0,
        valid_from timestamp,
        valid_until timestamp,
        eligibility_brand_ids text,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_campaigns_tenant" FOREIGN KEY (tenant_id)
          REFERENCES tenants(id) ON DELETE CASCADE
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_campaigns_tenant_active" ON campaigns (tenant_id, is_active)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_campaigns_tenant_active"`);
    await queryRunner.query(`DROP TABLE IF EXISTS campaigns`);
  }
}
