import { OrdersService } from './orders.service';
import { RiderSupervisorService } from '../rider-hrm/rider-supervisor.service';
import { tripDurationSeconds, tripTimeFields } from './trip-time';

/**
 * Delivery trip time = the rider's "picked up" tap → "delivered" tap.
 *
 * The two moments are stamped by the server when the rider's existing status
 * call arrives (so the mobile app needs no change), and never derived from
 * `completed_at`: staff can complete a delivery order without the rider
 * tapping anything.
 */
describe('trip duration', () => {
    const at = (iso: string) => new Date(iso);

    it('is the time from pickup to delivery', () => {
        expect(
            tripDurationSeconds(
                at('2026-10-02T10:00:00Z'),
                at('2026-10-02T10:23:30Z'),
            ),
        ).toBe(23 * 60 + 30);
    });

    it('is unknown until both moments are recorded', () => {
        expect(
            tripDurationSeconds(null, at('2026-10-02T10:23:00Z')),
        ).toBeNull();
        expect(
            tripDurationSeconds(at('2026-10-02T10:00:00Z'), null),
        ).toBeNull();
        expect(tripDurationSeconds(undefined, undefined)).toBeNull();
    });

    it('is unknown rather than negative when the taps are out of order', () => {
        expect(
            tripDurationSeconds(
                at('2026-10-02T10:23:00Z'),
                at('2026-10-02T10:00:00Z'),
            ),
        ).toBeNull();
    });

    it('gives admin payloads the two moments and the duration', () => {
        expect(
            tripTimeFields({
                pickedUpAt: at('2026-10-02T10:00:00Z'),
                deliveredAt: at('2026-10-02T10:23:00Z'),
            }),
        ).toEqual({
            picked_up_at: '2026-10-02T10:00:00.000Z',
            delivered_at: '2026-10-02T10:23:00.000Z',
            trip_duration_seconds: 1380,
        });
        expect(tripTimeFields({})).toEqual({
            picked_up_at: null,
            delivered_at: null,
            trip_duration_seconds: null,
        });
    });
});

describe('OrdersService — stamping the rider taps', () => {
    const makeSvc = (opts: { status?: string } = {}) => {
        const order = {
            id: 1,
            riderId: 9,
            // Any order status: the rider can tap on an order staff already
            // completed, and the trip is recorded all the same.
            status: opts.status ?? 'ready',
            source: 'pos',
            orderType: 'delivery',
            deliveryStatus: 'accepted',
            totalAmount: 500,
            deliveryFailedReason: null,
        };
        const update = jest.fn().mockResolvedValue({});
        const svc = Object.create(
            OrdersService.prototype,
        ) as unknown as OrdersService;
        Object.assign(svc, {
            orderRepo: { findOne: jest.fn().mockResolvedValue(order), update },
            dataSource: {
                query: jest.fn((sql: string) =>
                    Promise.resolve(
                        sql.includes('FOR UPDATE')
                            ? [{ cur: order.status }]
                            : [],
                    ),
                ),
            },
            loyaltyService: {
                earnOnOrderComplete: jest.fn().mockResolvedValue(undefined),
            },
            paymentsService: { processPayment: jest.fn() },
            pushNotificationService: { notifyConsumerOrder: jest.fn() },
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
            findForRider: jest.fn().mockResolvedValue({ id: 1 }),
        });
        /** The raw SQL a stamped column was set to, or undefined if untouched. */
        const stamp = (column: 'pickedUpAt' | 'deliveredAt') => {
            const calls = update.mock.calls as Array<
                [unknown, Record<string, unknown>]
            >;
            const set = calls[0][1];
            const value = set[column];
            return typeof value === 'function'
                ? (value as () => string)()
                : value;
        };
        return { svc, update, stamp };
    };

    it('stamps the pickup when the rider marks the order picked up', async () => {
        const { svc, update, stamp } = makeSvc();
        await svc.updateDeliveryStatus(1, 9, 'picked_up');
        expect(update).toHaveBeenCalledWith(
            { id: 1 },
            expect.objectContaining({ deliveryStatus: 'picked_up' }),
        );
        // First tap wins: a repeated or retried call cannot move the time.
        expect(stamp('pickedUpAt')).toBe('COALESCE(picked_up_at, now())');
        expect(stamp('deliveredAt')).toBeUndefined();
    });

    it('stamps the delivery when the rider marks the order delivered', async () => {
        const { svc, stamp } = makeSvc();
        await svc.updateDeliveryStatus(1, 9, 'delivered');
        expect(stamp('deliveredAt')).toBe('COALESCE(delivered_at, now())');
        expect(stamp('pickedUpAt')).toBeUndefined();
    });

    it('still stamps on an order staff already completed', async () => {
        const { svc, stamp } = makeSvc({ status: 'completed' });
        await svc.updateDeliveryStatus(1, 9, 'picked_up');
        expect(stamp('pickedUpAt')).toBe('COALESCE(picked_up_at, now())');
    });

    it('stamps nothing for a failed delivery', async () => {
        const { svc, stamp } = makeSvc();
        await svc.updateDeliveryStatus(1, 9, 'delivery_failed', 'No answer');
        expect(stamp('pickedUpAt')).toBeUndefined();
        expect(stamp('deliveredAt')).toBeUndefined();
    });

    it('answers the rider with the same payload as before', async () => {
        const { svc } = makeSvc();
        await expect(
            svc.updateDeliveryStatus(1, 9, 'picked_up'),
        ).resolves.toEqual({ id: 1 });
    });
});

