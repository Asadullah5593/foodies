import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `orders:view:own-*` — MARKER permissions (same family as
 * `orders:create:delivery-only`): holding one grants nothing, it narrows
 * `orders:view` to the channels the role may read. Several are additive, so a
 * role can be shaped to any subset of channels; holding none leaves the
 * all-sources view intact.
 *
 * Built for call-centre agents, who work their own phone orders and have no
 * business reading the till's walk-in trade — but assignable to any role from
 * the Roles screen. Granted to NO role here: the client assigns them by hand,
 * and removing one restores the wider view.
 */
export class OwnSourceOnlyOrderPermission1760000000122 implements MigrationInterface {
    name = 'OwnSourceOnlyOrderPermission1760000000122';

    private readonly permissions = [
        {
            name: 'orders:view:own-source-only',
            action: 'view:own-source-only',
            description:
                'Sees only orders of their own channel (call-centre agents: call-centre orders; everyone else: POS orders)',
        },
        {
            name: 'orders:view:own-pos-only',
            action: 'view:own-pos-only',
            description: 'Sees only POS orders in order history',
        },
        {
            name: 'orders:view:own-mobile-app-only',
            action: 'view:own-mobile-app-only',
            description: 'Sees only mobile-app orders in order history',
        },
        {
            name: 'orders:view:own-kiosk-only',
            action: 'view:own-kiosk-only',
            description: 'Sees only kiosk orders in order history',
        },
    ];

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const p of this.permissions) {
            await queryRunner.query(
                `INSERT INTO permissions (name, resource, action, description)
                 VALUES ($1, 'orders', $2, $3)
                 ON CONFLICT (name) DO NOTHING`,
                [p.name, p.action, p.description],
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DELETE FROM permissions WHERE name = ANY($1::text[])`,
            [this.permissions.map((p) => p.name)],
        );
    }
}
