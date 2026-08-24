import { AppConfigService, APP_CONFIG_DEFAULTS } from './app-config.service';
import { AppConfig } from '../entities/app-config.entity';
import { AppConfigController } from './app-config.controller';

/**
 * The endpoint is a lock on every customer's app, so the only thing it must
 * never do is fail closed: a missing row or an unreachable database has to
 * answer "no force update" rather than error.
 */
describe('AppConfigService', () => {
    const make = (findOne: jest.Mock) =>
        new AppConfigService({ findOne } as never);

    it('maps a stored row onto the wire shape', async () => {
        const row: Partial<AppConfig> = {
            id: 1,
            forceUpdateAndroid: true,
            forceUpdateIos: false,
            minRequiredVersionAndroid: '2.4.0',
            minRequiredVersionIos: '2.3.1',
            updateMessage: 'Please update.',
            storeUrlAndroid: 'https://play.example/app',
            storeUrlIos: 'https://apps.example/app',
        };
        const svc = make(jest.fn().mockResolvedValue(row));
        await expect(svc.getPublicConfig()).resolves.toEqual({
            force_update_android: true,
            force_update_ios: false,
            min_required_version_android: '2.4.0',
            min_required_version_ios: '2.3.1',
            update_message: 'Please update.',
            store_url_android: 'https://play.example/app',
            store_url_ios: 'https://apps.example/app',
        });
    });

    it('serves safe defaults when the row is missing', async () => {
        const svc = make(jest.fn().mockResolvedValue(null));
        await expect(svc.getPublicConfig()).resolves.toEqual(
            APP_CONFIG_DEFAULTS,
        );
    });

    it('serves safe defaults (never throws) when the database is unreachable', async () => {
        const svc = make(
            jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        );
        const res = await svc.getPublicConfig();
        expect(res).toEqual(APP_CONFIG_DEFAULTS);
        expect(res.force_update_android).toBe(false);
        expect(res.force_update_ios).toBe(false);
    });

    it('falls back per-field when nullable columns are empty', async () => {
        const svc = make(
            jest.fn().mockResolvedValue({
                id: 1,
                forceUpdateAndroid: false,
                forceUpdateIos: true,
                minRequiredVersionAndroid: '3.0.0',
                minRequiredVersionIos: '3.0.0',
                updateMessage: null,
                storeUrlAndroid: null,
                storeUrlIos: null,
            }),
        );
        const res = await svc.getPublicConfig();
        expect(res.force_update_ios).toBe(true);
        expect(res.update_message).toBe(APP_CONFIG_DEFAULTS.update_message);
        expect(res.store_url_android).toBe(
            APP_CONFIG_DEFAULTS.store_url_android,
        );
        expect(res.store_url_ios).toBe(APP_CONFIG_DEFAULTS.store_url_ios);
    });
});

describe('AppConfigController routing', () => {
    /**
     * The shipped v1.2.4 build hard-codes `/api/app-config` and cannot be
     * changed without a store release, so the unprefixed alias is load-bearing
     * until that build is gone. Deleting it looks like harmless tidying and
     * would brick every phone still on 1.2.4 — hence a test that fails loudly.
     */
    const paths = Reflect.getMetadata('path', AppConfigController) as
        | string
        | string[];
    const registered = Array.isArray(paths) ? paths : [paths];

    it('serves the canonical public path', () => {
        expect(registered).toContain('public/app-config');
    });

    it('still serves the legacy unprefixed alias for the shipped v1.2.4 build', () => {
        expect(registered).toContain('app-config');
    });

    it('registers exactly these two paths and no others', () => {
        expect([...registered].sort()).toEqual([
            'app-config',
            'public/app-config',
        ]);
    });
});
