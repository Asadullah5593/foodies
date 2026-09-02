import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `orders:customer-addresses:view` — lets an order taker pull up the addresses
 * a phone number has had deliveries to, and pick one instead of typing it out
 * again. Built for call-centre agents and delivery managers, who take the same
 * regulars' orders over and over.
 *
 * It is a genuine capability, not one of the marker permissions that narrow
 * `orders:create`, so it is NOT listed in restriction-permissions.ts and a
 * fresh seed hands it to Owner and Super Admin with everything else.
 *
 * Granted to NO role here. Typing any complete number reveals where that person
 * lives, so who carries it is the client's decision to make from the Roles
 * screen, not something a migration should settle for them.
 *
 * The action sorts immediately after the `create:*` block, so it appears in the
 * Orders tab directly below "May place delivery orders only…" — the Roles
 * screen orders by resource then action.
 */
export class CustomerAddressLookupPermission1760000000128 implements MigrationInterface {
    name = 'CustomerAddressLookupPermission1760000000128';

    private readonly permission = {
        name: 'orders:customer-addresses:view',
        resource: 'orders',
        action: 'customer-addresses:view',
        description:
            "May look up a customer's saved delivery addresses by phone number and pick one for the order",
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
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DELETE FROM permissions WHERE name = $1`, [
            this.permission.name,
        ]);
    }
}
