import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Phase 1 — cost basis for the never-below-cost floor (menu_items /
 * menu_variants) + POS per-order price override audit fields (order_items).
 * All nullable/defaulted: zero behavior change until populated/used.
 */
export class MenuCostAndPriceOverride1760000000071
  implements MigrationInterface
{
  name = 'MenuCostAndPriceOverride1760000000071';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE menu_items ADD COLUMN IF NOT EXISTS cost_price numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE menu_variants ADD COLUMN IF NOT EXISTS cost_price numeric(10,2)`,
    );
    await queryRunner.query(
      `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS price_overridden boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE order_items ADD COLUMN IF NOT EXISTS overridden_by integer`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE order_items DROP COLUMN IF EXISTS overridden_by`,
    );
    await queryRunner.query(
      `ALTER TABLE order_items DROP COLUMN IF EXISTS price_overridden`,
    );
    await queryRunner.query(
      `ALTER TABLE menu_variants DROP COLUMN IF EXISTS cost_price`,
    );
    await queryRunner.query(
      `ALTER TABLE menu_items DROP COLUMN IF EXISTS cost_price`,
    );
  }
}
