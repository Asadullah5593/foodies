import { ActivityContext } from './activity-context';
import { classifyActor, clientIp } from './activity-log.actor';
import {
    deriveAction,
    deriveActionGroup,
    expectsDiff,
    isCriticalAction,
    isSkippedRoute,
    normalisePath,
    outcomeFor,
    refineAction,
    shouldCapture,
    singularise,
} from './activity-log.policy';

describe('activity log policy', () => {
    describe('what gets captured', () => {
        const level = 'mutations+sensitive_reads' as const;

        it('always captures a refusal, even on a skipped route', () => {
            // The case an interceptor-based design would never see, because
            // guards run before interceptors.
            expect(shouldCapture(level, 'POST', '/pos/orders', 403)).toBe(true);
            expect(shouldCapture(level, 'GET', '/rider/location', 401)).toBe(
                true,
            );
        });

        it('captures a server error even on a skipped route', () => {
            // Skipping POS chatter is about volume; a 500 is not volume.
            expect(shouldCapture(level, 'POST', '/pos/orders/quote', 500)).toBe(
                true,
            );
            expect(shouldCapture(level, 'POST', '/rider/location', 502)).toBe(
                true,
            );
        });

        it('drops machine chatter', () => {
            expect(shouldCapture(level, 'POST', '/pos/orders/quote', 200)).toBe(
                false,
            );
            expect(shouldCapture(level, 'POST', '/rider/location', 201)).toBe(
                false,
            );
            expect(shouldCapture(level, 'PUT', '/consumer/cart/3', 200)).toBe(
                false,
            );
        });

        it('keeps the money even under a skipped prefix', () => {
            expect(isSkippedRoute('POST', '/pos/orders')).toBe(true);
            expect(isSkippedRoute('POST', '/pos/orders/12/pay')).toBe(false);
            expect(isSkippedRoute('POST', '/pos/orders/12/void')).toBe(false);
            expect(isSkippedRoute('POST', '/pos/orders/12/refund')).toBe(false);
        });

        it('keeps sensitive reads and ignores ordinary ones', () => {
            expect(shouldCapture(level, 'GET', '/admin/customers', 200)).toBe(
                true,
            );
            expect(
                shouldCapture(
                    level,
                    'GET',
                    '/admin/reports/product-sales',
                    200,
                ),
            ).toBe(true);
            expect(shouldCapture(level, 'GET', '/admin/menu-items', 200)).toBe(
                false,
            );
        });

        it('honours the capture level', () => {
            expect(shouldCapture('off', 'POST', '/admin/roles', 200)).toBe(
                false,
            );
            expect(
                shouldCapture('mutations', 'GET', '/admin/customers', 200),
            ).toBe(false);
            expect(shouldCapture('all', 'GET', '/admin/menu-items', 200)).toBe(
                true,
            );
        });
    });

    describe('naming', () => {
        it('singularises without producing typos', () => {
            expect(singularise('categories')).toBe('category');
            expect(singularise('branches')).toBe('branch');
            expect(singularise('brands')).toBe('brand');
            expect(singularise('menu-items')).toBe('menu-item');
            expect(singularise('addons')).toBe('addon');
            expect(singularise('access')).toBe('access');
        });

        it('derives readable actions from routes', () => {
            expect(deriveAction('POST', '/admin/categories')).toBe(
                'category.create',
            );
            expect(deriveAction('PUT', '/admin/menu-items/12')).toBe(
                'menu-item.update',
            );
            expect(deriveAction('DELETE', '/admin/roles/4')).toBe(
                'role.delete',
            );
            // A trailing verb segment beats the HTTP verb
            expect(deriveAction('POST', '/admin/shifts/5/close')).toBe(
                'shift.close',
            );
        });

        it('separates a failed login from a successful one', () => {
            expect(refineAction('auth.login', 200)).toBe('auth.login');
            expect(refineAction('auth.login', 401)).toBe('auth.login.failed');
            // Other failures keep their name; the outcome column carries it
            expect(refineAction('menu-item.update', 500)).toBe(
                'menu-item.update',
            );
        });

        it('buckets actions for the UI filters', () => {
            expect(deriveActionGroup('/auth/login')).toBe('auth');
            expect(deriveActionGroup('/admin/reports/product-sales')).toBe(
                'reports',
            );
            expect(deriveActionGroup('/admin/roles/2')).toBe('access');
            expect(deriveActionGroup('/admin/menu-items')).toBe('menu');
        });

        it('maps status codes to outcomes', () => {
            expect(outcomeFor(200)).toBe('success');
            expect(outcomeFor(403)).toBe('denied');
            expect(outcomeFor(422)).toBe('failed');
            expect(outcomeFor(500)).toBe('error');
        });

        it('strips the global prefix from paths', () => {
            expect(normalisePath('/api/admin/brands?x=1')).toBe(
                '/admin/brands',
            );
            expect(normalisePath('/api')).toBe('/');
        });

        it('marks the rows that must not be lost to a restart', () => {
            expect(isCriticalAction('auth.login.failed')).toBe(true);
            expect(isCriticalAction('role.update')).toBe(true);
            expect(isCriticalAction('shift.cash-out')).toBe(true);
            expect(isCriticalAction('category.create')).toBe(false);
        });

        it('flags the routes that owe a diff', () => {
            expect(expectsDiff('PUT', '/admin/roles/2')).toBe(true);
            expect(expectsDiff('POST', '/admin/roles')).toBe(false);
            expect(expectsDiff('PATCH', '/admin/customers/2')).toBe(false);
        });
    });

    describe('actor classification', () => {
        it('reads staff identity and the role snapshot', () => {
            const actor = classifyActor(
                {
                    id: 42,
                    tenantId: 1,
                    name: 'Fireaway Cashier 1',
                    email: 'cashier1@fireaway.com',
                    roles: [{ slug: 'pos_cashier', name: 'POS Cashier' }],
                },
                {},
            );
            expect(actor.actorType).toBe('staff');
            expect(actor.actorUserId).toBe(42);
            expect(actor.actorLabel).toBe('Fireaway Cashier 1');
            expect(actor.actorRoleSlugs).toEqual(['pos_cashier']);
            expect(actor.actorIsSuperAdmin).toBe(false);
        });

        it('records a super admin as unrestricted, not as role-less', () => {
            const actor = classifyActor(
                { id: 1, tenantId: null, isSuperAdmin: true, name: 'Root' },
                {},
            );
            expect(actor.actorIsSuperAdmin).toBe(true);
            // NULL means "unknown/unrestricted"; [] would read as "held no
            // permissions", the opposite of the truth.
            expect(actor.actorRoleSlugs).toBeNull();
        });

        it('never copies a consumer password off the user object', () => {
            const customerEntity = {
                id: 7,
                name: 'Ayesha',
                phone: '03001234567',
                // customer.entity.ts has no select:false on this
                password: '$2b$10$realbcrypthash',
            };
            const actor = classifyActor(customerEntity, {});
            expect(actor.actorType).toBe('customer');
            expect(actor.actorCustomerId).toBe(7);
            expect(JSON.stringify(actor)).not.toContain('$2b$');
        });

        it('tells a kiosk apart from a stranger', () => {
            expect(
                classifyActor(null, { 'x-kiosk-api-key': 'k' }).actorType,
            ).toBe('kiosk');
            expect(classifyActor(null, {}).actorType).toBe('anonymous');
        });

        it('takes the real client IP from behind nginx', () => {
            expect(
                clientIp(
                    { 'x-forwarded-for': '203.0.113.9, 10.0.0.1' },
                    '10.0.0.1',
                ),
            ).toBe('203.0.113.9');
            expect(clientIp({}, '127.0.0.1')).toBe('127.0.0.1');
        });
    });

    describe('request-scoped context', () => {
        it('is a no-op outside a request, so seeds and crons stay callable', () => {
            expect(ActivityContext.isActive()).toBe(false);
            expect(() =>
                ActivityContext.recordChange('menu_item', 1, {}, {}),
            ).not.toThrow();
            expect(ActivityContext.requestId()).toBe('');
        });

        it('keeps concurrent requests from crossing diffs', async () => {
            const runRequest = (id: string, entityId: number) =>
                new Promise<string[]>((resolve) => {
                    ActivityContext.run(
                        { requestId: id, changes: [] },
                        async () => {
                            ActivityContext.recordChange(
                                'menu_item',
                                entityId,
                                { price: 1 },
                                { price: 2 },
                            );
                            // Yield, so the two requests genuinely interleave
                            await new Promise((r) => setTimeout(r, 5));
                            ActivityContext.recordChange(
                                'menu_item',
                                entityId,
                                { name: 'a' },
                                { name: 'b' },
                            );
                            const store = ActivityContext.get();
                            resolve(
                                (store?.changes ?? []).map((c) =>
                                    String(c.entityId),
                                ),
                            );
                        },
                    );
                });

            const [a, b] = await Promise.all([
                runRequest('req-a', 111),
                runRequest('req-b', 222),
            ]);
            expect(a).toEqual(['111', '111']);
            expect(b).toEqual(['222', '222']);
        });

        it('bounds what one request can accumulate', () => {
            ActivityContext.run({ requestId: 'r', changes: [] }, () => {
                for (let i = 0; i < 200; i++) {
                    ActivityContext.recordChange('item', i, {}, { i });
                }
                expect(ActivityContext.get()?.changes.length).toBe(50);
            });
        });
    });
});
