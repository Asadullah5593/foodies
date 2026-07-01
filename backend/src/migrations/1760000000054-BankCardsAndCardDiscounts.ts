import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Card-linked discounts (Pakistan bank offers).
 *  - bank_cards: tenant-scoped catalog of specific bank cards/products.
 *  - discounts.requires_card / eligible_bank_card_ids: gate a discount on a card.
 *  - payments.bank_card_id: which card a card tender used (discount validation + audit).
 * All additive/nullable → existing discounts and payments are unchanged.
 */
export class BankCardsAndCardDiscounts1760000000054
    implements MigrationInterface
{
    name = 'BankCardsAndCardDiscounts1760000000054';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "bank_cards" (
                "id" SERIAL PRIMARY KEY,
                "tenant_id" integer NOT NULL,
                "name" character varying NOT NULL,
                "bank" character varying,
                "network" character varying,
                "bin_prefixes" text,
                "is_active" boolean NOT NULL DEFAULT true,
                "createdAt" TIMESTAMP NOT NULL DEFAULT now(),
                "updatedAt" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "FK_bank_cards_tenant" FOREIGN KEY ("tenant_id")
                    REFERENCES "tenants"("id") ON DELETE CASCADE
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_bank_cards_tenant" ON "bank_cards" ("tenant_id")
        `);
        await queryRunner.query(`
            ALTER TABLE "discounts"
                ADD COLUMN IF NOT EXISTS "requires_card" boolean NOT NULL DEFAULT false,
                ADD COLUMN IF NOT EXISTS "eligible_bank_card_ids" text
        `);
        await queryRunner.query(`
            ALTER TABLE "payments"
                ADD COLUMN IF NOT EXISTS "bank_card_id" integer
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "payments" DROP COLUMN IF EXISTS "bank_card_id"
        `);
        await queryRunner.query(`
            ALTER TABLE "discounts"
                DROP COLUMN IF EXISTS "eligible_bank_card_ids",
                DROP COLUMN IF EXISTS "requires_card"
        `);
        await queryRunner.query(`DROP TABLE IF EXISTS "bank_cards"`);
    }
}
