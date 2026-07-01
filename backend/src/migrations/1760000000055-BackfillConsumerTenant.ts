import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Backfill unlinked consumers onto the deployment's tenant.
 *
 * Consumers used to register with `tenant_id = NULL` and were linked to a tenant
 * later via the (now removed) `customers/sync-tenant` endpoint. Registration now
 * stamps the deployment's tenant (TENANT_ID env) at creation, and consumer
 * lookups (login, password reset, profile) are scoped to that tenant — so any
 * pre-existing NULL consumers must be moved over or they'd be orphaned.
 *
 * TENANT_ID drives the target so each deployment migrates its own consumers
 * (e.g. Foodies = 6). If TENANT_ID is unset/invalid, the migration is a no-op.
 *
 * Duplicates: a NULL consumer whose phone already exists under the target tenant
 * is a redundant, never-linked account (it has no tenant, so it can hold no real
 * orders). The existing tenant row wins and the NULL duplicate is DELETED —
 * carts/wallets/ratings/promotions cascade away, and any orders keep their
 * history via ON DELETE SET NULL. Deleted phones are reported for the record.
 */
export class BackfillConsumerTenant1760000000055
    implements MigrationInterface
{
    name = 'BackfillConsumerTenant1760000000055';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const raw = process.env.TENANT_ID;
        const tenantId =
            raw != null && raw.trim() !== '' ? Number(raw) : Number.NaN;
        if (!Number.isInteger(tenantId) || tenantId <= 0) {
            // eslint-disable-next-line no-console
            console.warn(
                '[BackfillConsumerTenant] TENANT_ID not configured; skipping consumer backfill.',
            );
            return;
        }

        // Identify redundant NULL consumers whose phone already exists under
        // the target tenant, then delete them (the tenant row wins). Dependents
        // cascade; orders are set null. A plain SELECT returns the rows directly
        // so the log reports the exact count and phones removed.
        const dupeFilter = `tenant_id IS NULL
                AND EXISTS (
                    SELECT 1 FROM customers t
                     WHERE t.tenant_id = $1 AND t.phone = customers.phone
                )`;
        const dupes: Array<{ phone: string }> = await queryRunner.query(
            `SELECT phone FROM customers WHERE ${dupeFilter}`,
            [tenantId],
        );
        if (dupes.length > 0) {
            await queryRunner.query(
                `DELETE FROM customers WHERE ${dupeFilter}`,
                [tenantId],
            );
            // eslint-disable-next-line no-console
            console.warn(
                `[BackfillConsumerTenant] deleted ${dupes.length} redundant consumer(s) already present under tenant ${tenantId}: ${dupes
                    .map((r) => r.phone)
                    .join(', ')}`,
            );
        }

        // Move every remaining NULL consumer onto the target tenant. No phone
        // collisions remain, so this cannot violate UQ_customers_tenant_phone.
        await queryRunner.query(
            `UPDATE customers SET tenant_id = $1 WHERE tenant_id IS NULL`,
            [tenantId],
        );
    }

    public async down(): Promise<void> {
        // Irreversible data migration: once consumers are linked to a tenant we
        // can no longer distinguish them from tenant customers created directly,
        // so there is nothing safe to revert.
    }
}
