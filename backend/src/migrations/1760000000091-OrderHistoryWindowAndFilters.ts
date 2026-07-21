import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two related pieces of order-history scoping:
 *
 * 1. `roles.order_history_days` — how far back a role may see orders in the
 *    admin Orders module (null = unlimited, which is what every existing role
 *    keeps). Enforced server-side, so narrowing the window cannot be bypassed
 *    by widening the date filter in the URL.
 *
 * 2. `orders:filter:*` permissions — which filter controls the Orders page
 *    offers. Backfilled onto every role that already holds orders:view so no
 *    existing role loses a filter; new roles start with none, leaving just the
 *    date range (e.g. a brand cashier who may only pick a date).
 */
export class OrderHistoryWindowAndFilters1760000000091
    implements MigrationInterface
{
    name = 'OrderHistoryWindowAndFilters1760000000091';

    private readonly permissions = [
        {
            name: 'orders:filter:branch',
            resource: 'orders',
            action: 'filter:branch',
            description: 'Use the branch filter in order history',
        },
        {
            name: 'orders:filter:brand',
            resource: 'orders',
            action: 'filter:brand',
            description: 'Use the brand filter in order history',
        },
        {
            name: 'orders:filter:order-type',
            resource: 'orders',
            action: 'filter:order-type',
            description: 'Use the order-type filter in order history',
        },
        {
            name: 'orders:filter:source',
            resource: 'orders',
            action: 'filter:source',
            description: 'Use the source filter in order history',
        },
        {
            name: 'orders:filter:status',
            resource: 'orders',
            action: 'filter:status',
            description: 'Use the status tabs in order history',
        },
        {
            name: 'orders:filter:search',
            resource: 'orders',
            action: 'filter:search',
            description: 'Search order history by order # / customer',
        },
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE roles ADD COLUMN IF NOT EXISTS order_history_days integer`,
        );

        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
        }

        // Backfill: every role that can already view orders keeps every filter.
        for (const permName of this.permissions.map((p) => p.name)) {
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT r.id, p.id
                 FROM roles r
                 CROSS JOIN permissions p
                 WHERE p.name = $1
                   AND EXISTS (
                       SELECT 1 FROM role_permissions rp
                       INNER JOIN permissions vp ON vp.id = rp.permission_id
                       WHERE rp.role_id = r.id AND vp.name = 'orders:view'
                   )
                   AND NOT EXISTS (
                       SELECT 1 FROM role_permissions rp2
                       WHERE rp2.role_id = r.id AND rp2.permission_id = p.id
                   )`,
                [permName],
            );
        }

        // Owner / super admin hold everything.
        for (const permName of this.permissions.map((p) => p.name)) {
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT r.id, p.id FROM roles r
                 CROSS JOIN permissions p
                 WHERE r.slug IN ('owner', 'super_admin') AND p.name = $1
                 AND NOT EXISTS (
                     SELECT 1 FROM role_permissions rp
                     WHERE rp.role_id = r.id AND rp.permission_id = p.id
                 )`,
                [permName],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const p of this.permissions) {
            await queryRunner.query(`DELETE FROM permissions WHERE name = $1`, [
                p.name,
            ]);
        }
        await queryRunner.query(
            `ALTER TABLE roles DROP COLUMN IF EXISTS order_history_days`,
        );
    }
}
