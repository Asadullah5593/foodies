import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Marker permission that flags a user as a call-centre agent. Call-centre agents
 * take orders through the same POS API as walk-in cashiers, so we can't tell
 * their orders apart from who's placing them alone — this permission is the
 * signal: PosOrdersController tags orders from a holder as source=call_centre
 * instead of `pos`. That surfaces them as a distinct "Call centre" source in the
 * Orders module AND makes the till chime for them (walk-in `pos` orders are the
 * only source skipped by the new-order notification).
 *
 * Granted here to the seeded Call Centre Agent role (both plausible slug
 * spellings). Standalone — not implied by any umbrella — so it can also be
 * assigned to any other role from the Roles UI.
 */
export class CallCentreOrderSource1760000000096 implements MigrationInterface {
    name = 'CallCentreOrderSource1760000000096';

    private readonly permission = {
        name: 'orders:place:call-center',
        resource: 'orders',
        action: 'place:call-center',
        description:
            'Take orders on behalf of customers (call centre); tags orders as source=call_centre and alerts the till',
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
             WHERE r.slug IN ('call_centre_agent', 'call_center_agent', 'callcentreagent', 'callcenteragent')
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
