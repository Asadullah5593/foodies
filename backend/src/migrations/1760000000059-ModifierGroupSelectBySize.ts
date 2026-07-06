import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Per-size selection limits: a modifier group may declare `min_select_by_size` /
 * `max_select_by_size` (keyed by MenuVariant.sizeKey) that override its flat
 * min_select / max_select for the ordered line's size. Used for "Large box = choose
 * exactly 2 toppings, XL box = choose exactly 3" (WOK&GO Express Box). Null = the flat
 * limits apply to every size (existing behaviour unchanged).
 */
export class ModifierGroupSelectBySize1760000000059 implements MigrationInterface {
    name = 'ModifierGroupSelectBySize1760000000059';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifier_groups"
                ADD COLUMN IF NOT EXISTS "min_select_by_size" jsonb,
                ADD COLUMN IF NOT EXISTS "max_select_by_size" jsonb
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "modifier_groups"
                DROP COLUMN IF EXISTS "min_select_by_size",
                DROP COLUMN IF EXISTS "max_select_by_size"
        `);
    }
}
