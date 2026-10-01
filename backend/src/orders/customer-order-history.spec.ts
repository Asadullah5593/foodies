import { OrdersService } from './orders.service';
import { AdminOrdersController } from './admin-orders.controller';

/**
 * The Customers page's "Orders" button opens the admin order list on one
 * customer (`GET /admin/orders?customer_id=…`). Two rules are pinned here:
 *
 * 1. `customer_id` narrows the list AND its status-tile counts to that
 *    customer — a tile counting everyone over a list showing one person is how
 *    "Completed 214" ends up above three rows.
 * 2. It only ever narrows. The caller's tenant, branch access and brand lock
 *    still apply, so it cannot be used to read someone else's orders.
 */
describe('OrdersService — one customer’s order history', () => {
    /** A query builder that records what it was asked and answers with nothing. */
    const recordingQb = () => {
        const wheres: Array<{ sql: string; params?: Record<string, unknown> }> =
            [];
        const qb: Record<string, unknown> = {};
        for (const method of [
            'leftJoinAndSelect',
            'select',
            'addSelect',
            'orderBy',
            'skip',
            'take',
            'groupBy',
        ]) {
            qb[method] = () => qb;
        }
        qb.andWhere = (sql: string, params?: Record<string, unknown>) => {
            wheres.push({ sql, params });
            return qb;
        };
        qb.getManyAndCount = () => Promise.resolve([[], 0]);
        qb.getRawMany = () => Promise.resolve([]);
        qb.getRawOne = () => Promise.resolve({ count: '0' });
        return { qb, wheres };
    };

    const run = async (
        filters: Parameters<OrdersService['findAllAdmin']>[1],
        scope: {
            allowedBranchIds?: number[] | null;
            allowedBrandIds?: number[] | null;
        } = {},
    ) => {
        const builders: Array<ReturnType<typeof recordingQb>> = [];
        const svc = Object.create(
            OrdersService.prototype,
        ) as unknown as OrdersService;
        Object.assign(svc, {
            orderRepo: {
                createQueryBuilder: () => {
                    const b = recordingQb();
                    builders.push(b);
                    return b.qb;
                },
            },
        });
        await svc.findAllAdmin(
            6,
            filters,
            scope.allowedBranchIds,
            scope.allowedBrandIds,
        );
        // In the order findAllAdmin builds them.
        const [data, statusCounts, needsRiderCount] = builders;
        return { data, statusCounts, needsRiderCount, all: builders };
    };

    const customerWhere = (b: ReturnType<typeof recordingQb>) =>
        b.wheres.find((w) => w.params && 'customerId' in w.params);

    it('lists only that customer’s orders', async () => {
        const { data } = await run({ customer_id: 412 });
        expect(customerWhere(data)?.sql).toBe('o.customerId = :customerId');
        expect(customerWhere(data)?.params).toEqual({ customerId: 412 });
    });

    it('counts the status tiles over the same customer', async () => {
        const { statusCounts, needsRiderCount } = await run({
            customer_id: 412,
        });
        expect(customerWhere(statusCounts)?.params).toEqual({
            customerId: 412,
        });
        expect(customerWhere(needsRiderCount)?.params).toEqual({
            customerId: 412,
        });
    });

    it('leaves the list alone when no customer is asked for', async () => {
        const { all } = await run({});
        expect(all).toHaveLength(3);
        for (const b of all) expect(customerWhere(b)).toBeUndefined();
    });

    it('sets no date bound of its own — a history is every order', async () => {
        const { data } = await run({ customer_id: 412 });
        expect(data.wheres.some((w) => w.sql.includes('placed_at'))).toBe(
            false,
        );
    });

    it('still honours a date range, to narrow the history', async () => {
        const { data } = await run({
            customer_id: 412,
            date_from: '2026-09-01',
            date_to: '2026-09-30',
        });
        expect(customerWhere(data)).toBeDefined();
        expect(
            data.wheres.find((w) => w.params && 'dateFrom' in w.params)?.params,
        ).toEqual({ dateFrom: '2026-09-01' });
        expect(
            data.wheres.find((w) => w.params && 'dateTo' in w.params)?.params,
        ).toEqual({ dateTo: '2026-09-30' });
    });

    it('never widens scope: tenant, branches and brand lock still apply', async () => {
        const { all } = await run(
            { customer_id: 412 },
            { allowedBranchIds: [10], allowedBrandIds: [23] },
        );
        for (const b of all) {
            expect(customerWhere(b)).toBeDefined();
            expect(
                b.wheres.find((w) => w.params && 'tenantId' in w.params)
                    ?.params,
            ).toEqual({ tenantId: 6 });
            expect(
                b.wheres.find((w) => w.params && 'allowedBranchIds' in w.params)
                    ?.params,
            ).toEqual({ allowedBranchIds: [10] });
            expect(
                b.wheres.find((w) => w.params && 'allowedBrandIds' in w.params)
                    ?.params,
            ).toEqual({ allowedBrandIds: [23] });
        }
    });
});

describe('AdminOrdersController — customer_id on the order list', () => {
    const call = (customerId?: string) => {
        const findAllAdmin = jest.fn().mockResolvedValue({ data: [] });
        const controller = Object.create(
            AdminOrdersController.prototype,
        ) as unknown as AdminOrdersController;
        Object.assign(controller, { service: { findAllAdmin } });
        const u = undefined as unknown as string;
        void controller.index(
            { id: 1, tenantId: 6, permissions: ['orders:view'] },
            u,
            u,
            u,
            u,
            u,
            u,
            u,
            u,
            u,
            u,
            u,
            u,
            u,
            customerId,
        );
        const filters = (
            findAllAdmin.mock.calls[0] as [unknown, { customer_id?: number }]
        )[1];
        return filters.customer_id;
    };

    it('passes a whole positive id through', () => {
        expect(call('412')).toBe(412);
    });

    it('ignores anything else instead of guessing', () => {
        for (const bad of [undefined, '', 'abc', '0', '-4', '1.5', '12 OR 1=1'])
            expect(call(bad)).toBeUndefined();
    });
});
