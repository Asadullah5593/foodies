import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add the deliveries:manage permission (tier-based delivery config) and grant it to
 * owner/super_admin plus any role that already has loyalty:manage — so the same admins
 * who configure loyalty can configure delivery tiers.
 */
export class DeliveriesManagePermission1760000000035 implements MigrationInterface {
    name = 'DeliveriesManagePermission1760000000035';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `INSERT INTO permissions (name, resource, action, description)
             VALUES ('deliveries:manage', 'deliveries', 'manage', 'Manage tier-based delivery settings')
             ON CONFLICT (name) DO NOTHING`,
        );
        // Owner / super_admin always get it.
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug IN ('owner', 'super_admin') AND p.name = 'deliveries:manage'
             AND NOT EXISTS (
                 SELECT 1 FROM role_permissions rp
                 WHERE rp.role_id = r.id AND rp.permission_id = p.id
             )`,
        );
        // Any role that can manage loyalty (e.g. brand_admin) also gets delivery management.
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT rp.role_id, dp.id
             FROM role_permissions rp
             JOIN permissions lp ON lp.id = rp.permission_id AND lp.name = 'loyalty:manage'
             CROSS JOIN permissions dp
             WHERE dp.name = 'deliveries:manage'
             AND NOT EXISTS (
                 SELECT 1 FROM role_permissions x
                 WHERE x.role_id = rp.role_id AND x.permission_id = dp.id
             )`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM permissions WHERE name = 'deliveries:manage'`,
        );
    }
}
