import { MigrationInterface, QueryRunner } from 'typeorm';

export class CmsBannersTable1760000000023 implements MigrationInterface {
    name = 'CmsBannersTable1760000000023';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "banners" (
                "id"          SERIAL PRIMARY KEY,
                "tenant_id"   integer NOT NULL,
                "title"       character varying NOT NULL,
                "subtitle"    character varying NULL,
                "image_url"   character varying NOT NULL,
                "link_url"    character varying NULL,
                "is_active"   boolean NOT NULL DEFAULT true,
                "sort_order"  integer NOT NULL DEFAULT 0,
                "valid_from"  timestamp NULL,
                "valid_until" timestamp NULL,
                "created_at"  timestamp NOT NULL DEFAULT now(),
                "updated_at"  timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_banners_tenant" FOREIGN KEY ("tenant_id")
                    REFERENCES "tenants"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_banners_tenant_active"
            ON "banners" ("tenant_id", "is_active")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_banners_tenant_active"`);
        await queryRunner.query(`DROP TABLE IF EXISTS "banners"`);
    }
}
