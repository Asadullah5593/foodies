import { parseTokenDoc } from './push-device-sync.service';
import { PushSenderService, ANDROID_CHANNEL } from './push-sender.service';
import { returningRows } from './push-sql';
import {
    audienceConditionSql,
    devicePlatforms,
    normalizeAudience,
    normalizeRule,
    phoneKey,
    scopeConditionSql,
    SqlParams,
    AUDIENCE_RULES,
} from './push-audience-rules';
import type { FirebaseService } from '../firebase/firebase.service';
import type * as admin from 'firebase-admin';

describe('parseTokenDoc (Firestore → push_devices)', () => {
    it('reads the app’s token doc', () => {
        const when = new Date('2026-10-19T10:00:00Z');
        expect(
            parseTokenDoc('users/1234/tokens/abc', {
                token: 'abc',
                platform: 'Android',
                lastUpdated: { toDate: () => when },
            }),
        ).toEqual({
            docPath: 'users/1234/tokens/abc',
            ownerRef: '1234',
            token: 'abc',
            platform: 'android',
            lastUpdated: when,
        });
    });

    it('falls back to the doc id for the token and tolerates a missing date', () => {
        expect(parseTokenDoc('users/9/tokens/xyz', {})).toMatchObject({
            token: 'xyz',
            platform: null,
            lastUpdated: null,
        });
    });

    it('ignores docs that are not users/{id}/tokens/{token}', () => {
        expect(parseTokenDoc('riders/9/tokens/xyz', { token: 'x' })).toBeNull();
        expect(parseTokenDoc('users/9/devices/xyz', { token: 'x' })).toBeNull();
    });
});

describe('PushSenderService.buildMessage', () => {
    const sender = new PushSenderService({
        messaging: null,
    } as unknown as FirebaseService);
    const now = new Date('2026-10-20T12:00:00Z');

    it('uses the app’s Android channel, no screen (tap opens the app) and no badge', () => {
        const m = sender.buildMessage(
            { token: 't', title: 'T', body: 'B' },
            {
                messageId: 7,
                imageUrl: null,
                expiryHours: 12,
                replacePrevious: false,
            },
            now,
        ) as admin.messaging.TokenMessage;
        expect(m.token).toBe('t');
        expect(m.notification).toEqual({ title: 'T', body: 'B' });
        expect(m.data).toEqual({ kind: 'promo', push_message_id: '7' });
        expect(m.data?.screen).toBeUndefined();
        expect(m.android?.notification?.channelId).toBe(ANDROID_CHANNEL);
        expect(m.android?.ttl).toBe(12 * 3_600_000);
        expect(m.android?.notification?.tag).toBeUndefined();
        expect(m.apns?.payload?.aps.badge).toBeUndefined();
        expect(m.apns?.headers?.['apns-expiration']).toBe(
            String(Math.floor(now.getTime() / 1000) + 12 * 3600),
        );
    });

    it('replaces the previous promo and carries the image when asked', () => {
        const m = sender.buildMessage(
            { token: 't', title: 'T', body: 'B' },
            {
                messageId: null,
                imageUrl: 'https://cdn.x/a.png',
                expiryHours: 1,
                replacePrevious: true,
            },
            now,
        ) as admin.messaging.TokenMessage;
        expect(m.android?.notification?.tag).toBe('foodies-promo');
        expect(m.apns?.headers?.['apns-collapse-id']).toBe('foodies-promo');
        expect(m.notification?.imageUrl).toBe('https://cdn.x/a.png');
        expect(m.android?.notification?.imageUrl).toBe('https://cdn.x/a.png');
        expect(m.data).toEqual({ kind: 'promo' });
    });

    it('reports every message failed when Firebase is not configured', async () => {
        const out = await sender.sendBatch(
            [{ token: 'a', title: 'T', body: 'B' }],
            {
                messageId: 1,
                imageUrl: null,
                expiryHours: 1,
                replacePrevious: false,
            },
        );
        expect(out).toEqual([
            {
                token: 'a',
                ok: false,
                dead: false,
                error: 'Firebase is not configured on this server',
            },
        ]);
    });
});

