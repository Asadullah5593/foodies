import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * kiosk_orders: holds a "pay at counter" cart submitted from the kiosk until a
 * cashier finalizes it into a real order. Separate table → invisible to the
 * orders module / KDS / reports until finalize.
 */
export class KioskOrders1760000000017 implements MigrationInterface {
    name = 'KioskOrders1760000000017';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "kiosk_orders" (
        "id" SERIAL NOT NULL,
        "tenant_id" integer NOT NULL,
        "branch_id" integer NOT NULL,
        "kiosk_code" character varying(8) NOT NULL,
        "code_date" date NOT NULL,
        "status" character varying(16) NOT NULL DEFAULT 'pending',
        "order_type" character varying NOT NULL,
        "payload" jsonb NOT NULL,
        "quote_snapshot" jsonb NULL,
        "snapshot_total" numeric(12,2) NOT NULL DEFAULT 0,
        "customer_name" character varying NULL,
        "customer_phone" character varying NULL,
        "idempotency_key" character varying NULL,
        "finalized_order_group_id" character varying(36) NULL,
        "finalized_by_user_id" integer NULL,
        "finalized_at" TIMESTAMP NULL,
        "expires_at" TIMESTAMP NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_kiosk_orders" PRIMARY KEY ("id"),
        CONSTRAINT "FK_kiosk_orders_tenant" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_kiosk_orders_branch" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE
      )
    `);

        // Only one PENDING record may hold a given code per branch per day.
        // Finalized/expired/cancelled rows free the code for reuse.
        await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_kiosk_active_code"
      ON "kiosk_orders" ("branch_id", "code_date", "kiosk_code")
      WHERE "status" = 'pending'
    `);

        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kiosk_branch_status"
      ON "kiosk_orders" ("branch_id", "status")
    `);

        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_kiosk_expires"
      ON "kiosk_orders" ("expires_at")
      WHERE "status" = 'pending'
    `);

        // Optional idempotency: a non-null key may not repeat for the same branch.
        await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_kiosk_idempotency"
      ON "kiosk_orders" ("branch_id", "idempotency_key")
      WHERE "idempotency_key" IS NOT NULL
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "kiosk_orders"`);
    }
}
