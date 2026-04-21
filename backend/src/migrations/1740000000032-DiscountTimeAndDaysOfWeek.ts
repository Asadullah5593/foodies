import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add recurring time-of-day and day-of-week to discounts (e.g. Lunch 12–4 Mon–Fri).
 * valid_time_start / valid_time_end: TIME, interpreted in branch timezone.
 * valid_days_of_week: JSON array of 0–6 (0=Sunday, 1=Monday, …, 6=Saturday).
 */
export class DiscountTimeAndDaysOfWeek1740000000032 implements MigrationInterface {
    name = 'DiscountTimeAndDaysOfWeek1740000000032';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE "discounts"
            ADD COLUMN IF NOT EXISTS "valid_time_start" TIME
        `);
        await queryRunner.query(`
            ALTER TABLE "discounts"
            ADD COLUMN IF NOT EXISTS "valid_time_end" TIME
        `);
        await queryRunner.query(`
            ALTER TABLE "discounts"
            ADD COLUMN IF NOT EXISTS "valid_days_of_week" jsonb
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "discounts" DROP COLUMN IF EXISTS "valid_time_start"`,
        );
        await queryRunner.query(
            `ALTER TABLE "discounts" DROP COLUMN IF EXISTS "valid_time_end"`,
        );
        await queryRunner.query(
            `ALTER TABLE "discounts" DROP COLUMN IF EXISTS "valid_days_of_week"`,
        );
    }
}
