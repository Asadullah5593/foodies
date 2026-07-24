import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Read-only "Rider supervisor" permission. Gates the single supervisor
 * sub-module under Rider HRM (recent delivery orders, live rider roster with
 * attendance + base salary). Standalone — not implied by any umbrella — so it
 * can be assigned on its own to a limited role (e.g. a branch delivery
 * manager). Granted here to Owner, Super Admin and General Manager (both
 * live-DB and seed slug spellings); assign to any other role from the Roles UI.
 */
export class RiderSupervisorPermission1760000000095 implements MigrationInterface {
    name = 'RiderSupervisorPermission1760000000095';

    private readonly permission = {
        name: 'rider-supervisor:view',
        resource: 'rider-supervisor',
        action: 'view',
        description:
            'View the read-only rider supervisor dashboard (recent delivery orders, rider roster, attendance and base salary)',
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
             WHERE r.slug IN ('owner', 'super_admin', 'general_manager', 'generalmanager')
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
