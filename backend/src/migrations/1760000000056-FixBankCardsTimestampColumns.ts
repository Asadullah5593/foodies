import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Corrective migration for DBs that ran 1760000000054 before it was fixed.
 *
 * That migration created bank_cards timestamps as quoted camelCase columns
 * ("createdAt" / "updatedAt"), but the entity's @CreateDateColumn/@UpdateDateColumn
 * are snake_cased by the naming strategy to created_at / updated_at — so every INSERT
 * referenced non-existent columns and 500'd. This renames them to the correct names.
 *
 * Guarded: on a fresh DB (where 054 already creates created_at/updated_at) this is a no-op.
 */
export class FixBankCardsTimestampColumns1760000000056
    implements MigrationInterface
{
    name = 'FixBankCardsTimestampColumns1760000000056';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'bank_cards' AND column_name = 'createdAt'
                ) THEN
                    ALTER TABLE "bank_cards" RENAME COLUMN "createdAt" TO "created_at";
                END IF;
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'bank_cards' AND column_name = 'updatedAt'
                ) THEN
                    ALTER TABLE "bank_cards" RENAME COLUMN "updatedAt" TO "updated_at";
                END IF;
            END $$;
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            DO $$
            BEGIN
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'bank_cards' AND column_name = 'created_at'
                ) THEN
                    ALTER TABLE "bank_cards" RENAME COLUMN "created_at" TO "createdAt";
                END IF;
                IF EXISTS (
                    SELECT 1 FROM information_schema.columns
                    WHERE table_name = 'bank_cards' AND column_name = 'updated_at'
                ) THEN
                    ALTER TABLE "bank_cards" RENAME COLUMN "updated_at" TO "updatedAt";
                END IF;
            END $$;
        `);
    }
}
