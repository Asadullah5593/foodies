import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Dual-wallet loyalty: per-customer wallets split into brand-scoped POS wallets
 * (brand_id set) and a single shared APP wallet (brand_id null).
 * Uniqueness is enforced with partial unique indexes because Postgres treats
 * NULL brand_id values as distinct in a plain composite UNIQUE constraint.
 */
export class LoyaltyWallets1760000000026 implements MigrationInterface {
    name = 'LoyaltyWallets1760000000026';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "loyalty_wallets" (
                "id" SERIAL NOT NULL,
                "tenant_id" integer NOT NULL,
                "customer_id" integer NOT NULL,
                "wallet_type" character varying(8) NOT NULL,
                "brand_id" integer,
                "balance" integer NOT NULL DEFAULT 0,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_loyalty_wallets" PRIMARY KEY ("id"),
                CONSTRAINT "FK_loyalty_wallets_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_loyalty_wallets_customer" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_loyalty_wallets_brand" FOREIGN KEY ("brand_id") REFERENCES "brands"("id") ON DELETE CASCADE
            )
        `);
        // One POS wallet per (customer, brand)
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_loyalty_wallets_pos"
            ON "loyalty_wallets" ("customer_id", "brand_id")
            WHERE "wallet_type" = 'pos'
        `);
        // One shared APP wallet per customer
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_loyalty_wallets_app"
            ON "loyalty_wallets" ("customer_id")
            WHERE "wallet_type" = 'app'
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_loyalty_wallets_customer"
            ON "loyalty_wallets" ("customer_id")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "loyalty_wallets"`);
    }
}
