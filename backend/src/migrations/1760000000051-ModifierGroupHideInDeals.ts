import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hide cross-sell modifier groups ("Add a drink(s)") when an item is customized INSIDE a deal —
 * the deal supplies those via its own slots, so they shouldn't be offered/charged again during
 * the in-deal customization.
 */
export class ModifierGroupHideInDeals1760000000051 implements MigrationInterface {
    name = 'ModifierGroupHideInDeals1760000000051';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifier_groups"
                ADD COLUMN IF NOT EXISTS "hide_in_deals" boolean NOT NULL DEFAULT false
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifier_groups" DROP COLUMN IF EXISTS "hide_in_deals"
        `);
    }
}
