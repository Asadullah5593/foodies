import { OrdersService } from './orders.service';

/**
 * The admin order list carries each order's saved customer's own name
 * (`customer_record_name`), so the Orders page can lead with it and flag an
 * order typed under another name ("ordered as …") outside one customer's
 * history too. The names come from one lookup for the page; orders without a
 * saved customer get null.
 */
describe('OrdersService — the saved customer name on the admin list', () => {
    const run = async (
        orders: Array<{ id: number; customerId: number | null }>,
        customers: Array<{ id: number; name: string | null }>,
    ) => {
        const lookups: unknown[] = [];
        const qb: Record<string, unknown> = {};
        for (const m of ['leftJoinAndSelect', 'select', 'addSelect', 'orderBy', 'skip', 'take', 'groupBy', 'andWhere']) {
            qb[m] = () => qb;
        }
        qb.getManyAndCount = () => Promise.resolve([orders.map((o) => ({ ...o, payments: [] })), orders.length]);
        qb.getRawMany = () => Promise.resolve([]);
        qb.getRawOne = () => Promise.resolve({ count: '0' });
        const svc = Object.create(OrdersService.prototype) as unknown as OrdersService;
        Object.assign(svc, {
            orderRepo: { createQueryBuilder: () => qb },
            dataSource: {
                getRepository: () => ({
                    find: (opts: unknown) => {
                        lookups.push(opts);
                        return Promise.resolve(customers);
                    },
                }),
            },
        });
        const res = (await svc.findAllAdmin(1, {})) as { data: Array<Record<string, unknown>> };
        return { rows: res.data, lookups };
    };

    it('names the saved customer behind each order, and null where there is none', async () => {
        const { rows, lookups } = await run(
            [
                { id: 1, customerId: 155 },
                { id: 2, customerId: null },
                { id: 3, customerId: 155 },
                { id: 4, customerId: 9 },
            ],
            [
                { id: 155, name: '  Jahanzeb ' },
                { id: 9, name: null },
            ],
        );
        expect(rows.map((r) => r.customer_record_name)).toEqual(['Jahanzeb', null, 'Jahanzeb', null]);
        // One lookup for the page, each customer once.
        expect(lookups).toHaveLength(1);
        expect(JSON.stringify(lookups[0])).toContain('[155,9]');
    });

    it('skips the lookup when no order on the page has a saved customer', async () => {
        const { rows, lookups } = await run([{ id: 1, customerId: null }], []);
        expect(rows[0].customer_record_name).toBeNull();
        expect(lookups).toHaveLength(0);
    });
});
