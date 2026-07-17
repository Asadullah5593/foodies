import { OrdersService } from './orders.service';

/**
 * Cancelling an order reverses its coupon realization AND hands the customer
 * their voucher use back. TypeORM returns `[rows, rowCount]` for UPDATE (not a
 * row list), so the RETURNING rows have to be unwrapped before iterating —
 * getting that wrong silently strands vouchers on 'exhausted' forever.
 */
describe('OrdersService.reverseCouponRealizations', () => {
    type Call = [string, unknown[] | undefined];

    /** Mimics the postgres driver: UPDATE returns [rows, rowCount]. */
    const build = (returning: Array<{ voucher_id: number | null }>) => {
        const calls: Call[] = [];
        const manager = {
            query: jest.fn((sql: string, params?: unknown[]) => {
                calls.push([sql, params]);
                if (sql.includes('UPDATE coupon_realizations')) {
                    return Promise.resolve([returning, returning.length]);
                }
                return Promise.resolve([[], 0]);
            }),
        };
        const service = Object.create(OrdersService.prototype) as OrdersService;
        (service as unknown as { dataSource: unknown }).dataSource = {
            transaction: (cb: (m: unknown) => Promise<void>) => cb(manager),
        };
        const reverse = (
            service as unknown as {
                reverseCouponRealizations: (
                    orderId: number,
                    reason: string,
                ) => Promise<void>;
            }
        ).reverseCouponRealizations.bind(service);
        return { reverse, calls };
    };

    const voucherUpdates = (calls: Call[]) =>
        calls.filter(([sql]) => sql.includes('UPDATE vouchers'));

    it('restores the use on every voucher returned by the reversal', async () => {
        const { reverse, calls } = build([
            { voucher_id: 55 },
            { voucher_id: 66 },
        ]);
        await reverse(100, 'order_cancelled');
        expect(voucherUpdates(calls).map(([, params]) => params)).toEqual([
            [55],
            [66],
        ]);
    });

    it('re-activates an exhausted voucher rather than leaving it stranded', async () => {
        const { reverse, calls } = build([{ voucher_id: 55 }]);
        await reverse(100, 'order_cancelled');
        const [sql] = voucherUpdates(calls)[0];
        expect(sql).toMatch(/uses = GREATEST\(uses - 1, 0\)/);
        expect(sql).toMatch(/WHEN status = 'exhausted' THEN 'active'/);
    });

    it('still reverses the realization itself', async () => {
        const { reverse, calls } = build([]);
        await reverse(100, 'order_cancelled');
        expect(calls[0][0]).toMatch(/UPDATE coupon_realizations/);
        expect(calls[0][1]).toEqual([100, 'order_cancelled']);
    });

    it('touches no voucher for a realization that had none', async () => {
        const { reverse, calls } = build([{ voucher_id: null }]);
        await reverse(100, 'order_cancelled');
        expect(voucherUpdates(calls)).toHaveLength(0);
    });

    it('touches no voucher when nothing was reversed', async () => {
        const { reverse, calls } = build([]);
        await reverse(100, 'order_cancelled');
        expect(voucherUpdates(calls)).toHaveLength(0);
    });
});
