import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Branch-filter permissions for the two kitchen screens. The branch selector on
 * Back Kitchen and FOH Packing becomes permission-gated UI: staff without the
 * permission are pinned to their assigned branch. Assigned to Owner, Super
 * Admin, Branch Manager and Brand Admin (both live-DB and seed slug spellings).
 */
export class KitchenBranchFilterPermissions1760000000082 implements MigrationInterface {
    name = 'KitchenBranchFilterPermissions1760000000082';

    private readonly permissions = [
        {
            name: 'back-kitchen:branch-filter',
            resource: 'back-kitchen',
            action: 'branch-filter',
            description: 'Show the branch filter on the Back Kitchen screen',
        },
        {
            name: 'foh:branch-filter',
            resource: 'foh',
            action: 'branch-filter',
            description: 'Show the branch filter on the FOH Packing screen',
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
                 WHERE r.slug IN ('owner', 'super_admin', 'branchmanager', 'branch_manager', 'brandadmin', 'brand_admin')
                 AND p.name = $1
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
