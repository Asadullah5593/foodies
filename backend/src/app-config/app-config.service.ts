import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AppConfig } from '../entities/app-config.entity';

/** Which store a generic-key client should be sent to, when it says so. */
export type ClientPlatform = 'android' | 'ios';

/** Per-platform values — the canonical fields every current build reads. */
export interface AppConfigPlatformValues {
    force_update_android: boolean;
    force_update_ios: boolean;
    min_required_version_android: string;
    min_required_version_ios: string;
    update_message: string;
    store_url_android: string;
    store_url_ios: string;
}

/**
 * The wire shape (snake_case, stable). The three unsuffixed keys exist only for
 * builds shipped before the per-platform keys did (v1.2.3 / build 125) — they
 * are derived, never stored, and new clients must read the suffixed keys.
 */
export interface AppConfigResponse extends AppConfigPlatformValues {
    force_update: boolean;
    min_required_version: string;
    store_url: string;
}

/**
 * Fail-open defaults. Force-update is a lock on the customer's app, so every
 * path that is not a deliberate "yes" — missing row, unreachable database —
 * must answer "no": a database blip must never brick every phone at once.
 */
export const APP_CONFIG_DEFAULTS: AppConfigPlatformValues = {
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

/**
 * Add the legacy unsuffixed keys a pre-per-platform build reads.
 *
 * With `platform` known the answer is exact. Without it the request carries
 * nothing that identifies the store the caller came from, so it falls back to
 * iOS-then-Android as the mobile team specified — which means a legacy ANDROID
 * build reads the iOS flag, version and store URL. Pass `?platform=` (or ship a
 * build that reads the suffixed keys) to avoid that.
 */
export function withGenericKeys(
    v: AppConfigPlatformValues,
    platform?: ClientPlatform,
): AppConfigResponse {
    const generic =
        platform === 'android'
            ? {
                  force_update: v.force_update_android,
                  min_required_version: v.min_required_version_android,
                  store_url: v.store_url_android,
              }
            : platform === 'ios'
              ? {
                    force_update: v.force_update_ios,
                    min_required_version: v.min_required_version_ios,
                    store_url: v.store_url_ios,
                }
              : {
                    force_update: v.force_update_ios || v.force_update_android,
                    min_required_version:
                        v.min_required_version_ios ||
                        v.min_required_version_android,
                    store_url: v.store_url_ios || v.store_url_android,
                };
    return { ...generic, ...v };
}

@Injectable()
export class AppConfigService {
    private readonly logger = new Logger(AppConfigService.name);

    constructor(
        @InjectRepository(AppConfig)
        private readonly repo: Repository<AppConfig>,
    ) {}

    /** Never throws — see APP_CONFIG_DEFAULTS. */
    async getPublicConfig(
        platform?: ClientPlatform,
    ): Promise<AppConfigResponse> {
        try {
            const row = await this.repo.findOne({ where: { id: 1 } });
            if (!row) {
                this.logger.warn(
                    'app_config row id=1 is missing — serving safe defaults',
                );
                return withGenericKeys(APP_CONFIG_DEFAULTS, platform);
            }
            return withGenericKeys(
                {
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
                },
                platform,
            );
        } catch (err) {
            this.logger.error(
                `app_config read failed, serving safe defaults: ${
                    err instanceof Error ? err.message : String(err)
                }`,
            );
            return withGenericKeys(APP_CONFIG_DEFAULTS, platform);
        }
    }
}
