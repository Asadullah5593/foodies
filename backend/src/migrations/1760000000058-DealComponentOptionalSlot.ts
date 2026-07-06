import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Optional deal slots: a choice slot may be marked `optional` so the customer can add
 * 0..quantity units (rather than exactly quantity) — e.g. "add a drink(s)" on a chicken
 * platter, where any number including repeats is allowed and none is also valid.
 */
export class DealComponentOptionalSlot1760000000058 implements MigrationInterface {
    name = 'DealComponentOptionalSlot1760000000058';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "deal_components"
                ADD COLUMN IF NOT EXISTS "optional" boolean NOT NULL DEFAULT false
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "deal_components" DROP COLUMN IF EXISTS "optional"
        `);
    }
}
