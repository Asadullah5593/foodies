import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brand-scoped inventory permissions so a brand admin can:
 *  - see their brand's stock across their branches (inventory:view:brand),
 *  - request transfers in (inventory:transfer:request), and
 *  - approve/dispatch pulls FROM a bucket they control (inventory:transfer:approve).
 *
 * Per-bucket authority (which branch/brand a user may actually act on) is
 * enforced in InventoryTransferService; these permissions only open the routes.
 * Granted to owner, super_admin and brand_admin. The brand_admin grant is
 * best-effort here (the role is created by the seed:brand-admins script, which
 * also re-syncs these permissions).
 */
export class BrandAdminInventoryPermissions1760000000039 implements MigrationInterface {
    name = 'BrandAdminInventoryPermissions1760000000039';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const newPermissions = [
            {
                name: 'inventory:view:brand',
                resource: 'inventory',
                action: 'view_brand',
                description: "View own brand's stock across branches",
            },
            {
                name: 'inventory:transfer:request',
                resource: 'inventory',
                action: 'transfer_request',
                description:
                    'Request inventory transfers in (destination side)',
            },
            {
                name: 'inventory:transfer:approve',
                resource: 'inventory',
                action: 'transfer_approve',
                description:
                    'Approve/dispatch transfers out of a controlled bucket (source side)',
            },
        ];

        for (const p of newPermissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, $2, $3, $4)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.resource, p.action, p.description],
            );
        }

        for (const p of newPermissions) {
            await queryRunner.query(
                `INSERT INTO role_permissions (role_id, permission_id)
                 SELECT r.id, perm.id
                 FROM roles r
                 CROSS JOIN permissions perm
                 WHERE r.slug IN ('owner', 'super_admin', 'brand_admin')
                   AND perm.name = $1
                   AND NOT EXISTS (
                     SELECT 1 FROM role_permissions rp
                     WHERE rp.role_id = r.id AND rp.permission_id = perm.id
                   )`,
                [p.name],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const names = [
            'inventory:view:brand',
            'inventory:transfer:request',
            'inventory:transfer:approve',
        ];
        for (const name of names) {
            await queryRunner.query('DELETE FROM permissions WHERE name = $1', [
                name,
            ]);
        }
    }
}
