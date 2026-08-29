import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Completes the order-type MARKER family started by
 * `orders:create:delivery-only` (…117): one marker per order type, and they
 * add up — delivery-only + takeaway-only = "takeaway and delivery, no
 * dine-in". Alone, each still means exactly what its name says, so existing
 * delivery-only accounts are unchanged.
 *
 * Granted to NO role here: the client assigns them from the Roles screen.
 */
export class OrderTypeMarkerPermissions1760000000123 implements MigrationInterface {
    name = 'OrderTypeMarkerPermissions1760000000123';

    private readonly permissions = [
        {
            name: 'orders:create:takeaway-only',
            action: 'create:takeaway-only',
            description:
                'May place takeaway orders at the POS (add to delivery-only for takeaway + delivery)',
        },
        {
            name: 'orders:create:dine-in-only',
            action: 'create:dine-in-only',
            description:
                'May place dine-in orders at the POS (combine with the other order-type markers to allow several)',
        },
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, 'orders', $2, $3)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.action, p.description],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM permissions WHERE name = ANY($1::text[])`,
            [this.permissions.map((p) => p.name)],
        );
    }
}
