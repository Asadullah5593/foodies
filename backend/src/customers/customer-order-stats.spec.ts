import { NotFoundException } from '@nestjs/common';
import { CustomersService } from './customers.service';
import { CustomersController } from './customers.controller';
import {
    FINISHED_ORDERS_SQL,
    ORDER_STATS_SELECT,
    mapOrderStats,
    orderScopeSql,
} from './customer-order-stats';

/**
 * The Customers table and the customer detail page show order figures beside
 * each customer. The rules, as agreed with the client:
 *
 * 1. Completed and cancelled orders are counted separately. An order still in
 *    progress is in neither column until it finishes.
 * 2. Spent is the total of COMPLETED orders only.
 * 3. Last order is the most recent COMPLETED order — a cancelled order never
 *    makes a lapsed customer look active.
 * 4. The figures cover only the orders the viewer may read in the Orders
 *    module (tenant, branches, brand lock, history window, channel markers).
 * 5. An account that may not see money totals gets no spend figure at all.
 */
describe('customer order figures — the rules', () => {
    it('counts completed and cancelled orders separately', () => {
        expect(ORDER_STATS_SELECT).toContain(
            "COUNT(*) FILTER (WHERE o.status = 'completed')::int AS completed_count",
        );
        expect(ORDER_STATS_SELECT).toContain(
            "COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled_count",
        );
    });

    it('leaves in-progress orders out of every column', () => {
        expect(FINISHED_ORDERS_SQL).toBe(
            "o.status IN ('completed', 'cancelled')",
        );
        for (const status of ['placed', 'accepted', 'preparing', 'ready'])
            expect(FINISHED_ORDERS_SQL).not.toContain(status);
    });

    it('adds up spend over completed orders only', () => {
        expect(ORDER_STATS_SELECT).toContain(
            "SUM(o.total_amount) FILTER (WHERE o.status = 'completed')",
        );
    });

    it('takes the last and first order from completed orders only', () => {
        expect(ORDER_STATS_SELECT).toContain(
            "MAX(o.placed_at) FILTER (WHERE o.status = 'completed') AS last_order_at",
        );
        expect(ORDER_STATS_SELECT).toContain(
            "MIN(o.placed_at) FILTER (WHERE o.status = 'completed') AS first_order_at",
        );
    });
});

describe('orderScopeSql — only the orders the viewer may read', () => {
    it('adds nothing for an unrestricted super admin', () => {
        expect(orderScopeSql({ tenantId: null }, 2)).toEqual({
            sql: '',
            params: [],
        });
    });

    it('scopes an owner to their tenant only', () => {
        expect(
            orderScopeSql(
                { tenantId: 6, allowedBranchIds: null, allowedBrandIds: null },
                2,
            ),
        ).toEqual({ sql: ' AND o.tenant_id = $2', params: [6] });
    });

    it('applies branch access, brand lock, history window and channel markers', () => {
        const { sql, params } = orderScopeSql(
            {
                tenantId: 6,
                allowedBranchIds: [10, 11],
                allowedBrandIds: [23],
                orderHistoryDays: 7,
                restrictedSources: ['call_centre'],
            },
            2,
        );
        expect(sql).toBe(
            ' AND o.tenant_id = $2' +
                ' AND o.branch_id = ANY($3::int[])' +
                ' AND o.brand_id = ANY($4::int[])' +
                ' AND date(o.placed_at) >= (CURRENT_DATE - CAST($5 AS int) + 1)' +
                ' AND o.source = ANY($6::text[])',
        );
        expect(params).toEqual([6, [10, 11], [23], 7, ['call_centre']]);
    });

    it('numbers its parameters from where the caller says', () => {
        const { sql } = orderScopeSql(
            { tenantId: 6, allowedBrandIds: [23] },
            5,
        );
        expect(sql).toBe(
            ' AND o.tenant_id = $5 AND o.brand_id = ANY($6::int[])',
        );
    });

    it('treats an empty branch list as "all branches", as Orders does', () => {
        expect(
            orderScopeSql({ tenantId: 6, allowedBranchIds: [] }, 2).sql,
        ).toBe(' AND o.tenant_id = $2');
    });

    it('a brand lock with no brands matches nothing rather than everything', () => {
        const { sql, params } = orderScopeSql(
            { tenantId: 6, allowedBrandIds: [] },
            2,
        );
        expect(sql).toContain('o.brand_id = ANY($3::int[])');
        expect(params).toEqual([6, []]);
    });

    it('ignores a history window that is not a positive number', () => {
        for (const days of [null, undefined, 0, -3, NaN])
            expect(
                orderScopeSql({ tenantId: 6, orderHistoryDays: days }, 2).sql,
            ).toBe(' AND o.tenant_id = $2');
    });
});

