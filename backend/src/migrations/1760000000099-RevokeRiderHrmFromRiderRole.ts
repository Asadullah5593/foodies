import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Companion to 1760000000098-RevokeRiderHrmFromTillRoles: the `rider` role
 * itself also picked up the rider-HRM family (incl. rider-profiles:edit) from
 * the deliveries:view-keyed backfill. Dormant today — RoleAccessGuard hard
 * blocks isRider users from every admin path — but a future rider-hrm endpoint
 * guarded only by RequirePermissionGuard would let a rider read every salary
 * and edit their own. Revoke; riders never need HR-admin permissions.
 * (Separate migration because 098 has already run on live DBs.)
 */
export class RevokeRiderHrmFromRiderRole1760000000099
    implements MigrationInterface
{
    name = 'RevokeRiderHrmFromRiderRole1760000000099';

    private readonly riderHrmPerms = [
        'rider-hrm:view',
        'rider-profiles:edit',
        'rider-payroll:run',
        'rider-payroll:reverse',
        'rider-comp-plans:view',
        'rider-comp-plans:create',
        'rider-comp-plans:edit',
        'rider-comp-plans:activate',
        'rider-attendance:manage',
        'rider-supervisor:view',
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM role_permissions rp
             USING roles r, permissions p
             WHERE rp.role_id = r.id
               AND rp.permission_id = p.id
               AND r.slug = 'rider'
               AND p.name = ANY($1::text[])`,
            [this.riderHrmPerms],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Restore the backfill's effect (keyed on the legacy sources).
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT DISTINCT r.id, np.id
             FROM roles r
             INNER JOIN role_permissions rp ON rp.role_id = r.id
             INNER JOIN permissions lp ON lp.id = rp.permission_id
                 AND lp.name IN ('deliveries:view', 'shifts:manage')
             CROSS JOIN permissions np
             WHERE r.slug = 'rider'
               AND np.name = ANY($1::text[])
               AND NOT EXISTS (
                   SELECT 1 FROM role_permissions rp2
                   WHERE rp2.role_id = r.id AND rp2.permission_id = np.id
               )`,
            [
                this.riderHrmPerms.filter(
                    (p) => p !== 'rider-supervisor:view',
                ),
            ],
        );
    }
}
