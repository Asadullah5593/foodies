import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Business setting: auto-print the customer + kitchen invoices on the terminal
 * as soon as an order is placed. Off by default so nothing changes until a
 * tenant turns it on in Business Settings.
 */
export class TenantAutoPrintInvoices1760000000084 implements MigrationInterface {
    name = 'TenantAutoPrintInvoices1760000000084';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS auto_print_invoices boolean NOT NULL DEFAULT false`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE tenants DROP COLUMN IF EXISTS auto_print_invoices`,
        );
    }
}