describe('mapOrderStats', () => {
    const row = {
        completed_count: '14',
        cancelled_count: 2,
        spent: '31240.50',
        last_order_at: new Date('2026-09-28T10:00:00Z'),
    };

    it('turns the raw aggregate into numbers and an ISO date', () => {
        expect(mapOrderStats(row, false)).toEqual({
            completed_count: 14,
            cancelled_count: 2,
            spent: 31240.5,
            last_order_at: '2026-09-28T10:00:00.000Z',
        });
    });

    it('withholds the spend from an account that may not see totals', () => {
        expect(mapOrderStats(row, true).spent).toBeNull();
        expect(mapOrderStats(undefined, true).spent).toBeNull();
    });

    it('is all zeros, and "never ordered", for a customer with no orders', () => {
        expect(mapOrderStats(undefined, false)).toEqual({
            completed_count: 0,
            cancelled_count: 0,
            spent: 0,
            last_order_at: null,
        });
    });
});

describe('CustomersService — figures on the list and the detail page', () => {
    type Call = { sql: string; params: unknown[] };

    const makeSvc = (opts: {
        customers: Array<Record<string, unknown>>;
        respond: (sql: string) => unknown[];
        brandLockVisible?: boolean;
    }) => {
        const calls: Call[] = [];
        const svc = Object.create(
            CustomersService.prototype,
        ) as unknown as CustomersService;
        const qb: Record<string, unknown> = {};
        for (const m of ['where', 'orderBy', 'andWhere']) qb[m] = () => qb;
        qb.getMany = () => Promise.resolve(opts.customers);
        Object.assign(svc, {
            repo: {
                find: () => Promise.resolve(opts.customers),
                findOne: () => Promise.resolve(opts.customers[0] ?? null),
                createQueryBuilder: () => qb,
            },
            dataSource: {
                query: (sql: string, params: unknown[]) => {
                    calls.push({ sql, params });
                    return Promise.resolve(opts.respond(sql));
                },
            },
        });
        const statsCalls = () =>
            calls.filter((c) => c.sql.includes('completed_count'));
        return { svc, calls, statsCalls };
    };

    const abdullah = {
        id: 412,
        tenantId: 6,
        name: 'Abdullah Arshad',
        phone: '03240201350',
        email: null,
        password: '$2a$10$hash',
        source: 'consumer_app',
        phoneVerified: true,
        brandIds: null,
        createdAt: new Date('2026-06-12T00:00:00Z'),
    };
    const arbaz = { ...abdullah, id: 7, name: 'Arbaz', phone: '03124551339' };

    const respond = (sql: string): unknown[] => {
        if (sql.includes('GROUP BY o.customer_id'))
            return [
                {
                    customer_id: 412,
                    completed_count: 14,
                    cancelled_count: 2,
                    spent: '31240.00',
                    last_order_at: new Date('2026-09-28T10:00:00Z'),
                },
            ];
        if (sql.includes('JOIN branches br') && sql.includes('DISTINCT'))
            return [{ customer_id: 412, id: 10, name: 'Pine Avenue' }];
        return [];
    };

    it('gives every listed customer their figures and branches', async () => {
        const { svc } = makeSvc({ customers: [abdullah, arbaz], respond });
        const rows = (await svc.findAll(6, null)) as Array<{
            id: number;
            orderStats: unknown;
            branches: unknown;
        }>;
        expect(rows.find((r) => r.id === 412)?.orderStats).toEqual({
            completed_count: 14,
            cancelled_count: 2,
            spent: 31240,
            last_order_at: '2026-09-28T10:00:00.000Z',
        });
        expect(rows.find((r) => r.id === 412)?.branches).toEqual([
            { id: 10, name: 'Pine Avenue' },
        ]);
        // No orders: zeros and "never", not a missing field.
        expect(rows.find((r) => r.id === 7)?.orderStats).toEqual({
            completed_count: 0,
            cancelled_count: 0,
            spent: 0,
            last_order_at: null,
        });
        expect(rows.find((r) => r.id === 7)?.branches).toEqual([]);
    });

    it('counts only finished orders, inside the viewer’s scope', async () => {
        const { svc, statsCalls } = makeSvc({
            customers: [abdullah],
            respond,
        });
        await svc.findAll(6, [23], {
            allowedBranchIds: [10],
            orderHistoryDays: 30,
            restrictedSources: ['pos'],
        });
        const [stats] = statsCalls();
        expect(stats.sql).toContain(FINISHED_ORDERS_SQL);
        expect(stats.sql).toContain('o.tenant_id = $2');
        expect(stats.sql).toContain('o.branch_id = ANY($3::int[])');
        expect(stats.sql).toContain('o.brand_id = ANY($4::int[])');
        expect(stats.sql).toContain('CAST($5 AS int)');
        expect(stats.sql).toContain('o.source = ANY($6::text[])');
        expect(stats.params).toEqual([[412], 6, [10], [23], 30, ['pos']]);
    });

    it('scopes the branches it lists the same way', async () => {
        const { svc, calls } = makeSvc({ customers: [abdullah], respond });
        await svc.findAll(6, [23], { allowedBranchIds: [10] });
        const branches = calls.find(
            (c) =>
                c.sql.includes('JOIN branches br') &&
                c.sql.includes('DISTINCT'),
        );
        expect(branches?.params).toEqual([[412], 6, [10], [23]]);
    });

    it('withholds spend from a viewer who may not see totals', async () => {
        const { svc } = makeSvc({ customers: [abdullah], respond });
        const [row] = (await svc.findAll(6, null, {
            hideTotals: true,
        })) as Array<{
            orderStats: { spent: unknown; completed_count: number };
        }>;
        expect(row.orderStats.spent).toBeNull();
        expect(row.orderStats.completed_count).toBe(14);
    });

    it('a brand-locked viewer only ever gets their own brands back', async () => {
        const { svc } = makeSvc({
            customers: [{ ...abdullah, brandIds: [21, 23] }],
            respond: (sql) => {
                if (sql.includes('SELECT DISTINCT o.customer_id, b.id, b.name'))
                    return [
                        { customer_id: 412, id: 21, name: 'Fireaway' },
                        { customer_id: 412, id: 23, name: 'Peperi Co' },
                    ];
                return respond(sql);
            },
        });
        const [row] = (await svc.findAll(6, [23])) as Array<{
            brands: Array<{ id: number }>;
        }>;
        expect(row.brands.map((b) => b.id)).toEqual([23]);
    });

    describe('the detail page summary', () => {
        const summaryRespond = (sql: string): unknown[] => {
            if (sql.includes('GROUP BY o.brand_id'))
                return [
                    {
                        brand_id: 21,
                        brand_name: 'Fireaway',
                        branch_id: 10,
                        branch_name: 'Pine Avenue',
                        completed_count: 12,
                        cancelled_count: 1,
                        spent: '26400.00',
                        last_order_at: new Date('2026-09-28T10:00:00Z'),
                        first_order_at: new Date('2026-06-20T10:00:00Z'),
                    },
                    {
                        brand_id: 21,
                        brand_name: 'Fireaway',
                        branch_id: 12,
                        branch_name: 'DHA',
                        completed_count: 5,
                        cancelled_count: 0,
                        spent: '9150.00',
                        last_order_at: new Date('2026-09-14T10:00:00Z'),
                        first_order_at: new Date('2026-07-01T10:00:00Z'),
                    },
                ];
            if (sql.includes('GROUP BY o.order_type'))
                return [
                    {
                        order_type: 'delivery',
                        completed_count: 17,
                        cancelled_count: 1,
                        spent: '35550.00',
                        last_order_at: null,
                        first_order_at: null,
                    },
                ];
            if (sql.includes('GROUP BY o.source'))
                return [
                    {
                        source: 'call_centre',
                        completed_count: 17,
                        cancelled_count: 1,
                        spent: '35550.00',
                        last_order_at: null,
                        first_order_at: null,
                    },
                ];
            if (sql.includes('completed_count') && !sql.includes('GROUP BY'))
                return [
                    {
                        completed_count: 17,
                        cancelled_count: 1,
                        spent: '35550.00',
                        last_order_at: new Date('2026-09-28T10:00:00Z'),
                        first_order_at: new Date('2026-06-20T10:00:00Z'),
                    },
                ];
            return respond(sql);
        };

        it('breaks the orders down by brand and branch', async () => {
            const { svc } = makeSvc({
                customers: [abdullah],
                respond: summaryRespond,
            });
            const s = await svc.getSummary(412, { tenantId: 6 });
            expect(s.breakdown).toEqual([
                {
                    brand_id: 21,
                    brand_name: 'Fireaway',
                    branch_id: 10,
                    branch_name: 'Pine Avenue',
                    completed_count: 12,
                    cancelled_count: 1,
                    spent: 26400,
                    last_order_at: '2026-09-28T10:00:00.000Z',
                },
                {
                    brand_id: 21,
                    brand_name: 'Fireaway',
                    branch_id: 12,
                    branch_name: 'DHA',
                    completed_count: 5,
                    cancelled_count: 0,
                    spent: 9150,
                    last_order_at: '2026-09-14T10:00:00.000Z',
                },
            ]);
            expect(s.by_order_type[0]).toMatchObject({
                order_type: 'delivery',
                completed_count: 17,
            });
            expect(s.by_source[0]).toMatchObject({
                source: 'call_centre',
                cancelled_count: 1,
            });
            expect(s.orderStats).toEqual({
                completed_count: 17,
                cancelled_count: 1,
                spent: 35550,
                last_order_at: '2026-09-28T10:00:00.000Z',
                first_order_at: '2026-06-20T10:00:00.000Z',
            });
        });

        it('never sends the password hash, or anything not asked for', async () => {
            const { svc } = makeSvc({
                customers: [abdullah],
                respond: summaryRespond,
            });
            const s = (await svc.getSummary(412, {
                tenantId: 6,
            })) as Record<string, unknown>;
            expect(s).not.toHaveProperty('password');
            expect(s).not.toHaveProperty('brandIds');
            expect(JSON.stringify(s)).not.toContain('$2a$10$hash');
            expect(s.name).toBe('Abdullah Arshad');
            expect(s.phone).toBe('03240201350');
        });

        it('applies the viewer’s scope to every breakdown query', async () => {
            const { svc, statsCalls } = makeSvc({
                customers: [abdullah],
                respond: summaryRespond,
            });
            await svc.getSummary(412, {
                tenantId: 6,
                allowedBranchIds: [10],
                orderHistoryDays: 7,
            });
            const queries = statsCalls();
            // list figures + totals + brand/branch + order type + channel
            expect(queries).toHaveLength(5);
            for (const q of queries) {
                expect(q.sql).toContain(FINISHED_ORDERS_SQL);
                expect(q.sql).toContain('o.tenant_id = $2');
                expect(q.sql).toContain('o.branch_id = ANY($3::int[])');
                expect(q.sql).toContain('CAST($4 AS int)');
            }
        });

        it('withholds every spend figure from a no-totals viewer', async () => {
            const { svc } = makeSvc({
                customers: [abdullah],
                respond: summaryRespond,
            });
            const s = await svc.getSummary(412, { tenantId: 6 }, true);
            expect(s.orderStats.spent).toBeNull();
            for (const line of [
                ...s.breakdown,
                ...s.by_order_type,
                ...s.by_source,
            ])
                expect(line.spent).toBeNull();
        });

        it('is a 404 for a customer the viewer cannot see', async () => {
            const { svc } = makeSvc({ customers: [], respond: summaryRespond });
            await expect(
                svc.getSummary(999, { tenantId: 6 }),
            ).rejects.toBeInstanceOf(NotFoundException);
        });
    });
});

