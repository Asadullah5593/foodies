import {
    REDACTED,
    diffSnapshots,
    isOtpRoute,
    maskPii,
    pickHeaders,
    pickResponseMeta,
    redactPayload,
} from './activity-log.redaction';

/**
 * Redaction is the one part of the audit log that can actively cause harm, so
 * these tests are written as "this specific secret must never land in the
 * table" rather than as generic unit coverage.
 */
describe('activity log redaction', () => {
    describe('request payloads', () => {
        it('strips every known credential key at the top level', () => {
            const { value } = redactPayload({
                email: 'owner@demo.com',
                password: 'owner123',
                new_password: 'hunter2',
                confirm_password: 'hunter2',
                owner_password: 'sesame',
                access_token: 'eyJhbGciOi',
                api_key: 'sk_live_1',
                cvv: '123',
            });
            expect(value).toMatchObject({
                password: REDACTED,
                new_password: REDACTED,
                confirm_password: REDACTED,
                owner_password: REDACTED,
                access_token: REDACTED,
                api_key: REDACTED,
                cvv: REDACTED,
            });
            expect(JSON.stringify(value)).not.toContain('owner123');
            expect(JSON.stringify(value)).not.toContain('eyJhbGciOi');
        });

        it('strips credentials nested at depth', () => {
            const { value } = redactPayload({
                branch: {
                    name: 'Emporium',
                    fbr: { fbr_token: 'FBR-SECRET-999', pos_id: 12 },
                },
                users: [{ email: 'a@b.com', password: 'nested-secret' }],
            });
            const json = JSON.stringify(value);
            expect(json).not.toContain('FBR-SECRET-999');
            expect(json).not.toContain('nested-secret');
            // ...while the surrounding audit data survives
            expect(json).toContain('Emporium');
            expect(json).toContain('12');
        });

        it('catches credential-shaped keys that are not on the list', () => {
            const { value } = redactPayload({
                meezan_secret: 'x',
                refresh_token: 'y',
                some_api_key: 'z',
                admin_password: 'w',
            });
            expect(value).toEqual({
                meezan_secret: REDACTED,
                refresh_token: REDACTED,
                some_api_key: REDACTED,
                admin_password: REDACTED,
            });
        });

        it('redacts `code` on OTP routes only', () => {
            const otp = redactPayload(
                { phone: '03001234567', code: '482913' },
                { route: '/api/consumer/auth/verify-otp' },
            );
            expect(otp.value?.code).toBe(REDACTED);

            // Elsewhere `code` is real audit data (inventory items, coupons)
            const item = redactPayload(
                { code: 'FLOUR-01', name: 'Flour' },
                { route: '/api/admin/inventory/items' },
            );
            expect(item.value?.code).toBe('FLOUR-01');
        });

        it('never stores an uploaded file buffer', () => {
            const { value, truncated } = redactPayload({
                file: Buffer.alloc(2048, 1),
                original_name: 'menu.png',
            });
            expect(String(value?.file)).toBe('[binary 2048 bytes]');
            expect(value?.original_name).toBe('menu.png');
            expect(truncated).toBe(true);
        });

        it('masks contact details but keeps them comparable', () => {
            const { value } = redactPayload({
                phone: '03001234567',
                email: 'customer@example.com',
            });
            expect(value?.phone).not.toBe('03001234567');
            expect(String(value?.phone)).toContain('030');
            expect(String(value?.email)).toContain('@example.com');
            expect(String(value?.email)).not.toContain('customer@');
        });

        it('caps oversized payloads instead of storing them', () => {
            const { value, truncated } = redactPayload({
                blob: 'x'.repeat(20_000),
            });
            expect(truncated).toBe(true);
            expect(JSON.stringify(value).length).toBeLessThan(1000);
        });

        it('survives hostile input rather than throwing on the response path', () => {
            const cyclic: Record<string, unknown> = { name: 'loop' };
            cyclic.self = cyclic;
            expect(() => redactPayload(cyclic)).not.toThrow();
            expect(() => redactPayload(null)).not.toThrow();
            expect(() => redactPayload('a string')).not.toThrow();
        });
    });

    describe('responses and headers are allow-listed', () => {
        it('keeps only the allow-listed fields of a real branch response', () => {
            // Shaped after branches.service.ts, which echoes fbr_token
            const meta = pickResponseMeta({
                id: 10,
                name: 'Emporium',
                fbr_token: 'FBR-SECRET-999',
                gst_rate_cash: 15,
                status: 'active',
            });
            expect(meta).toEqual({ id: 10, status: 'active' });
            expect(JSON.stringify(meta)).not.toContain('FBR-SECRET-999');
        });

        it('cannot leak a field added to a response in future', () => {
            const meta = pickResponseMeta({
                id: 1,
                something_invented_next_year: 'secret-by-accident',
            });
            expect(meta).toEqual({ id: 1 });
        });

        it('never captures authorization or cookie headers', () => {
            const picked = pickHeaders({
                authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9',
                cookie: 'session=abc',
                'user-agent': 'Chrome',
                'x-request-id': 'req-1',
            });
            expect(picked).toEqual({
                'user-agent': 'Chrome',
                'x-request-id': 'req-1',
            });
            expect(JSON.stringify(picked)).not.toContain('Bearer');
        });
    });

    describe('diffs', () => {
        it('does not invent changes from decimal-as-string', () => {
            // TypeORM returns numeric columns as strings
            const { changes } = diffSnapshots(
                { price: '12.00', name: 'Pizza' },
                { price: 12, name: 'Pizza' },
            );
            expect(changes).toBeNull();
        });

        it('reports a real price change with both values', () => {
            const { changes, changedFields } = diffSnapshots(
                { price: '12.00' },
                { price: '14.50' },
            );
            expect(changedFields).toEqual(['price']);
            expect(changes?.price).toEqual({ before: 12, after: 14.5 });
        });

        it('records that a password changed without either value', () => {
            const { changes, changedFields } = diffSnapshots(
                { password: '$2b$10$oldhash' },
                { password: '$2b$10$newhash' },
            );
            expect(changedFields).toEqual(['password']);
            expect(changes?.password).toEqual({
                before: '[changed]',
                after: '[changed]',
            });
            expect(JSON.stringify(changes)).not.toContain('$2b$');
        });

        it('ignores updated_at churn', () => {
            const { changes } = diffSnapshots(
                { name: 'A', updatedAt: new Date('2026-01-01') },
                { name: 'A', updatedAt: new Date('2026-02-02') },
            );
            expect(changes).toBeNull();
        });

        it('caps a runaway diff', () => {
            const before: Record<string, unknown> = {};
            const after: Record<string, unknown> = {};
            for (let i = 0; i < 500; i++) {
                before[`f${i}`] = 'x'.repeat(100);
                after[`f${i}`] = 'y'.repeat(100);
            }
            const { truncated, changedFields } = diffSnapshots(before, after);
            expect(truncated).toBe(true);
            expect(changedFields.length).toBe(500);
        });
    });

    describe('helpers', () => {
        it('recognises the OTP routes', () => {
            expect(isOtpRoute('/api/auth/verify-otp')).toBe(true);
            expect(isOtpRoute('/api/admin/inventory/items')).toBe(false);
            expect(isOtpRoute(undefined)).toBe(false);
        });

        it('masks phones and emails distinguishably', () => {
            expect(maskPii('03001234567')).not.toBe('03001234567');
            expect(maskPii('03001234567')).not.toBe(maskPii('03009999999'));
            expect(maskPii('a@b.com')).toContain('@b.com');
        });
    });
});
