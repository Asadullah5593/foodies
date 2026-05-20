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
    v_consumer_email text;
    v_email_taken boolean;
BEGIN
    FOR r IN SELECT * FROM customer_dup_pairs ORDER BY consumer_id LOOP
        RAISE NOTICE 'Merging consumer % -> tenant customer % (tenant %, phone %)',
            r.consumer_id, r.tenant_customer_id, r.tenant_id, r.phone;

        SELECT NULLIF(LOWER(TRIM(c.email)), '')
        INTO v_consumer_email
        FROM customers c
        WHERE c.id = r.consumer_id;

        v_email_taken := false;
        IF v_consumer_email IS NOT NULL THEN
            SELECT EXISTS (
                SELECT 1 FROM customers other
                WHERE LOWER(TRIM(other.email)) = v_consumer_email
                  AND other.id NOT IN (r.consumer_id, r.tenant_customer_id)
            ) INTO v_email_taken;
        END IF;

        IF v_email_taken THEN
            RAISE NOTICE 'Skipping email % for pair % -> % (already used by another customer)',
                v_consumer_email, r.consumer_id, r.tenant_customer_id;
        END IF;

        UPDATE customers t
        SET
            email = CASE
                WHEN NULLIF(TRIM(t.email), '') IS NOT NULL THEN t.email
                WHEN v_consumer_email IS NULL THEN t.email
                WHEN v_email_taken THEN t.email
                ELSE v_consumer_email
            END,
            password = COALESCE(t.password, c.password),
            name = COALESCE(NULLIF(TRIM(t.name), ''), NULLIF(TRIM(c.name), '')),
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
