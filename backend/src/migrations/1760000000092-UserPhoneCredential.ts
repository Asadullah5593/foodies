import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Makes `users.phone` a login credential (riders sign in with phone + password
 * rather than email), which requires it to be unambiguous.
 *
 *  1. Normalises every stored number to the canonical 03XXXXXXXXX form used by
 *     `normalizePakistaniPhone`, so lookups match regardless of how the number
 *     was typed (+92…, spaces, dashes).
 *  2. Blanks anything that is not a recognisable Pakistani mobile — a value that
 *     cannot be normalised could never be logged in with anyway, and leaving it
 *     would break the unique index below.
 *  3. Adds a partial unique index. Partial because most staff have no phone at
 *     all: NULLs are already exempt from a UNIQUE index in Postgres, but the
 *     explicit predicate also excludes empty strings.
 *
 * Existing riders created before this migration may have no phone on file; they
 * keep working via email until an admin sets one (see requireRiderPhones).
 */
export class UserPhoneCredential1760000000092 implements MigrationInterface {
    name = 'UserPhoneCredential1760000000092';

    public async up(queryRunner: QueryRunner): Promise<void> {
        // Canonicalise: strip non-digits, then fold 3XXXXXXXXX / 923XXXXXXXXX
        // into 03XXXXXXXXX.
        await queryRunner.query(`
            UPDATE users
            SET phone = CASE
                WHEN length(regexp_replace(phone, '\\D', '', 'g')) = 10
                     AND regexp_replace(phone, '\\D', '', 'g') LIKE '3%'
                    THEN '0' || regexp_replace(phone, '\\D', '', 'g')
                WHEN length(regexp_replace(phone, '\\D', '', 'g')) = 11
                     AND regexp_replace(phone, '\\D', '', 'g') LIKE '03%'
                    THEN regexp_replace(phone, '\\D', '', 'g')
                WHEN length(regexp_replace(phone, '\\D', '', 'g')) = 12
                     AND regexp_replace(phone, '\\D', '', 'g') LIKE '923%'
                    THEN '0' || substring(regexp_replace(phone, '\\D', '', 'g') from 3)
                ELSE NULL
            END
            WHERE phone IS NOT NULL AND trim(phone) <> ''
        `);

        // Any duplicates left after normalisation would fail the index. Keep the
        // lowest user id and clear the rest so the migration cannot wedge; an
        // admin then re-enters the correct number for the affected accounts.
        await queryRunner.query(`
            UPDATE users u
            SET phone = NULL
            WHERE u.phone IS NOT NULL
              AND EXISTS (
                  SELECT 1 FROM users other
                  WHERE other.phone = u.phone AND other.id < u.id
              )
        `);

        await queryRunner.query(`
            CREATE UNIQUE INDEX IF NOT EXISTS "UQ_users_phone"
            ON users (phone)
            WHERE phone IS NOT NULL AND phone <> ''
        `);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP INDEX IF EXISTS "UQ_users_phone"`);
    }
}
