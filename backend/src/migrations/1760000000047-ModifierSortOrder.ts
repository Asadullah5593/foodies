import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModifierSortOrder1760000000047 implements MigrationInterface {
    name = 'ModifierSortOrder1760000000047';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "modifiers" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0`,
        );
        // Seed initial sort_order values from the existing insertion order
        await queryRunner.query(
            `UPDATE "modifiers" m
             SET "sort_order" = sub.rn - 1
             FROM (
               SELECT id, ROW_NUMBER() OVER (PARTITION BY modifier_group_id ORDER BY id) AS rn
               FROM modifiers
             ) sub
             WHERE m.id = sub.id AND m.sort_order = 0`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "modifiers" DROP COLUMN IF EXISTS "sort_order"`,
        );
    }
}
