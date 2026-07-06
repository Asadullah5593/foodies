import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Conditional modifier groups: a group may declare `visible_when_modifier_ids` — the group is
 * only shown/required (and only charged) when the customer's current selection includes one of
 * those modifier ids. Used so "Choose your Meal Drink" appears only after a paid "Make it a Meal?"
 * option is chosen (not "On its Own"). Null = always visible (existing behaviour unchanged).
 */
export class ModifierGroupConditionalVisibility1760000000057 implements MigrationInterface {
    name = 'ModifierGroupConditionalVisibility1760000000057';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifier_groups"
                ADD COLUMN IF NOT EXISTS "visible_when_modifier_ids" jsonb
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifier_groups" DROP COLUMN IF EXISTS "visible_when_modifier_ids"
        `);
    }
}
