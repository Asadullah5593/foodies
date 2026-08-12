import { OrdersService } from './orders.service';

/**
 * COD tender on the rider's `delivered` transition: money settled at the door
 * is recorded as its own 'cod' method so the order reads Paid and payment
 * reports include it — while shift reconciliation (cash/card/online_transfer
 * buckets only) keeps ignoring money that never passed through the till.
 */
describe('OrdersService.updateDeliveryStatus COD tender', () => {
    const makeSvc = (opts: {
        total: number;
        tendered: boolean;
        alreadyCompleted?: boolean;
        payFails?: boolean;
    }) => {
        const order = {
            id: 1,
            riderId: 9,
            status: 'ready',
            deliveryStatus: 'picked_up',
            totalAmount: opts.total,
            deliveryFailedReason: null,
        };
        const processPayment = opts.payFails
            ? jest.fn().mockRejectedValue(new Error('boom'))
            : jest.fn().mockResolvedValue({});
        const loggerError = jest.fn();
        const svc = Object.create(
            OrdersService.prototype,
        ) as unknown as OrdersService;
        Object.assign(svc, {
            orderRepo: {
                findOne: jest.fn().mockResolvedValue(order),
                update: jest.fn().mockResolvedValue({}),
            },
            dataSource: {
                // Not a DataSource instance, so transitionStatus treats it as an
                // EntityManager and queries it directly.
                query: jest.fn((sql: string) => {
                    if (sql.includes('FROM payments'))
                        return Promise.resolve(
                            opts.tendered ? [{ one: 1 }] : [],
                        );
                    if (sql.includes('FOR UPDATE'))
                        return Promise.resolve([
                            {
                                cur: opts.alreadyCompleted
                                    ? 'completed'
                                    : 'ready',
                            },
                        ]);
                    return Promise.resolve([]);
                }),
            },
            loyaltyService: {
                earnOnOrderComplete: jest.fn().mockResolvedValue(undefined),
            },
            paymentsService: { processPayment },
            pushNotificationService: { notifyConsumerOrder: jest.fn() },
            logger: { error: loggerError, warn: jest.fn(), log: jest.fn() },
            findForRider: jest.fn().mockResolvedValue({ id: 1 }),
        });
        return { svc, processPayment, loggerError };
    };

    it('records the cod tender once when an untendered order is delivered', async () => {
        const { svc, processPayment } = makeSvc({
            total: 577.68,
            tendered: false,
        });
        await svc.updateDeliveryStatus(1, 9, 'delivered');
        expect(processPayment).toHaveBeenCalledTimes(1);
        expect(processPayment).toHaveBeenCalledWith(
            1,
            'cod',
            577.68,
            undefined,
            'cod:order:1',
        );
    });

    it('records nothing when the order already has a tender (POS delivery paid up front)', async () => {
        const { svc, processPayment } = makeSvc({
            total: 500,
            tendered: true,
        });
        await svc.updateDeliveryStatus(1, 9, 'delivered');
        expect(processPayment).not.toHaveBeenCalled();
    });

    it('records nothing for a zero-total order', async () => {
        const { svc, processPayment } = makeSvc({ total: 0, tendered: false });
        await svc.updateDeliveryStatus(1, 9, 'delivered');
        expect(processPayment).not.toHaveBeenCalled();
    });

    it('records nothing when the completion transition was a no-op (already completed)', async () => {
        const { svc, processPayment } = makeSvc({
            total: 500,
            tendered: false,
            alreadyCompleted: true,
        });
        await svc.updateDeliveryStatus(1, 9, 'delivered');
        expect(processPayment).not.toHaveBeenCalled();
    });

    it('never fails the delivery confirmation when the tender write fails', async () => {
        const { svc, loggerError } = makeSvc({
            total: 500,
            tendered: false,
            payFails: true,
        });
        await expect(
            svc.updateDeliveryStatus(1, 9, 'delivered'),
        ).resolves.toEqual({ id: 1 });
        expect(loggerError).toHaveBeenCalled();
    });
});
