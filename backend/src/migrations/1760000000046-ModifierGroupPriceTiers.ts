import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Quantity-tiered bundle pricing for a modifier group's charged units, e.g. pizza dips:
 * 1 extra = Rs99, 2 = Rs169, 3 = Rs249 (a bundle discount, not 99 each). Keyed by
 * charged-unit count → total charge. Null = ordinary per-unit pricing.
 */
export class ModifierGroupPriceTiers1760000000046 implements MigrationInterface {
    name = 'ModifierGroupPriceTiers1760000000046';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifier_groups"
                ADD COLUMN IF NOT EXISTS "price_tiers" jsonb
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifier_groups" DROP COLUMN IF EXISTS "price_tiers"
        `);
    }
}
