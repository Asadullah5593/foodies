import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Brute-force backstop for OTP verification: a per-code failed-attempt counter.
 * verifyForPhone now atomically increments it (UPDATE ... SET attempts = attempts + 1
 * RETURNING) and burns the code once the cap is exceeded, so an attacker firing
 * concurrent guesses at a 6-digit code cannot outrun the limiter (each concurrent
 * guess gets a distinct, serialised count).
 */
export class OtpAttemptLimiter1760000000065 implements MigrationInterface {
    name = 'OtpAttemptLimiter1760000000065';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE otp_codes ADD COLUMN IF NOT EXISTS attempts integer NOT NULL DEFAULT 0`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(
            `ALTER TABLE otp_codes DROP COLUMN IF EXISTS attempts`,
        );
    }
}
