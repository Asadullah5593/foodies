import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add cms:manage and promotions:manage permissions and assign them to
 * owner and super_admin roles so existing tenants keep full access.
 */
export class CmsAndPromotionsPermissions1760000000025 implements MigrationInterface {
    name = 'CmsAndPromotionsPermissions1760000000025';

    private readonly permissions = [
        {
            name: 'cms:manage',
            resource: 'cms',
            action: 'manage',
            description: 'Manage CMS banners',
        },
        {
            name: 'promotions:manage',
            resource: 'promotions',
            action: 'manage',
            description: 'Manage targeted promotions',
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
            await queryRunner.query(
                `DELETE FROM permissions WHERE name = $1`,
                [p.name],
            );
        }
    }
}
