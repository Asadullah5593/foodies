import { MigrationInterface, QueryRunner } from 'typeorm';

export class CartItemModifiers1740000000038 implements MigrationInterface {
    name = 'CartItemModifiers1740000000038';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "cart_items"
      ADD COLUMN IF NOT EXISTS "modifiers" jsonb NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      ALTER TABLE "cart_items"
      DROP COLUMN IF EXISTS "modifiers"
    `);
    }
}
