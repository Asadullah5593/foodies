-- Preview consumer + tenant duplicate pairs (safe, read-only).
SELECT
    c_consumer.id AS consumer_id,
    c_tenant.id AS tenant_customer_id,
    c_tenant.tenant_id,
    c_consumer.phone,
    c_consumer.email AS consumer_email,
    c_tenant.email AS tenant_email,
    c_consumer.loyalty_points_balance AS consumer_points,
    c_tenant.loyalty_points_balance AS tenant_points,
    c_consumer.created_at AS consumer_created,
    c_tenant.created_at AS tenant_created,
    EXISTS (
        SELECT 1 FROM customers other
        WHERE c_consumer.email IS NOT NULL
          AND TRIM(c_consumer.email) <> ''
          AND LOWER(TRIM(other.email)) = LOWER(TRIM(c_consumer.email))
          AND other.id NOT IN (c_consumer.id, c_tenant.id)
    ) AS email_conflict
FROM customers c_consumer
INNER JOIN customers c_tenant
    ON c_tenant.phone = c_consumer.phone
    AND c_tenant.tenant_id IS NOT NULL
WHERE c_consumer.tenant_id IS NULL
ORDER BY c_consumer.id;
