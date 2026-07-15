import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brand-scope the offer surfaces.
 *
 * 1. Backfill eligibility_brand_ids for product/category-scoped offers that never
 *    got one. The admin UI had no brand selector, so every owner-created product
 *    promotion landed with NULL — which the pricing engine reads as "all brands"
 *    but the admin list reads as "owner-only". The offer discounted a brand's
 *    products while being invisible to that brand's admin.
 *
 *    Pricing is unaffected: an offer scoped to Fireaway menu items can only ever
 *    match a Fireaway order (orders are single-brand and menu_items.brand_id is
 *    NOT NULL), so pinning it to exactly those brands is a no-op at quote time.
 *
 * 2. Give bank_cards its own eligibility_brand_ids so cards can be brand-scoped
 *    like every other offer surface. NULL = all brands, preserving today's
 *    behaviour for existing rows.
 */
export class OfferBrandScopeBackfill1760000000079 implements MigrationInterface {
    name = 'OfferBrandScopeBackfill1760000000079';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // --- 1. bank_cards brand scoping (simple-json => text, matching bin_prefixes)
        await queryRunner.query(
            `ALTER TABLE bank_cards ADD COLUMN IF NOT EXISTS eligibility_brand_ids text`,
        );

        // --- 2. Backfill product-scoped offers from their menu items' brands.
        await queryRunner.query(`
            UPDATE discounts d
            SET eligibility_brand_ids = sub.brands
            FROM (
                SELECT d2.id,
                       jsonb_agg(DISTINCT mi.brand_id) AS brands
                FROM discounts d2
                JOIN LATERAL jsonb_array_elements_text(d2.application_scope_ids)
                     AS e(scope_id) ON true
                JOIN menu_items mi
                     ON mi.id = e.scope_id::int
                WHERE d2.application_scope = 'products'
                  AND d2.application_scope_ids IS NOT NULL
                  AND jsonb_typeof(d2.application_scope_ids) = 'array'
                  AND (
                        d2.eligibility_brand_ids IS NULL
                        OR (jsonb_typeof(d2.eligibility_brand_ids) = 'array'
                            AND jsonb_array_length(d2.eligibility_brand_ids) = 0)
                      )
                GROUP BY d2.id
            ) sub
            WHERE d.id = sub.id
        `);

        // --- 3. Same for category-scoped offers.
        await queryRunner.query(`
            UPDATE discounts d
            SET eligibility_brand_ids = sub.brands
            FROM (
                SELECT d2.id,
                       jsonb_agg(DISTINCT mc.brand_id) AS brands
                FROM discounts d2
                JOIN LATERAL jsonb_array_elements_text(d2.application_scope_ids)
                     AS e(scope_id) ON true
                JOIN menu_categories mc
                     ON mc.id = e.scope_id::int
                WHERE d2.application_scope = 'category'
                  AND d2.application_scope_ids IS NOT NULL
                  AND jsonb_typeof(d2.application_scope_ids) = 'array'
                  AND (
                        d2.eligibility_brand_ids IS NULL
                        OR (jsonb_typeof(d2.eligibility_brand_ids) = 'array'
                            AND jsonb_array_length(d2.eligibility_brand_ids) = 0)
                      )
                GROUP BY d2.id
            ) sub
            WHERE d.id = sub.id
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // The backfill is not reversed: the derived brands are the offers' true
        // scope, and restoring NULL would re-orphan them. Only the new column goes.
        await queryRunner.query(
            `ALTER TABLE bank_cards DROP COLUMN IF EXISTS eligibility_brand_ids`,
        );
    }
}
