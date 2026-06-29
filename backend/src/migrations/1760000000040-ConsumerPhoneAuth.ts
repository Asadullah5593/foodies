import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Consumer phone+password auth + SMS OTP:
 * - `customers.phone_verified`        — set true once an SMS OTP proves ownership
 * - partial unique index on consumer phone (tenant_id IS NULL) so phone is a
 *   reliable login identifier for app/web customers (POS/tenant rows keep their
 *   own (tenant_id, phone) uniqueness handled in app code)
 * - `otp_codes.phone` + nullable `email` so the existing email password-reset
 *   flow keeps working while phone OTPs (verification / reset) are added
 *
 * Safety: the partial unique index fails if two consumer rows share a phone, so
 * this migration ABORTS with a clear message if duplicates exist rather than
 * destroying data. Resolve duplicates first (see the SELECT in the RAISE text).
 */
export class ConsumerPhoneAuth1760000000040 implements MigrationInterface {
    name = 'ConsumerPhoneAuth1760000000040';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // 1. phone_verified flag on customers
        await queryRunner.query(`
            ALTER TABLE "customers"
                ADD COLUMN IF NOT EXISTS "phone_verified" boolean NOT NULL DEFAULT false
        `);

        // 2. Fail loud if duplicate consumer phones would break the unique index.
        await queryRunner.query(`
            DO $$
            DECLARE dup integer;
            BEGIN
                SELECT COUNT(*) INTO dup FROM (
                    SELECT phone FROM customers
                    WHERE tenant_id IS NULL
                    GROUP BY phone HAVING COUNT(*) > 1
                ) d;
                IF dup > 0 THEN
                    RAISE EXCEPTION 'Cannot create consumer phone unique index: % duplicate consumer phone(s) (tenant_id IS NULL). Resolve them first: SELECT phone, COUNT(*) FROM customers WHERE tenant_id IS NULL GROUP BY phone HAVING COUNT(*) > 1;', dup;
                END IF;
            END $$;
        `);

        // 3. Partial unique index: one consumer account per phone.
        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_customers_consumer_phone"
                ON "customers" ("phone")
                WHERE "tenant_id" IS NULL
        `);

        // 4. Generalize otp_codes to carry a phone identifier alongside email.
        await queryRunner.query(
            `ALTER TABLE "otp_codes" ALTER COLUMN "email" DROP NOT NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "otp_codes" ADD COLUMN IF NOT EXISTS "phone" varchar`,
        );
        await queryRunner.query(`
            DO $$
            BEGIN
                IF NOT EXISTS (
                    SELECT 1 FROM pg_constraint WHERE conname = 'CHK_otp_identifier'
                ) THEN
                    ALTER TABLE "otp_codes"
                        ADD CONSTRAINT "CHK_otp_identifier"
                        CHECK ("email" IS NOT NULL OR "phone" IS NOT NULL);
                END IF;
            END $$;
        `);
        await queryRunner.query(`
            CREATE INDEX IF NOT EXISTS "IDX_otp_phone_purpose"
                ON "otp_codes" ("phone", "purpose")
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "IDX_otp_phone_purpose"`);
        await queryRunner.query(
            `ALTER TABLE "otp_codes" DROP CONSTRAINT IF EXISTS "CHK_otp_identifier"`,
        );
        await queryRunner.query(
            `ALTER TABLE "otp_codes" DROP COLUMN IF EXISTS "phone"`,
        );
        // Restore email NOT NULL (drop phone-only rows that would violate it).
        await queryRunner.query(
            `DELETE FROM "otp_codes" WHERE "email" IS NULL`,
        );
        await queryRunner.query(
            `ALTER TABLE "otp_codes" ALTER COLUMN "email" SET NOT NULL`,
        );
        await queryRunner.query(
            `DROP INDEX IF EXISTS "UQ_customers_consumer_phone"`,
        );
        await queryRunner.query(
            `ALTER TABLE "customers" DROP COLUMN IF EXISTS "phone_verified"`,
        );
    }
}
