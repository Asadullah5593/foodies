import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lets a free, optional modifier group still allow the same option multiple times
 * (qty stepper) — e.g. "Add a Sauce" (extra BBQ ×2) — while yes/no toggle groups
 * like "Remove a filling" stay single. Default false (priced / free-allowance /
 * choose-N groups are repeatable regardless).
 */
export class ModifierGroupAllowQuantity1760000000045 implements MigrationInterface {
    name = 'ModifierGroupAllowQuantity1760000000045';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifier_groups"
                ADD COLUMN IF NOT EXISTS "allow_quantity" boolean NOT NULL DEFAULT false
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifier_groups" DROP COLUMN IF EXISTS "allow_quantity"
        `);
    }
}
