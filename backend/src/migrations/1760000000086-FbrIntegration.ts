import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * FBR (Federal Board of Revenue) POS fiscalization.
 *
 * Branches carry their own FBR registration — exactly ONE POS ID + token per
 * physical branch regardless of how many brands trade inside it. Orders store
 * the fiscal invoice number FBR returned, plus where it came from:
 * 'fbr' = returned live by FBR for this order; 'fallback' = the branch's most
 * recent real number reused because FBR was disabled or unreachable (business
 * decision: the sale must never block on FBR).
 */
export class FbrIntegration1760000000086 implements MigrationInterface {
    name = 'FbrIntegration1760000000086';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE branches ADD COLUMN IF NOT EXISTS fbr_enabled boolean NOT NULL DEFAULT false`,
        );
        await queryRunner.query(
            `ALTER TABLE branches ADD COLUMN IF NOT EXISTS fbr_pos_id varchar NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE branches ADD COLUMN IF NOT EXISTS fbr_token text NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE branches ADD COLUMN IF NOT EXISTS fbr_environment varchar NOT NULL DEFAULT 'sandbox'`,
        );
        await queryRunner.query(
            `ALTER TABLE branches ADD COLUMN IF NOT EXISTS fbr_pct_code varchar NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE orders ADD COLUMN IF NOT EXISTS fbr_invoice_number varchar NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE orders ADD COLUMN IF NOT EXISTS fbr_number_source varchar(8) NULL`,
        );
        // The fallback lookup is "latest REAL number for this branch" — a hot
        // path on every order when FBR is off/down, so give it a partial index.
        await queryRunner.query(
            `CREATE INDEX IF NOT EXISTS "IDX_orders_branch_fbr_real" ON orders (branch_id, id DESC) WHERE fbr_number_source = 'fbr'`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_orders_branch_fbr_real"`,
        );
        await queryRunner.query(
            `ALTER TABLE orders DROP COLUMN IF EXISTS fbr_number_source`,
        );
        await queryRunner.query(
            `ALTER TABLE orders DROP COLUMN IF EXISTS fbr_invoice_number`,
        );
        await queryRunner.query(
            `ALTER TABLE branches DROP COLUMN IF EXISTS fbr_pct_code`,
        );
        await queryRunner.query(
            `ALTER TABLE branches DROP COLUMN IF EXISTS fbr_environment`,
        );
        await queryRunner.query(
            `ALTER TABLE branches DROP COLUMN IF EXISTS fbr_token`,
        );
        await queryRunner.query(
            `ALTER TABLE branches DROP COLUMN IF EXISTS fbr_pos_id`,
        );
        await queryRunner.query(
            `ALTER TABLE branches DROP COLUMN IF EXISTS fbr_enabled`,
        );
    }
}
