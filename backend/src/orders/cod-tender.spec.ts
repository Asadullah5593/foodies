import { OrdersService } from './orders.service';

/**
 * COD tender on completion of a consumer-app order: money settled in cash at
 * the door (rider `delivered`) or at the counter (pickup completed from the
 * till/KDS) is recorded as its own 'cod' method so the order reads Paid and
 * payment reports include it — while shift reconciliation (cash/card/
 * online_transfer buckets only) keeps ignoring money that never passed through
 * the till.
 */
describe('OrdersService COD tender on completion', () => {
    const makeSvc = (opts: {
        total: number;
        tendered: boolean;
        alreadyCompleted?: boolean;
        payFails?: boolean;
        source?: string;
        orderType?: string;
    }) => {
        const order = {
            id: 1,
            riderId: 9,
            status: 'ready',
            source: opts.source ?? 'consumer_app',
            orderType: opts.orderType ?? 'delivery',
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
            findForAdmin: jest.fn().mockResolvedValue({ id: 1 }),
            inventoryConsumptionService: {
                reverseConsumptionForOrder: jest.fn(),
            },
            reverseCouponRealizations: jest.fn(),
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

    it('never invents a tender for a non-consumer-app source', async () => {
        const { svc, processPayment } = makeSvc({
            total: 500,
            tendered: false,
            source: 'pos',
        });
        await svc.updateDeliveryStatus(1, 9, 'delivered');
        expect(processPayment).not.toHaveBeenCalled();
    });

    it('records the cod tender when a consumer-app pickup is completed from the till', async () => {
        const { svc, processPayment } = makeSvc({
            total: 810.84,
            tendered: false,
            orderType: 'pickup',
        });
        await svc.updateStatus(1, null, 'completed');
        expect(processPayment).toHaveBeenCalledTimes(1);
        expect(processPayment).toHaveBeenCalledWith(
            1,
            'cod',
            810.84,
            undefined,
            'cod:order:1',
        );
    });

    it('records nothing when a POS order is completed from the till', async () => {
        const { svc, processPayment } = makeSvc({
            total: 500,
            tendered: true,
            source: 'pos',
            orderType: 'dine_in',
        });
        await svc.updateStatus(1, null, 'completed');
        expect(processPayment).not.toHaveBeenCalled();
    });

    it('records nothing when the till transition is not to completed', async () => {
        const { svc, processPayment } = makeSvc({
            total: 500,
            tendered: false,
            orderType: 'pickup',
        });
        await svc.updateStatus(1, null, 'preparing');
        expect(processPayment).not.toHaveBeenCalled();
    });
});
