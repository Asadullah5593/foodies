import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Supervisor shift override. Closing a shift is now opener-only (the drawer
 * belongs to whoever counted it open); `shifts:override` lets a supervisor
 * close shifts opened by other users AND open a shift without being
 * brand-locked staff (picking any brand served at the branch). It implies
 * shifts:view/open/close at runtime (permission-implications.ts) but is NOT
 * implied by the shifts:manage umbrella — cashiers with the umbrella stay
 * opener-only.
 *
 * Granted to the owner/admin and manager roles (every live and seed slug
 * spelling) so managers keep their existing ability to close any shift.
 * Brand admins are included: their brand lock still scopes them to their own
 * brand's shifts. Grant to further roles from the Roles UI.
 */
export class ShiftsOverridePermission1760000000097 implements MigrationInterface {
    name = 'ShiftsOverridePermission1760000000097';

    private readonly permission = {
        name: 'shifts:override',
        resource: 'shifts',
        action: 'override',
        description:
            'Open a shift for any brand and close shifts opened by other users (closing is otherwise opener-only)',
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
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT r.id, p.id FROM roles r
             CROSS JOIN permissions p
             WHERE r.slug IN (
                 'owner', 'super_admin',
                 'general_manager', 'generalmanager',
                 'branch_manager', 'branchmanager', 'pos_branch_manager',
                 'brand_admin', 'brandadmin'
             )
               AND p.name = $1
               AND NOT EXISTS (
                   SELECT 1 FROM role_permissions rp
                   WHERE rp.role_id = r.id AND rp.permission_id = p.id
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
