import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Splits order status out of the rider-supervisor surface into its own
 * permission, so a supervisor can be limited to delivery logistics (rider,
 * branch, customer, when) without seeing how each order is progressing. It
 * gates the Status column, the status filter pills and the per-bucket counts;
 * the server omits the data, not just the UI.
 *
 * Granted here to every role that already holds `rider-supervisor:view` so the
 * column stays exactly as it is today — revoke it per role from the Roles UI to
 * hide status. Deliberately NOT implied by `rider-supervisor:view`: an
 * implication would make it impossible to revoke.
 */
export class RiderSupervisorViewStatus1760000000101 implements MigrationInterface {
    name = 'RiderSupervisorViewStatus1760000000101';

    private readonly permission = {
        name: 'rider-supervisor:view-status',
        resource: 'rider-supervisor',
        action: 'view-status',
        description:
            'See order status on the rider supervisor dashboard (Status column, status filters and counts)',
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
        // Every current holder of rider-supervisor:view keeps the status column.
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT DISTINCT rp.role_id, np.id
             FROM role_permissions rp
             INNER JOIN permissions lp
                 ON lp.id = rp.permission_id AND lp.name = 'rider-supervisor:view'
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
