import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Single-row config the mobile apps poll on launch to decide whether the
 * installed build must be updated before it is allowed to continue.
 *
 * One row, id = 1, seeded with force-update OFF: the table existing must never
 * be what locks users out — someone has to flip the flag deliberately.
 */
export class AppConfig1760000000121 implements MigrationInterface {
    name = 'AppConfig1760000000121';

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`SET LOCAL lock_timeout = '3s'`);
        await queryRunner.query(`
            CREATE TABLE IF NOT EXISTS app_config (
                id integer PRIMARY KEY DEFAULT 1,
                force_update_android boolean NOT NULL DEFAULT false,
                force_update_ios boolean NOT NULL DEFAULT false,
                min_required_version_android character varying(20) NOT NULL DEFAULT '1.0.0',
                min_required_version_ios character varying(20) NOT NULL DEFAULT '1.0.0',
                update_message text,
                store_url_android text,
                store_url_ios text,
                updated_at timestamptz NOT NULL DEFAULT now(),
                CONSTRAINT "CHK_app_config_singleton" CHECK (id = 1)
            )
        `);
        await queryRunner.query(
            `INSERT INTO app_config (
                id, force_update_android, force_update_ios,
                min_required_version_android, min_required_version_ios,
                update_message, store_url_android, store_url_ios
             ) VALUES (
                1, false, false, '1.0.0', '1.0.0',
                'A new version of Foodies is available. Please update to continue.',
                'https://play.google.com/store/apps/details?id=com.rex.technologies.foodiespk',
                'https://apps.apple.com/app/foodies/id6769331907'
             )
             ON CONFLICT (id) DO NOTHING`,
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`DROP TABLE IF EXISTS app_config`);
    }
}
