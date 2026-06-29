import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-size availability for a modifier option, e.g. "7\" pizzas: Regular Crust only"
 * (Thin Crust available only on 10/12/14). Keyed by MenuVariant.size_key; null = every size.
 */
export class ModifierAvailableForSizes1760000000044 implements MigrationInterface {
    name = 'ModifierAvailableForSizes1760000000044';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifiers"
                ADD COLUMN IF NOT EXISTS "available_for_sizes" jsonb
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifiers" DROP COLUMN IF EXISTS "available_for_sizes"
        `);
    }
}
