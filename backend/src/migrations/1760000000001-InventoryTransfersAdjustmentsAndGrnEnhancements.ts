import { MigrationInterface, QueryRunner } from 'typeorm';

export class InventoryTransfersAdjustmentsAndGrnEnhancements1760000000001 implements MigrationInterface {
    name = 'InventoryTransfersAdjustmentsAndGrnEnhancements1760000000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            ALTER TABLE goods_receipt_note_lines
            ADD COLUMN IF NOT EXISTS accepted_qty numeric(18,6),
            ADD COLUMN IF NOT EXISTS rejected_qty numeric(18,6),
            ADD COLUMN IF NOT EXISTS rejection_reason text,
            ADD COLUMN IF NOT EXISTS is_over_received boolean NOT NULL DEFAULT false,
            ADD COLUMN IF NOT EXISTS is_mismatched_item boolean NOT NULL DEFAULT false
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS inventory_transfer_requests (
                id SERIAL PRIMARY KEY,
                tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                source_branch_id integer NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
                destination_branch_id integer NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
                status character varying NOT NULL DEFAULT 'submitted',
                notes text,
                approved_by integer REFERENCES users(id) ON DELETE SET NULL,
                approved_at timestamp,
                created_by integer REFERENCES users(id) ON DELETE SET NULL,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS IDX_itr_tenant_status
            ON inventory_transfer_requests (tenant_id, status)
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS inventory_transfer_request_lines (
                id SERIAL PRIMARY KEY,
                transfer_request_id integer NOT NULL REFERENCES inventory_transfer_requests(id) ON DELETE CASCADE,
                inventory_item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
                requested_qty numeric(18,6) NOT NULL,
                requested_uom_id integer NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
                notes text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS IDX_itrl_request
            ON inventory_transfer_request_lines (transfer_request_id)
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS inventory_transfer_orders (
                id SERIAL PRIMARY KEY,
                tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                transfer_request_id integer NOT NULL REFERENCES inventory_transfer_requests(id) ON DELETE CASCADE,
                source_branch_id integer NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
                destination_branch_id integer NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
                status character varying NOT NULL DEFAULT 'approved',
                dispatched_at timestamp,
                dispatched_by integer REFERENCES users(id) ON DELETE SET NULL,
                notes text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS IDX_ito_tenant_status
            ON inventory_transfer_orders (tenant_id, status)
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS inventory_transfer_receipts (
                id SERIAL PRIMARY KEY,
                tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                transfer_order_id integer NOT NULL REFERENCES inventory_transfer_orders(id) ON DELETE CASCADE,
                status character varying NOT NULL DEFAULT 'posted',
                notes text,
                posted_at timestamp,
                posted_by integer REFERENCES users(id) ON DELETE SET NULL,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS IDX_itrp_order
            ON inventory_transfer_receipts (transfer_order_id)
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS inventory_transfer_receipt_lines (
                id SERIAL PRIMARY KEY,
                transfer_receipt_id integer NOT NULL REFERENCES inventory_transfer_receipts(id) ON DELETE CASCADE,
                inventory_item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
                received_qty numeric(18,6) NOT NULL,
                received_uom_id integer NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
                location_id integer REFERENCES inventory_locations(id) ON DELETE SET NULL,
                notes text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS IDX_itrpl_receipt
            ON inventory_transfer_receipt_lines (transfer_receipt_id)
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS inventory_adjustments (
                id SERIAL PRIMARY KEY,
                tenant_id integer NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
                branch_id integer NOT NULL REFERENCES branches(id) ON DELETE CASCADE,
                adjustment_type character varying NOT NULL,
                status character varying NOT NULL DEFAULT 'draft',
                reason_code character varying NOT NULL,
                notes text,
                created_by integer REFERENCES users(id) ON DELETE SET NULL,
                posted_by integer REFERENCES users(id) ON DELETE SET NULL,
                posted_at timestamp,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS IDX_ia_tenant_branch_status
            ON inventory_adjustments (tenant_id, branch_id, status)
        `);

        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS inventory_adjustment_lines (
                id SERIAL PRIMARY KEY,
                inventory_adjustment_id integer NOT NULL REFERENCES inventory_adjustments(id) ON DELETE CASCADE,
                inventory_item_id integer NOT NULL REFERENCES inventory_items(id) ON DELETE RESTRICT,
                qty numeric(18,6) NOT NULL,
                qty_uom_id integer NOT NULL REFERENCES uoms(id) ON DELETE RESTRICT,
                location_id integer REFERENCES inventory_locations(id) ON DELETE SET NULL,
                inventory_batch_id integer REFERENCES inventory_batches(id) ON DELETE SET NULL,
                notes text,
                created_at timestamp NOT NULL DEFAULT now(),
                updated_at timestamp NOT NULL DEFAULT now()
            )
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS IDX_ial_adjustment
            ON inventory_adjustment_lines (inventory_adjustment_id)
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP TABLE IF EXISTS inventory_adjustment_lines`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS inventory_adjustments`);
        await queryRunner.query(
            `DROP TABLE IF EXISTS inventory_transfer_receipt_lines`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS inventory_transfer_receipts`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS inventory_transfer_orders`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS inventory_transfer_request_lines`,
        );
        await queryRunner.query(
            `DROP TABLE IF EXISTS inventory_transfer_requests`,
        );

        await queryRunner.query(
            `ALTER TABLE goods_receipt_note_lines
             DROP COLUMN IF EXISTS accepted_qty,
             DROP COLUMN IF EXISTS rejected_qty,
             DROP COLUMN IF EXISTS rejection_reason,
             DROP COLUMN IF EXISTS is_over_received,
             DROP COLUMN IF EXISTS is_mismatched_item`,
        );
    }
}
