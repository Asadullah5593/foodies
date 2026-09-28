import { EventEmitter } from 'node:events';
import { ActivityContext } from './activity-context';
import { ActivityLogMiddleware } from './activity-log.middleware';
import type { ActivityLogRow } from './activity-log.writer';
import {
    canonicalEntityType,
    entityTypeVariants,
    labelFromResponse,
    scopeFromRequest,
    soleId,
} from './activity-log.subject';
import {
    auditOrder,
    auditOrderStatus,
    orderLabel,
    placedSummary,
} from '../orders/order-audit';

describe('activity log subject', () => {
    describe('naming the record', () => {
        it('gives one record type one spelling', () => {
            expect(canonicalEntityType('menu-items')).toBe('menu_item');
            expect(canonicalEntityType('menu_item')).toBe('menu_item');
            expect(canonicalEntityType('MenuItems')).toBe('menu_item');
            expect(canonicalEntityType('roles')).toBe('role');
            expect(canonicalEntityType('categories')).toBe('category');
            expect(canonicalEntityType('branches')).toBe('branch');
            expect(canonicalEntityType('')).toBeNull();
            expect(canonicalEntityType(null)).toBeNull();
        });

        it('still finds rows stored under the older spellings', () => {
            expect(entityTypeVariants('menu_item')).toEqual(
                expect.arrayContaining([
                    'menu_item',
                    'menu-item',
                    'menu_items',
                    'menu-items',
                ]),
            );
            expect(entityTypeVariants('order')).toEqual(
                expect.arrayContaining(['order', 'orders']),
            );
            expect(entityTypeVariants('category')).toEqual(
                expect.arrayContaining(['category', 'categories']),
            );
        });

        it('names an order the way staff say it, then the way it is tracked', () => {
            expect(
                orderLabel({
                    id: 9,
                    orderNumber: '013',
                    orderId: 'FDS-A7K2M9QX',
                }),
            ).toBe('013 · FDS-A7K2M9QX');
            expect(orderLabel({ id: 9, orderNumber: '013' })).toBe('013');
            expect(orderLabel({ id: 9 })).toBe('#9');
        });

        it('says where an order came from in plain words', () => {
            expect(placedSummary('delivery', 'pos')).toBe(
                'Placed as a delivery order from the POS',
            );
            expect(placedSummary('dine_in', 'consumer_app')).toBe(
                'Placed as a dine in order from the customer app',
            );
        });

        it('borrows a name from the response, and nothing else', () => {
            expect(labelFromResponse({ id: 4, name: 'Johar Town' })).toBe(
                'Johar Town',
            );
            expect(labelFromResponse({ id: 4, order_number: '013' })).toBe(
                '013',
            );
            expect(labelFromResponse({ id: 4 })).toBeNull();
            expect(labelFromResponse(null)).toBeNull();
        });
    });

    describe('placing it at a branch and brand', () => {
        it('reads the route first, then the query, body and response', () => {
            expect(
                scopeFromRequest({
                    params: { branchId: '4' },
                    query: { branch_id: '9', brand_id: '2' },
                    body: { brand_id: 7 },
                }),
            ).toEqual({ branchId: 4, brandId: 2 });
            expect(
                scopeFromRequest({ response: { branch_id: 3, brand_id: 5 } }),
            ).toEqual({ branchId: 3, brandId: 5 });
        });

        it('ignores anything that is not a real id', () => {
            expect(
                scopeFromRequest({
                    query: { branch_id: 'all', brand_id: '0' },
                    body: { branch_id: [1, 2] },
                }),
            ).toEqual({ branchId: null, brandId: null });
        });

        it('guesses only for someone confined to a single place', () => {
            expect(soleId([4])).toBe(4);
            expect(soleId([4, 5])).toBeNull();
            // null = every branch (owner, GM): no guess.
            expect(soleId(null)).toBeNull();
            expect(soleId([])).toBeNull();
        });
    });

    describe('what reaches the table', () => {
        const OLD = process.env.ACTIVITY_LOG_ENABLED;
        beforeAll(() => {
            process.env.ACTIVITY_LOG_ENABLED = 'true';
        });
        afterAll(() => {
            process.env.ACTIVITY_LOG_ENABLED = OLD;
        });

        /** Drives one request through the middleware and returns its rows. */
        const run = (
            req: Record<string, unknown>,
            statusCode: number,
            handler: () => void,
        ): ActivityLogRow[] => {
            const rows: ActivityLogRow[] = [];
            const writer = {
                enqueue: (row: ActivityLogRow) => rows.push(row),
                writeImmediate: (row: ActivityLogRow) => {
                    rows.push(row);
                    return Promise.resolve();
                },
            };
            const settings = { cached: () => null };
            const middleware = new ActivityLogMiddleware(
                writer as never,
                settings as never,
            );
            const res = Object.assign(new EventEmitter(), {
                statusCode,
                setHeader: () => undefined,
            });
            middleware.use(
                {
                    headers: {},
                    query: {},
                    params: {},
                    body: {},
                    ...req,
                } as never,
                res as never,
                handler,
            );
            res.emit('finish');
            return rows;
        };

        const staff = (over: Record<string, unknown> = {}) => ({
            id: 7,
            tenantId: 1,
            name: 'Delivery Manager',
            roles: [{ slug: 'delivery_manager', name: 'Delivery Manager' }],
            allowedBranchIds: null,
            allowedBrandIds: null,
            ...over,
        });

        it('gives every order in a request its own row, branch and brand', () => {
            const rows = run(
                {
                    method: 'POST',
                    originalUrl: '/api/pos/orders',
                    user: staff(),
                    body: { branch_id: 4, items: [] },
                },
                201,
                () => {
                    auditOrder(
                        {
                            id: 501,
                            tenantId: 1,
                            branchId: 4,
                            brandId: 2,
                            orderNumber: '013',
                            orderId: 'FDS-AAAA1111',
                        },
                        'Placed as a delivery order from the POS',
                    );
                    auditOrder(
                        {
                            id: 502,
                            tenantId: 1,
                            branchId: 4,
                            brandId: 3,
                            orderNumber: '007',
                            orderId: 'FDS-BBBB2222',
                        },
                        'Placed as a delivery order from the POS',
                    );
                },
            );
            expect(rows).toHaveLength(2);
            expect(
                rows.map((r) => [r.entityType, r.entityId, r.brandId]),
            ).toEqual([
                ['order', '501', 2],
                ['order', '502', 3],
            ]);
            expect(rows[0].entityLabel).toBe('013 · FDS-AAAA1111');
            expect(rows[0].summary).toBe(
                'Placed as a delivery order from the POS',
            );
            expect(rows[0].actorRoleSlugs).toEqual(['delivery_manager']);
            // The payload is the request's, so it is stored once.
            expect(rows[0].requestBody).not.toBeNull();
            expect(rows[1].requestBody).toBeNull();
        });

        it('records a status change as before and after', () => {
            const rows = run(
                {
                    method: 'PUT',
                    originalUrl: '/api/admin/orders/501/status',
                    user: staff(),
                },
                200,
                () =>
                    auditOrderStatus(
                        {
                            id: 501,
                            branchId: 4,
                            brandId: 2,
                            orderNumber: '013',
                        },
                        'preparing',
                        'ready',
                    ),
            );
            expect(rows).toHaveLength(1);
            expect(rows[0].summary).toBe(
                'Status changed from preparing to ready',
            );
            expect(rows[0].changes).toEqual({
                status: { before: 'preparing', after: 'ready' },
            });
            expect(rows[0].actionGroup).toBe('orders');
        });

        it('never reports a change from a request that failed', () => {
            const rows = run(
                {
                    method: 'PUT',
                    originalUrl: '/api/admin/orders/501/status',
                    user: staff(),
                },
                500,
                () =>
                    auditOrderStatus(
                        { id: 501, orderNumber: '013' },
                        'preparing',
                        'ready',
                    ),
            );
            expect(rows).toHaveLength(1);
            expect(rows[0].outcome).toBe('error');
            expect(rows[0].summary).toBeNull();
            expect(rows[0].changes).toBeNull();
        });

        it('places a row at the branch the request named', () => {
            const rows = run(
                {
                    method: 'GET',
                    originalUrl: '/api/admin/reports/sales-summary?branch_id=4',
                    query: { branch_id: '4', brand_id: '2' },
                    user: staff(),
                },
                200,
                () => undefined,
            );
            expect(rows[0].branchId).toBe(4);
            expect(rows[0].brandId).toBe(2);
        });

        it('places a single-branch cashier at their branch', () => {
            const rows = run(
                {
                    method: 'GET',
                    originalUrl: '/api/admin/shifts',
                    user: staff({
                        allowedBranchIds: [9],
                        allowedBrandIds: [3],
                    }),
                },
                200,
                () => undefined,
            );
            expect(rows[0].branchId).toBe(9);
            expect(rows[0].brandId).toBe(3);
        });

        it('leaves the place empty rather than guess for an owner', () => {
            const rows = run(
                {
                    method: 'GET',
                    originalUrl: '/api/admin/shifts',
                    user: staff(),
                },
                200,
                () => undefined,
            );
            expect(rows[0].branchId).toBeNull();
            expect(rows[0].brandId).toBeNull();
        });

        it('does nothing outside a request', () => {
            expect(ActivityContext.isActive()).toBe(false);
            expect(() =>
                auditOrder({ id: 1, orderNumber: '001' }, 'Order placed'),
            ).not.toThrow();
        });
    });
});
