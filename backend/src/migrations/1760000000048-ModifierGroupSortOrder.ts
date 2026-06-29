import { MigrationInterface, QueryRunner } from 'typeorm';

export class ModifierGroupSortOrder1760000000048 implements MigrationInterface {
    name = 'ModifierGroupSortOrder1760000000048';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "modifier_groups" ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0`,
        );
        // Seed initial sort_order from existing insertion order, per brand
        await queryRunner.query(
            `UPDATE "modifier_groups" mg
             SET "sort_order" = sub.rn - 1
             FROM (
               SELECT id, ROW_NUMBER() OVER (PARTITION BY brand_id ORDER BY id) AS rn
               FROM modifier_groups
             ) sub
             WHERE mg.id = sub.id AND mg.sort_order = 0`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "modifier_groups" DROP COLUMN IF EXISTS "sort_order"`,
        );
    }
}
