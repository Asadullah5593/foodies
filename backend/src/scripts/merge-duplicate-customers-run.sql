-- MERGE consumer rows (tenant_id NULL) into tenant-scoped rows (same phone).
-- Run merge-duplicate-customers-preview.sql first and review output.
-- Then run this file inside a transaction on production.

\set ON_ERROR_STOP on

BEGIN;

CREATE TEMP TABLE customer_dup_pairs AS
SELECT
    c_consumer.id AS consumer_id,
    c_tenant.id AS tenant_customer_id,
    c_tenant.tenant_id,
    c_consumer.phone
FROM customers c_consumer
INNER JOIN customers c_tenant
    ON c_tenant.phone = c_consumer.phone
    AND c_tenant.tenant_id IS NOT NULL
WHERE c_consumer.tenant_id IS NULL;

DO $$
DECLARE
    r RECORD;
BEGIN
    FOR r IN SELECT * FROM customer_dup_pairs ORDER BY consumer_id LOOP
        RAISE NOTICE 'Merging consumer % -> tenant customer % (tenant %, phone %)',
            r.consumer_id, r.tenant_customer_id, r.tenant_id, r.phone;

        UPDATE customers t
        SET
            email = COALESCE(NULLIF(t.email, ''), c.email),
            password = COALESCE(t.password, c.password),
            name = COALESCE(NULLIF(t.name, ''), c.name),
            profile_image_url = COALESCE(t.profile_image_url, c.profile_image_url),
            latitude = COALESCE(t.latitude, c.latitude),
            longitude = COALESCE(t.longitude, c.longitude),
            loyalty_points_balance = COALESCE(t.loyalty_points_balance, 0)
                + COALESCE(c.loyalty_points_balance, 0),
            updated_at = NOW()
        FROM customers c
        WHERE t.id = r.tenant_customer_id
          AND c.id = r.consumer_id;

        UPDATE orders SET customer_id = r.tenant_customer_id
        WHERE customer_id = r.consumer_id;

        UPDATE loyalty_transactions SET customer_id = r.tenant_customer_id
        WHERE customer_id = r.consumer_id;

        UPDATE rider_order_ratings SET customer_id = r.tenant_customer_id
        WHERE customer_id = r.consumer_id;

        UPDATE brand_order_ratings SET customer_id = r.tenant_customer_id
        WHERE customer_id = r.consumer_id;

        DELETE FROM carts absorb
        WHERE absorb.customer_id = r.consumer_id
          AND EXISTS (
              SELECT 1 FROM carts keep
              WHERE keep.customer_id = r.tenant_customer_id
                AND keep.branch_id = absorb.branch_id
          );

        UPDATE carts SET customer_id = r.tenant_customer_id
        WHERE customer_id = r.consumer_id;

        DELETE FROM customers WHERE id = r.consumer_id;
    END LOOP;
END $$;

-- Should return 0 rows after merge
SELECT COUNT(*) AS remaining_duplicate_pairs
FROM customers c_consumer
INNER JOIN customers c_tenant
    ON c_tenant.phone = c_consumer.phone
    AND c_tenant.tenant_id IS NOT NULL
WHERE c_consumer.tenant_id IS NULL;

COMMIT;
