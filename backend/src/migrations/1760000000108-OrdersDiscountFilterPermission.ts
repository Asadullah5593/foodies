import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Discount filter on the admin Orders page (All / Discounted / Full price /
 * one discount kind). Follows the orders:filter:* pattern: backfilled onto
 * every role that already holds orders:view so nothing is lost — revoke it per
 * role from the Roles UI to hide the dropdown for that role.
 */
export class OrdersDiscountFilterPermission1760000000108 implements MigrationInterface {
    name = 'OrdersDiscountFilterPermission1760000000108';

    private readonly permission = {
        name: 'orders:filter:discount',
        resource: 'orders',
        action: 'filter:discount',
        description:
            'Filter the order history by discount (any / none / promo / coupon / card / staff)',
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
        // Backfill: any role that can already view orders keeps this filter,
        // mirroring the OrdersPaymentFilterPermission rollout.
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT DISTINCT rp.role_id, np.id
             FROM role_permissions rp
             INNER JOIN permissions lp ON lp.id = rp.permission_id AND lp.name = 'orders:view'
             CROSS JOIN permissions np
             WHERE np.name = $1
             AND NOT EXISTS (
                 SELECT 1 FROM role_permissions rp2
                 WHERE rp2.role_id = rp.role_id AND rp2.permission_id = np.id
             )`,
            [this.permission.name],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM permissions WHERE name = $1`, [
            this.permission.name,
        ]);
    }
}
