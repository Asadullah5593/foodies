import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `orders:create:delivery-only` — a MARKER permission (same family as
 * `orders:place:call-center`): holding it does not grant anything, it narrows
 * `orders:create` so the account may punch delivery orders only. Dine-in and
 * takeaway are refused server-side on both quote and createOrder, and the POS
 * hides those order types for such a user.
 *
 * Built for call-centre agents, who take phone orders for delivery — a dine-in
 * or takeaway punched from a call-centre desk is always a slip, since nobody is
 * at the counter to collect it.
 *
 * Granted to NO role here. The client assigns it by hand from the Roles screen
 * to exactly the accounts that should carry it; seeding it onto a role slug
 * would decide that for them.
 *
 * Numbered 117 because 110–116 are already taken by the Employee HRM branch
 * (not yet merged); reusing one of those would collide the day it lands.
 */
export class DeliveryOnlyOrderPermission1760000000117 implements MigrationInterface {
    name = 'DeliveryOnlyOrderPermission1760000000117';

    private readonly permission = {
        name: 'orders:create:delivery-only',
        resource: 'orders',
        action: 'create:delivery-only',
        description:
            'May place delivery orders only at the POS (dine-in and takeaway are refused)',
    };

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `INSERT INTO permissions (name, resource, action, description)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (name) DO NOTHING`,
            [
                this.permission.name,
                this.permission.resource,
                this.permission.action,
                this.permission.description,
            ],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM permissions WHERE name = $1`, [
            this.permission.name,
        ]);
    }
}
