import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Till staff must not see or edit rider salary data. The granular-permission
 * backfill (1760000000090, mirrored in seed.ts) granted the rider-HRM family
 * to every role holding the legacy `shifts:manage` / `deliveries:view` — which
 * swept in the demo cashier role (`cashier` holds shifts:manage for POS
 * access). That was invisible while the Rider HRM nav was hidden; with the
 * Rider profiles page restored to the sidebar it exposed base salaries to
 * cashiers. Revoke the family from till roles; managers/owner keep it.
 */
export class RevokeRiderHrmFromTillRoles1760000000098
    implements MigrationInterface
{
    name = 'RevokeRiderHrmFromTillRoles1760000000098';

    private readonly tillRoleSlugs = [
        'cashier',
        'pos_cashier',
        'call_centre_agent',
        'call_center_agent',
    ];

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
               AND r.slug = ANY($1::text[])
               AND p.name = ANY($2::text[])`,
            [this.tillRoleSlugs, this.riderHrmPerms],
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        // Restore the backfill's effect for the till roles that hold the
        // legacy source permissions (mirrors 1760000000090's keying).
        await queryRunner.query(
            `INSERT INTO role_permissions (role_id, permission_id)
             SELECT DISTINCT r.id, np.id
             FROM roles r
             INNER JOIN role_permissions rp ON rp.role_id = r.id
             INNER JOIN permissions lp ON lp.id = rp.permission_id
                 AND lp.name IN ('deliveries:view', 'shifts:manage')
             CROSS JOIN permissions np
             WHERE r.slug = ANY($1::text[])
               AND np.name = ANY($2::text[])
               AND NOT EXISTS (
                   SELECT 1 FROM role_permissions rp2
                   WHERE rp2.role_id = r.id AND rp2.permission_id = np.id
               )`,
            [
                this.tillRoleSlugs,
                this.riderHrmPerms.filter(
                    (p) => p !== 'rider-supervisor:view',
                ),
            ],
        );
    }
}
