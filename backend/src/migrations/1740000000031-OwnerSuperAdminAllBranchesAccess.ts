import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Assign all-branches:access to Owner and Super Admin so they can see and manage
 * all branch users (otherwise allowedBranchIds is empty and the list is blank).
 */
export class OwnerSuperAdminAllBranchesAccess1740000000031 implements MigrationInterface {
    name = 'OwnerSuperAdminAllBranchesAccess1740000000031';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug IN ('owner', 'super_admin')
             AND p.name = 'all-branches:access'
             AND NOT EXISTS (
                 SELECT 1 FROM role_permissions rp
                 WHERE rp.role_id = r.id AND rp.permission_id = p.id
             )`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM role_permissions
             WHERE permission_id = (SELECT id FROM permissions WHERE name = 'all-branches:access')
             AND role_id IN (SELECT id FROM roles WHERE slug IN ('owner', 'super_admin'))`,
        );
    }
}
