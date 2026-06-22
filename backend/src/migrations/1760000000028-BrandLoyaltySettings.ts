import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Move loyalty configuration from tenant level to brand level. Each brand seeds
 * its initial program from its tenant's existing loyalty config; from here on the
 * brand columns are authoritative and the tenant columns become unused.
 */
export class BrandLoyaltySettings1760000000028 implements MigrationInterface {
    name = 'BrandLoyaltySettings1760000000028';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "brands"
                ADD COLUMN IF NOT EXISTS "loyalty_enabled" boolean NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS "loyalty_settings" text
        `);
        // Seed each brand from its tenant's current loyalty config.
        await queryRunner.query(`
            UPDATE "brands" b
            SET "loyalty_enabled" = t."loyalty_enabled",
                "loyalty_settings" = t."loyalty_settings"
            FROM "tenants" t
            WHERE b."tenant_id" = t."id"
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "brands"
                DROP COLUMN IF EXISTS "loyalty_enabled",
                DROP COLUMN IF EXISTS "loyalty_settings"
        `);
    }
}
