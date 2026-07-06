import { MigrationInterface, QueryRunner } from 'typeorm';

export class MenuItemModifierGroupPositions1760000000049 implements MigrationInterface {
    async up(runner: QueryRunner): Promise<void> {
        await runner.query(`
            CREATE TABLE IF NOT EXISTS "menu_item_modifier_group_positions" (
                "id"                SERIAL PRIMARY KEY,
                "menu_item_id"      integer NOT NULL,
                "modifier_group_id" integer NOT NULL,
                "sort_order"        integer NOT NULL DEFAULT 0,
                CONSTRAINT "UQ_img_pos_item_group"
                    UNIQUE ("menu_item_id", "modifier_group_id"),
                CONSTRAINT "FK_img_pos_menu_item"
                    FOREIGN KEY ("menu_item_id")
                    REFERENCES "menu_items"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_img_pos_modifier_group"
                    FOREIGN KEY ("modifier_group_id")
                    REFERENCES "modifier_groups"("id") ON DELETE CASCADE
            )
        `);

        await runner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_img_pos_menu_item"
            ON "menu_item_modifier_group_positions" ("menu_item_id")
        `);

        // Seed initial positions from the existing join table,
        // ordered by the current global sort_order then id.
        await runner.query(`
            INSERT INTO "menu_item_modifier_group_positions"
                ("menu_item_id", "modifier_group_id", "sort_order")
            SELECT
                jimig.menu_item_id,
                jimig.modifier_group_id,
                (ROW_NUMBER() OVER (
                    PARTITION BY jimig.menu_item_id
                    ORDER BY mg.sort_order ASC, mg.id ASC
                ) - 1)::integer
            FROM   "menu_item_modifier_groups" jimig
            JOIN   "modifier_groups" mg ON mg.id = jimig.modifier_group_id
            ON CONFLICT ("menu_item_id", "modifier_group_id") DO NOTHING
        `);
    }

    async down(runner: QueryRunner): Promise<void> {
        await runner.query(
            `DROP TABLE IF EXISTS "menu_item_modifier_group_positions"`,
        );
    }
}
