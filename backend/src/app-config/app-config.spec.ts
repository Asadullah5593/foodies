import {
    AppConfigService,
    APP_CONFIG_DEFAULTS,
    withGenericKeys,
} from './app-config.service';
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
            // Legacy unsuffixed keys, derived from the ANDROID values.
            force_update: true,
            min_required_version: '2.4.0',
            store_url: 'https://play.example/app',
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
            withGenericKeys(APP_CONFIG_DEFAULTS),
        );
    });

    it('serves safe defaults (never throws) when the database is unreachable', async () => {
        const svc = make(
            jest.fn().mockRejectedValue(new Error('ECONNREFUSED')),
        );
        const res = await svc.getPublicConfig();
        expect(res).toEqual(withGenericKeys(APP_CONFIG_DEFAULTS));
        expect(res.force_update_android).toBe(false);
        expect(res.force_update_ios).toBe(false);
        // The legacy key must fail open too — an old build reads only this one.
        expect(res.force_update).toBe(false);
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

    it('derives the legacy keys per platform when the caller says which it is', async () => {
        const row = {
            id: 1,
            forceUpdateAndroid: false,
            forceUpdateIos: true,
            minRequiredVersionAndroid: '1.0.0',
            minRequiredVersionIos: '1.2.4',
            updateMessage: 'Please update.',
            storeUrlAndroid: 'https://play.example/app',
            storeUrlIos: 'https://apps.example/app',
        };
        const svc = make(jest.fn().mockResolvedValue(row));

        const android = await svc.getPublicConfig('android');
        expect(android.force_update).toBe(false);
        expect(android.min_required_version).toBe('1.0.0');
        expect(android.store_url).toBe('https://play.example/app');

        const ios = await svc.getPublicConfig('ios');
        expect(ios.force_update).toBe(true);
        expect(ios.min_required_version).toBe('1.2.4');
        expect(ios.store_url).toBe('https://apps.example/app');
    });

    it('never sends an unidentified caller to the wrong store (the build-125 bug)', () => {
        // iOS forced to 1.2.4, Android not forced. A legacy Android build reads
        // only the unsuffixed keys: it must NOT be blocked, and must never be
        // handed the Apple link it cannot update from.
        const res = withGenericKeys({
            force_update_android: false,
            force_update_ios: true,
            min_required_version_android: '1.0.0',
            min_required_version_ios: '1.2.4',
            update_message: 'A new version of Foodies is available.',
            store_url_android: 'https://play.example/app',
            store_url_ios: 'https://apps.example/app',
        });
        expect(res.force_update).toBe(false);
        expect(res.min_required_version).toBe('1.0.0');
        expect(res.store_url).toBe('https://play.example/app');
    });

    it('forces the legacy Android population when Android is the one being forced', () => {
        const res = withGenericKeys({
            force_update_android: true,
            force_update_ios: false,
            min_required_version_android: '1.3.0',
            min_required_version_ios: '1.0.0',
            update_message: 'msg',
            store_url_android: 'https://play.example/app',
            store_url_ios: 'https://apps.example/app',
        });
        expect(res.force_update).toBe(true);
        expect(res.min_required_version).toBe('1.3.0');
        expect(res.store_url).toBe('https://play.example/app');
    });

    it('keeps the per-platform keys authoritative — generic keys never overwrite them', () => {
        const res = withGenericKeys(
            {
                force_update_android: false,
                force_update_ios: true,
                min_required_version_android: '1.0.0',
                min_required_version_ios: '1.2.4',
                update_message: 'msg',
                store_url_android: 'https://play.example/app',
                store_url_ios: 'https://apps.example/app',
            },
            'ios',
        );
        expect(res.force_update_android).toBe(false);
        expect(res.force_update_ios).toBe(true);
        expect(res.min_required_version_android).toBe('1.0.0');
        expect(res.store_url_android).toBe('https://play.example/app');
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
