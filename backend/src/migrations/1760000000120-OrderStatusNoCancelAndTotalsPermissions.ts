import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Two order permissions the client assigns by hand.
 *
 * `orders:update-status:no-cancel` — the status flow without cancel. It grants
 * placed → accepted → preparing → ready → completed (any direction) on its own,
 * so it can be given INSTEAD of `orders:update-status`, and it refuses
 * `cancelled` even when the broader permission is also held.
 *
 * `orders:view:no-totals` — hides the "Page value" money figure in the Orders
 * page footer. Grants nothing; it takes the aggregate away from an account that
 * may still work the list. Per-order totals stay visible.
 *
 * Granted to NO role here, exactly as `orders:create:delivery-only` (117) was:
 * seeding them onto a role slug would decide for the client who carries them.
 *
 * Numbered 120 — 110–116 belong to the Employee HRM branch (not yet merged),
 * 117 is DeliveryOnly and 118/119 are the activity log.
 */
export class OrderStatusNoCancelAndTotalsPermissions1760000000120 implements MigrationInterface {
    name = 'OrderStatusNoCancelAndTotalsPermissions1760000000120';

    private readonly permissions = [
        {
            name: 'orders:update-status:no-cancel',
            resource: 'orders',
            action: 'update-status:no-cancel',
            description:
                'May move orders through placed/accepted/preparing/ready/completed, but may not cancel',
        },
        {
            name: 'orders:view:no-totals',
            resource: 'orders',
            action: 'view:no-totals',
            description:
                'Hides the Orders page total value (the Page value figure in the footer)',
        },
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const p of this.permissions) {
            await queryRunner.query(`DELETE FROM permissions WHERE name = $1`, [
                p.name,
            ]);
        }
    }
}
