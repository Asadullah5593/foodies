import { MigrationInterface, QueryRunner } from 'typeorm';

export class PromotionsAndCustomerPromotions1760000000024 implements MigrationInterface {
    name = 'PromotionsAndCustomerPromotions1760000000024';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "promotions" (
                "id"               SERIAL PRIMARY KEY,
                "tenant_id"        integer NOT NULL,
                "name"             character varying NOT NULL,
                "description"      text NULL,
                "image_url"        character varying NULL,
                "promotion_type"   character varying NOT NULL,
                "discount_type"    character varying NULL,
                "discount_value"   numeric(10,2) NULL,
                "free_menu_item_id" integer NULL,
                "eligibility_type" character varying NOT NULL DEFAULT 'new_customer',
                "is_active"        boolean NOT NULL DEFAULT true,
                "expires_in_days"  integer NULL,
                "valid_from"       timestamp NULL,
                "valid_until"      timestamp NULL,
                "created_at"       timestamp NOT NULL DEFAULT now(),
                "updated_at"       timestamp NOT NULL DEFAULT now(),
                CONSTRAINT "FK_promotions_tenant" FOREIGN KEY ("tenant_id")
                    REFERENCES "tenants"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_promotions_tenant_active"
            ON "promotions" ("tenant_id", "is_active")
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_promotions_eligibility"
            ON "promotions" ("tenant_id", "eligibility_type", "is_active")
        `);

        await queryRunner.query(`
            CREATE TABLE "customer_promotions" (
                "id"           SERIAL PRIMARY KEY,
                "customer_id"  integer NOT NULL,
                "promotion_id" integer NOT NULL,
                "coupon_code"  character varying NULL,
                "discount_id"  integer NULL,
                "status"       character varying NOT NULL DEFAULT 'pending',
                "assigned_at"  timestamp NOT NULL DEFAULT now(),
                "expires_at"   timestamp NULL,
                "claimed_at"   timestamp NULL,
                "used_at"      timestamp NULL,
                CONSTRAINT "FK_customer_promotions_customer" FOREIGN KEY ("customer_id")
                    REFERENCES "customers"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_customer_promotions_promotion" FOREIGN KEY ("promotion_id")
                    REFERENCES "promotions"("id") ON DELETE CASCADE,
                CONSTRAINT "UQ_customer_promotions_customer_promotion"
                    UNIQUE ("customer_id", "promotion_id")
            )
        `);
        await queryRunner.query(`
            CREATE INDEX "IDX_customer_promotions_customer_status"
            ON "customer_promotions" ("customer_id", "status")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_customer_promotions_customer_status"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "customer_promotions"`);
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_promotions_eligibility"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_promotions_tenant_active"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "promotions"`);
    }
}
