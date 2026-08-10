import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Online-card payment sessions for the Meezan EPG create-on-confirm flow.
 *
 * Holds one payment attempt: the cart, the amount registered with the bank, and
 * the bank/order linkage. The customer's order row is only created (via the
 * existing OrdersService.createOrder) once the bank confirms payment, so there
 * is no unpaid order anywhere in the system.
 */
export class EpgPaymentSessions1760000000094 implements MigrationInterface {
    name = 'EpgPaymentSessions1760000000094';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS "epg_payment_sessions" (
                "id" SERIAL PRIMARY KEY,
                "public_token" character varying NOT NULL,
                "tenant_id" integer NOT NULL,
                "branch_id" integer NOT NULL,
                "status" character varying NOT NULL DEFAULT 'pending',
                "order_number" character varying NOT NULL,
                "bank_order_id" character varying,
                "form_url" text,
                "amount_minor" bigint NOT NULL,
                "currency" character varying(3) NOT NULL DEFAULT '586',
                "cart" jsonb NOT NULL,
                "customer_id" integer,
                "customer_phone" character varying,
                "idempotency_key" character varying NOT NULL,
                "created_order_group_id" character varying,
                "bank_order_status" smallint,
                "last_polled_at" TIMESTAMP,
                "expires_at" TIMESTAMP NOT NULL,
                "raw_status" jsonb,
                "failure_reason" character varying,
                "created_at" TIMESTAMP NOT NULL DEFAULT now(),
                "updated_at" TIMESTAMP NOT NULL DEFAULT now()
            )
        `);
        // orderNumber is the bank's unique-per-merchant reference — enforce it.
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_epg_sessions_order_number"
            ON "epg_payment_sessions" ("order_number")
        `);
        // public_token is the unguessable app-facing handle — must be unique.
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_epg_sessions_public_token"
            ON "epg_payment_sessions" ("public_token")
        `);
        // The poller sweeps pending sessions by (status, expires_at).
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_epg_sessions_status_expiry"
            ON "epg_payment_sessions" ("status", "expires_at")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `DROP INDEX IF EXISTS "IDX_epg_sessions_status_expiry"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_epg_sessions_public_token"`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_epg_sessions_order_number"`,
        );
        await queryRunner.query(`DROP TABLE IF EXISTS "epg_payment_sessions"`);
    }
}
