import { MigrationInterface, QueryRunner } from 'typeorm';

/** Phase 1 — campaign_items: banners/carousel cards under a campaign. */
export class CampaignItemsTable1760000000068 implements MigrationInterface {
  name = 'CampaignItemsTable1760000000068';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS campaign_items (
        id serial PRIMARY KEY,
        campaign_id integer NOT NULL,
        kind varchar NOT NULL,
        title varchar,
        subtitle varchar,
        image_url varchar,
        sort_order integer NOT NULL DEFAULT 0,
        is_active boolean NOT NULL DEFAULT true,
        valid_from timestamp,
        valid_until timestamp,
        offer_id integer,
        deal_menu_item_id integer,
        destination_type varchar,
        destination_id integer,
        deep_link_url varchar,
        created_at timestamp NOT NULL DEFAULT now(),
        updated_at timestamp NOT NULL DEFAULT now(),
        CONSTRAINT "FK_campaign_items_campaign" FOREIGN KEY (campaign_id)
          REFERENCES campaigns(id) ON DELETE CASCADE,
        CONSTRAINT "FK_campaign_items_offer" FOREIGN KEY (offer_id)
          REFERENCES discounts(id) ON DELETE SET NULL,
        CONSTRAINT "FK_campaign_items_deal" FOREIGN KEY (deal_menu_item_id)
          REFERENCES menu_items(id) ON DELETE SET NULL,
        CONSTRAINT "CHK_campaign_items_offer" CHECK (kind <> 'offer' OR offer_id IS NOT NULL),
        CONSTRAINT "CHK_campaign_items_deal" CHECK (kind <> 'deal' OR deal_menu_item_id IS NOT NULL)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_campaign_items_campaign" ON campaign_items (campaign_id)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_campaign_items_campaign"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS campaign_items`);
  }
}