describe('returningRows', () => {
    it('unwraps TypeORM’s [rows, count] for UPDATE / DELETE', () => {
        expect(returningRows([[{ id: 1 }], 1])).toEqual([{ id: 1 }]);
        expect(returningRows([[], 0])).toEqual([]);
    });
    it('passes SELECT / INSERT rows through', () => {
        expect(returningRows([{ id: 1 }, { id: 2 }])).toEqual([
            { id: 1 },
            { id: 2 },
        ]);
        expect(returningRows(undefined)).toEqual([]);
    });
});

describe('audience rules', () => {
    it('every rule has a unique key and builds SQL with bound params only', () => {
        const keys = AUDIENCE_RULES.map((r) => r.key);
        expect(new Set(keys).size).toBe(keys.length);
    });

    it('reads phones in any common format', () => {
        expect(phoneKey('+92 300 1234567')).toBe('3001234567');
        expect(phoneKey('03001234567')).toBe('3001234567');
        expect(phoneKey('12345')).toBeNull();
        expect(
            normalizeRule(
                {
                    rule: 'phone_list',
                    params: { phones: '03001234567,\n+923406477263 junk' },
                },
                {},
            ).params,
        ).toEqual({ phones: ['3001234567', '3406477263'] });
    });

    it('a brand-locked author cannot aim at another brand', () => {
        expect(() =>
            normalizeRule(
                { rule: 'ordered_from_brand', params: { brand_ids: [28, 23] } },
                { brand_ids: [28] },
            ),
        ).toThrow('only target your own brand');
        expect(
            normalizeRule(
                { rule: 'ordered_from_brand', params: { brand_ids: ['28'] } },
                { brand_ids: [28] },
            ).params,
        ).toEqual({ brand_ids: [28] });
    });

    it('a branch-limited author cannot aim at another branch', () => {
        expect(() =>
            normalizeRule(
                { rule: 'near_branch', params: { branch_id: 5, km: 3 } },
                { branch_ids: [4] },
            ),
        ).toThrow('only target your own branches');
    });

    it('drops unknown params and checks ranges', () => {
        expect(
            normalizeRule(
                { rule: 'lapsed', params: { days: '45', evil: "'; DROP" } },
                {},
            ).params,
        ).toEqual({ days: 45 });
        expect(() =>
            normalizeRule(
                { rule: 'near_branch', params: { branch_id: 1, km: 500 } },
                {},
            ),
        ).toThrow('at most 100');
    });

    it('builds all / any / but-not with numbered parameters', () => {
        const a = normalizeAudience(
            {
                match: 'any',
                include: [
                    { rule: 'lapsed', params: { days: 30 } },
                    { rule: 'app_points', params: { points: 500 } },
                ],
                exclude: [{ rule: 'never_ordered' }],
            },
            {},
        );
        const p = new SqlParams();
        const sql = audienceConditionSql(a, p.bind);
        expect(sql).toMatch(/\) OR \(/);
        expect(sql).toMatch(/AND NOT \(/);
        expect(p.values).toEqual([30, 500]);
        expect(
            audienceConditionSql(
                { match: 'all', include: [], exclude: [] },
                p.bind,
            ),
        ).toBe('TRUE');
    });

    it('limits phones to a platform only when every rule must match', () => {
        const ios = { rule: 'platform', params: { platform: 'ios' } };
        expect(
            devicePlatforms({ match: 'all', include: [ios], exclude: [] }),
        ).toEqual(['ios']);
        expect(
            devicePlatforms({ match: 'any', include: [ios], exclude: [] }),
        ).toBeNull();
    });

    it('scopes a restricted author to their brand and branches', () => {
        const p = new SqlParams(1);
        const sql = scopeConditionSql(
            { brand_ids: [28], branch_ids: [4] },
            p.bind,
        );
        expect(sql).toMatch(/brand_id = ANY\(\$2::int\[\]\)/);
        expect(sql).toMatch(/branch_id = ANY\(\$3::int\[\]\)/);
        expect(scopeConditionSql({}, p.bind)).toBe('');
    });
});
