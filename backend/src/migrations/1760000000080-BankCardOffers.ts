import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bank card discounts become their own module, separate from Discounts.
 *
 * A card offer used to be a `discounts` row (offer_kind='card_offer',
 * requires_card=true, eligible_bank_card_ids=[...]), created via a "requires
 * specific card" toggle buried on the Discounts page. That mixed two unrelated
 * concepts and left the Bank Cards page unable to show that a card even had an
 * offer. The card now carries its own discount: add a card, then say what a
 * customer gets for paying with it.
 *
 * Card offers are always whole-order, so no application_scope columns come along.
 * A NULL discount_value means "card with no offer" — still selectable at the till
 * for tender/BIN purposes, it just discounts nothing.
 */
export class BankCardOffers1760000000080 implements MigrationInterface {
    name = 'BankCardOffers1760000000080';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE bank_cards
                ADD COLUMN IF NOT EXISTS discount_type varchar,
                ADD COLUMN IF NOT EXISTS discount_value numeric(10,2),
                ADD COLUMN IF NOT EXISTS min_order_amount numeric(10,2),
                ADD COLUMN IF NOT EXISTS max_discount_amount numeric(10,2),
                ADD COLUMN IF NOT EXISTS valid_from timestamp,
                ADD COLUMN IF NOT EXISTS valid_until timestamp,
                ADD COLUMN IF NOT EXISTS valid_time_start time,
                ADD COLUMN IF NOT EXISTS valid_time_end time,
                ADD COLUMN IF NOT EXISTS valid_days_of_week text,
                ADD COLUMN IF NOT EXISTS eligibility_branch_ids text
        `);

        // Carry any existing card offer onto the cards it unlocked. A card listed by
        // several offers keeps the first by id; the rest are reported below rather
        // than silently dropped.
        await queryRunner.query(`
            UPDATE bank_cards bc
            SET discount_type       = src.type,
                discount_value      = src.value,
                min_order_amount    = src.min_order_amount,
                max_discount_amount = src.max_discount_amount,
                valid_from          = src.valid_from,
                valid_until         = src.valid_until,
                valid_time_start    = src.valid_time_start,
                valid_time_end      = src.valid_time_end,
                valid_days_of_week  = src.valid_days_of_week::text,
                eligibility_brand_ids = COALESCE(
                    bc.eligibility_brand_ids, src.eligibility_brand_ids::text
                )
            FROM (
                SELECT DISTINCT ON (card_id.value::int)
                       card_id.value::int AS card_id,
                       d.type, d.value, d.min_order_amount, d.max_discount_amount,
                       d.valid_from, d.valid_until, d.valid_time_start, d.valid_time_end,
                       d.valid_days_of_week, d.eligibility_brand_ids
                FROM discounts d
                -- eligible_bank_card_ids is a simple-json TEXT column, not jsonb.
                JOIN LATERAL jsonb_array_elements_text(
                         d.eligible_bank_card_ids::jsonb
                     ) AS card_id(value) ON true
                WHERE d.offer_kind = 'card_offer'
                  AND d.eligible_bank_card_ids IS NOT NULL
                  AND jsonb_typeof(d.eligible_bank_card_ids::jsonb) = 'array'
                ORDER BY card_id.value::int, d.id
            ) src
            WHERE bc.id = src.card_id
              AND bc.discount_value IS NULL
        `);

        // The offers now live on the cards. Orders keep their recorded
        // card_discount_amount; orders.discount_id is ON DELETE SET NULL.
        await queryRunner.query(
            `DELETE FROM discounts WHERE offer_kind = 'card_offer'`,
        );

        // The engine's card gate keys on requires_card, NOT on offer_kind, so a row
        // that kept requires_card=true under any other kind would stay card-gated
        // while being invisible to the bank cards module. Disarm every survivor.
        await queryRunner.query(`
            UPDATE discounts
            SET requires_card = false, eligible_bank_card_ids = NULL
            WHERE requires_card = true
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Not reversed into discounts rows: the offers are the cards' own data now,
        // and recreating them would resurrect the mixed model this migration undoes.
        await queryRunner.query(`
            ALTER TABLE bank_cards
                DROP COLUMN IF EXISTS discount_type,
                DROP COLUMN IF EXISTS discount_value,
                DROP COLUMN IF EXISTS min_order_amount,
                DROP COLUMN IF EXISTS max_discount_amount,
                DROP COLUMN IF EXISTS valid_from,
                DROP COLUMN IF EXISTS valid_until,
                DROP COLUMN IF EXISTS valid_time_start,
                DROP COLUMN IF EXISTS valid_time_end,
                DROP COLUMN IF EXISTS valid_days_of_week,
                DROP COLUMN IF EXISTS eligibility_branch_ids
        `);
    }
}
