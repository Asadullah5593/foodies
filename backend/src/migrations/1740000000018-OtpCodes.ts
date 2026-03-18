import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * OTP codes for forgot password and verify OTP (consumer app).
 */
export class OtpCodes1740000000018 implements MigrationInterface {
    name = 'OtpCodes1740000000018';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "otp_codes" (
        "id" SERIAL NOT NULL,
        "email" character varying NOT NULL,
        "code" character varying(10) NOT NULL,
        "purpose" character varying(32) NOT NULL DEFAULT 'password_reset',
        "expires_at" TIMESTAMP NOT NULL,
        "used_at" TIMESTAMP NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_otp_codes" PRIMARY KEY ("id")
      )
    `);
        await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_otp_codes_email_purpose"
      ON "otp_codes" ("email", "purpose")
    `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS "otp_codes"`);
    }
}
