import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add deal_components table for composable deals (slots: fixed / choice_category / choice_list)
 * and order_items.deal_id, deal_slot_index for grouping deal lines.
 */
export class DealComponentsAndOrderItemDealId1740000000033
    implements MigrationInterface
{
    name = 'DealComponentsAndOrderItemDealId1740000000033';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE "deal_components" (
                "id" SERIAL NOT NULL,
                "menu_item_id" integer NOT NULL,
                "slot_index" integer NOT NULL,
                "type" character varying(32) NOT NULL,
                "source_menu_item_id" integer,
                "source_category_id" integer,
                "source_menu_item_ids" jsonb,
                "quantity" integer NOT NULL DEFAULT 1,
                "allow_customization" boolean NOT NULL DEFAULT true,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "PK_deal_components" PRIMARY KEY ("id"),
                CONSTRAINT "FK_deal_components_menu_item" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_deal_components_source_menu_item" FOREIGN KEY ("source_menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_deal_components_source_category" FOREIGN KEY ("source_category_id") REFERENCES "menu_categories"("id") ON DELETE SET NULL
            )
        `);
        await queryRunner.query(`
            ALTER TABLE "order_items"
            ADD COLUMN IF NOT EXISTS "deal_id" integer NULL
        `);
        await queryRunner.query(`
            ALTER TABLE "order_items"
            ADD COLUMN IF NOT EXISTS "deal_slot_index" integer NULL
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE "order_items" DROP COLUMN IF EXISTS "deal_slot_index"`,
        );
        await queryRunner.query(
            `ALTER TABLE "order_items" DROP COLUMN IF EXISTS "deal_id"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "deal_components"`);
    }
}