describe('CustomersController — hands the viewer’s order scope to the service', () => {
    const make = () => {
        const findAll = jest.fn().mockResolvedValue([]);
        const getSummary = jest.fn().mockResolvedValue({});
        const controller = Object.create(
            CustomersController.prototype,
        ) as unknown as CustomersController;
        Object.assign(controller, { service: { findAll, getSummary } });
        return { controller, findAll, getSummary };
    };
    const viewer = {
        id: 1,
        tenantId: 6,
        allowedBranchIds: [10],
        allowedBrandIds: [23],
        orderHistoryDays: 7,
        permissions: ['customers:view', 'orders:view'],
    };

    it('passes branch access and history window to the list', () => {
        const { controller, findAll } = make();
        void controller.index(viewer);
        expect(findAll).toHaveBeenCalledWith(6, [23], {
            allowedBranchIds: [10],
            orderHistoryDays: 7,
            restrictedSources: null,
            hideTotals: false,
        });
    });

    it('hides totals only from an account literally carrying the restriction', () => {
        const { controller, findAll } = make();
        void controller.index({
            ...viewer,
            permissions: [...viewer.permissions, 'orders:view:no-totals'],
        });
        expect((findAll.mock.calls[0] as unknown[])[2]).toMatchObject({
            hideTotals: true,
        });
    });

    it('passes the same scope to the detail page summary', () => {
        const { controller, getSummary } = make();
        void controller.summary('412', viewer);
        expect(getSummary).toHaveBeenCalledWith(
            412,
            {
                tenantId: 6,
                allowedBranchIds: [10],
                allowedBrandIds: [23],
                orderHistoryDays: 7,
                restrictedSources: null,
            },
            false,
        );
    });
});
