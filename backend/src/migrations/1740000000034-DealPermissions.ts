import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Add deals:view, deals:create, deals:edit, deals:delete permissions
 * and assign all four to owner and super_admin so tenant owners can assign accordingly.
 */
export class DealPermissions1740000000034 implements MigrationInterface {
    name = 'DealPermissions1740000000034';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const permissions = [
            {
                name: 'deals:view',
                resource: 'deals',
                action: 'view',
                description: 'View deals',
            },
            {
                name: 'deals:create',
                resource: 'deals',
                action: 'create',
                description: 'Create deals',
            },
            {
                name: 'deals:edit',
                resource: 'deals',
                action: 'edit',
                description: 'Edit deals',
            },
            {
                name: 'deals:delete',
                resource: 'deals',
                action: 'delete',
                description: 'Delete deals',
            },
        ];
        for (const p of permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
        }
        const permNames = permissions.map((p) => p.name);
        for (const permName of permNames) {
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

    public async down(): Promise<void> {
        // Do not remove permissions on down (other data may reference them)
    }
}
