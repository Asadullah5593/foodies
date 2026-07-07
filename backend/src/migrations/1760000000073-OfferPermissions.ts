import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Permissions for the new admin surfaces: campaigns management and the POS
 * per-order price override. Assigned to owner + super_admin so existing tenants
 * keep full access; reuses the existing discounts/promotions permissions for
 * product-promotions and coupons.
 */
export class OfferPermissions1760000000073 implements MigrationInterface {
    name = 'OfferPermissions1760000000073';

    private readonly permissions = [
        {
            name: 'campaigns:manage',
            resource: 'campaigns',
            action: 'manage',
            description: 'Manage campaigns, banners and offer settings',
        },
        {
            name: 'pos:price-override',
            resource: 'pos',
            action: 'price-override',
            description: 'Override an item price for a single POS order',
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
    }
}
