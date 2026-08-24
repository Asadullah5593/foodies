import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../entities/app-config.entity';

/** The wire shape the mobile apps consume (snake_case, stable). */
export interface AppConfigResponse {
    force_update_android: boolean;
    force_update_ios: boolean;
    min_required_version_android: string;
    min_required_version_ios: string;
    update_message: string;
    store_url_android: string;
    store_url_ios: string;
}

/**
 * Fail-open defaults. Force-update is a lock on the customer's app, so every
 * path that is not a deliberate "yes" — missing row, unreachable database —
 * must answer "no": a database blip must never brick every phone at once.
 */
export const APP_CONFIG_DEFAULTS: AppConfigResponse = {
    force_update_android: false,
    force_update_ios: false,
    min_required_version_android: '1.0.0',
    min_required_version_ios: '1.0.0',
    update_message:
        'A new version of Foodies is available. Please update to continue.',
    store_url_android:
        'https://play.google.com/store/apps/details?id=com.rex.technologies.foodiespk',
    store_url_ios: 'https://apps.apple.com/app/foodies/id6769331907',
};

@Injectable()
export class AppConfigService {
    private readonly logger = new Logger(AppConfigService.name);

    constructor(
        @InjectRepository(AppConfig)
        private readonly repo: Repository<AppConfig>,
    ) {}

    /** Never throws — see APP_CONFIG_DEFAULTS. */
    async getPublicConfig(): Promise<AppConfigResponse> {
        try {
            const row = await this.repo.findOne({ where: { id: 1 } });
            if (!row) {
                this.logger.warn(
                    'app_config row id=1 is missing — serving safe defaults',
                );
                return { ...APP_CONFIG_DEFAULTS };
            }
            return {
                force_update_android: row.forceUpdateAndroid === true,
                force_update_ios: row.forceUpdateIos === true,
                min_required_version_android:
                    row.minRequiredVersionAndroid ??
                    APP_CONFIG_DEFAULTS.min_required_version_android,
                min_required_version_ios:
                    row.minRequiredVersionIos ??
                    APP_CONFIG_DEFAULTS.min_required_version_ios,
                update_message:
                    row.updateMessage ?? APP_CONFIG_DEFAULTS.update_message,
                store_url_android:
                    row.storeUrlAndroid ??
                    APP_CONFIG_DEFAULTS.store_url_android,
                store_url_ios:
                    row.storeUrlIos ?? APP_CONFIG_DEFAULTS.store_url_ios,
            };
        } catch (err) {
            this.logger.error(
                `app_config read failed, serving safe defaults: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return { ...APP_CONFIG_DEFAULTS };
        }
    }
}