describe('RiderSupervisor — trip time on the delivery orders list', () => {
    const run = async (opts: {
        rows: unknown[];
        avg: { avg_seconds: string | null; trips: string } | undefined;
    }) => {
        const wheres: string[] = [];
        const makeQb = () => {
            const qb: Record<string, unknown> = {};
            let isTripQuery = false;
            for (const m of [
                'where',
                'andWhere',
                'addSelect',
                'groupBy',
                'orderBy',
                'skip',
                'take',
                'leftJoinAndSelect',
            ]) {
                qb[m] = (sql: unknown) => {
                    if (m === 'andWhere' && isTripQuery)
                        wheres.push(String(sql));
                    return qb;
                };
            }
            qb.select = (sql: unknown) => {
                isTripQuery = String(sql).includes('AVG(');
                return qb;
            };
            qb.getRawMany = () =>
                Promise.resolve(isTripQuery && opts.avg ? [opts.avg] : []);
            qb.getManyAndCount = () =>
                Promise.resolve([opts.rows, opts.rows.length]);
            return qb;
        };
        const service = new RiderSupervisorService(
            { createQueryBuilder: makeQb } as never,
            { query: () => Promise.resolve([]) } as never,
        );
        const res = await service.listDeliveryOrders({ tenantId: 1 }, {});
        return { res, wheres };
    };

    it('gives each row its pickup, delivery and trip duration', async () => {
        const { res } = await run({
            rows: [
                {
                    id: 7,
                    totalAmount: 100,
                    deliveryFee: 0,
                    pickedUpAt: new Date('2026-10-02T10:00:00Z'),
                    deliveredAt: new Date('2026-10-02T10:23:00Z'),
                },
                { id: 8, totalAmount: 100, deliveryFee: 0 },
            ],
            avg: undefined,
        });
        expect(res.data[0]).toMatchObject({
            picked_up_at: '2026-10-02T10:00:00.000Z',
            delivered_at: '2026-10-02T10:23:00.000Z',
            trip_duration_seconds: 1380,
        });
        expect(res.data[1]).toMatchObject({
            picked_up_at: null,
            delivered_at: null,
            trip_duration_seconds: null,
        });
    });

    it('averages only trips with both taps recorded, in order', async () => {
        const { res, wheres } = await run({
            rows: [],
            avg: { avg_seconds: '1440.4', trips: '12' },
        });
        expect(res.trip_time).toEqual({ trips: 12, average_seconds: 1440 });
        expect(wheres).toEqual(
            expect.arrayContaining([
                'o.picked_up_at IS NOT NULL',
                'o.delivered_at IS NOT NULL',
                'o.delivered_at >= o.picked_up_at',
            ]),
        );
    });

    it('reports no average, not zero, when there are no trips', async () => {
        const { res } = await run({
            rows: [],
            avg: { avg_seconds: null, trips: '0' },
        });
        expect(res.trip_time).toEqual({ trips: 0, average_seconds: null });
    });
});
