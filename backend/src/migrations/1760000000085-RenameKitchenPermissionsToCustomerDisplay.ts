import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * There is no module named "Kitchen Display" — the screens are Back Kitchen,
 * FOH Packing and Customer Display. kitchen:view / kitchen:update actually
 * gate the Customer Display route, the FOH Packing route and the kitchen
 * order APIs, so rename them to customer-display:* IN PLACE. role_permissions
 * references permissions by id, so every role keeps exactly the access it
 * has today — this changes the name only. Guarded so a database already
 * seeded with the new names is left alone.
 */
export class RenameKitchenPermissionsToCustomerDisplay1760000000085 implements MigrationInterface {
    name = 'RenameKitchenPermissionsToCustomerDisplay1760000000085';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE permissions
             SET name = 'customer-display:view', resource = 'customer-display',
                 description = 'View the Customer Display (live order board) and kitchen order feeds'
             WHERE name = 'kitchen:view'
             AND NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'customer-display:view')`,
        );
        await queryRunner.query(
            `UPDATE permissions
             SET name = 'customer-display:update', resource = 'customer-display',
                 description = 'Update order status from the Customer Display / FOH screens'
             WHERE name = 'kitchen:update'
             AND NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'customer-display:update')`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `UPDATE permissions
             SET name = 'kitchen:view', resource = 'kitchen',
                 description = 'View kitchen orders'
             WHERE name = 'customer-display:view'
             AND NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'kitchen:view')`,
        );
        await queryRunner.query(
            `UPDATE permissions
             SET name = 'kitchen:update', resource = 'kitchen',
                 description = 'Update kitchen order status'
             WHERE name = 'customer-display:update'
             AND NOT EXISTS (SELECT 1 FROM permissions WHERE name = 'kitchen:update')`,
        );
    }
}
