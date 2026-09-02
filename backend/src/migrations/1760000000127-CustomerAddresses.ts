import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A customer's address book, so an order taker stops asking a regular where
 * they live every single time.
 *
 * Deliberately NOT derived from order history at read time. An order records
 * where THAT order went — a historical fact that must never change — while an
 * address book is current state: somewhere a customer can move away from, a
 * typo someone can fix, an entry they can ask to have deleted. Reading one off
 * the other means none of that is expressible without rewriting past orders.
 * `orders.delivery_address` stays as its own snapshot, the same way order items
 * keep `name_snapshot` and activity logs keep `actor_label`.
 *
 * Keyed on the phone number because that is what the till has in hand before a
 * customer record exists — guest orders never create one.
 *
 * brand_ids records which brands have delivered here, so a brand-locked user
 * sees only addresses their own brand has served, without joining back to
 * orders on every lookup. Mirrors customers.brand_ids.
 *
 * The backfill reads exactly what a derived implementation would have computed,
 * so nothing already collected is lost — including the addresses customers
 * typed into the mobile app themselves, which are most of them.
 */
export class CustomerAddresses1760000000127 implements MigrationInterface {
    name = 'CustomerAddresses1760000000127';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "customer_addresses" (
                "id" SERIAL PRIMARY KEY,
                "tenant_id" integer NOT NULL,
                "customer_phone" character varying(32) NOT NULL,
                "customer_id" integer,
                "label" character varying(40),
                "address" text NOT NULL,
                -- Lower-cased, punctuation-stripped, single-spaced form of
                -- the address column. Two spellings of one doorstep collapse to one row
                -- instead of stacking up in the picker.
                "address_key" character varying(255) NOT NULL,
                "latitude" numeric(10,7),
                "longitude" numeric(10,7),
                "notes" text,
                "brand_ids" integer[],
                "times_used" integer NOT NULL DEFAULT 0,
                "last_used_at" TIMESTAMP,
                -- Soft-deleted: hiding an address a customer has moved away from
                -- must not erase the orders that went there.
                "deleted_at" TIMESTAMP,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
                CONSTRAINT "FK_customer_addresses_tenant"
                    FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
                CONSTRAINT "FK_customer_addresses_customer"
                    FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL
            )
        `);

        // One row per doorstep per customer per tenant. Partial, so a deleted
        // entry never blocks the same address being added again later.
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customer_addresses_phone_key"
            ON "customer_addresses" ("tenant_id", "customer_phone", "address_key")
            WHERE "deleted_at" IS NULL
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_customer_addresses_lookup"
            ON "customer_addresses" ("tenant_id", "customer_phone")
            WHERE "deleted_at" IS NULL
        `);

        // —— Backfill from delivery orders ——
        // Only rows carrying coordinates: the POS refuses a delivery order whose
        // address was not resolved to a point, because the fee is priced by
        // distance and the rider needs a pin. An address offered without one
        // could not be used anyway.
        await queryRunner.query(`
            INSERT INTO "customer_addresses"
                (tenant_id, customer_phone, customer_id, address, address_key,
                 latitude, longitude, brand_ids, times_used, last_used_at,
                 created_at, updated_at)
            SELECT
                o.tenant_id,
                o.customer_phone,
                (ARRAY_AGG(o.customer_id ORDER BY o.placed_at DESC NULLS LAST)
                    FILTER (WHERE o.customer_id IS NOT NULL))[1],
                (ARRAY_AGG(btrim(o.delivery_address) ORDER BY o.placed_at DESC NULLS LAST))[1],
                left(btrim(regexp_replace(lower(btrim(o.delivery_address)), '[^a-z0-9]+', ' ', 'g')), 255),
                (ARRAY_AGG(o.delivery_latitude ORDER BY o.placed_at DESC NULLS LAST))[1],
                (ARRAY_AGG(o.delivery_longitude ORDER BY o.placed_at DESC NULLS LAST))[1],
                ARRAY(SELECT DISTINCT x FROM unnest(ARRAY_AGG(o.brand_id)) AS x WHERE x IS NOT NULL),
                COUNT(*),
                MAX(o.placed_at),
                now(), now()
            FROM "orders" o
            WHERE o.order_type = 'delivery'
              AND o.tenant_id IS NOT NULL
              AND o.customer_phone IS NOT NULL AND btrim(o.customer_phone) <> ''
              AND o.delivery_address IS NOT NULL AND btrim(o.delivery_address) <> ''
              AND o.delivery_latitude IS NOT NULL
              AND o.delivery_longitude IS NOT NULL
            GROUP BY o.tenant_id, o.customer_phone,
                     left(btrim(regexp_replace(lower(btrim(o.delivery_address)), '[^a-z0-9]+', ' ', 'g')), 255)
            ON CONFLICT DO NOTHING
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Every row is reproducible from orders, so nothing original is lost —
        // except labels and notes, which only exist here.
        await queryRunner.query(`DROP TABLE IF EXISTS "customer_addresses"`);
    }
}
