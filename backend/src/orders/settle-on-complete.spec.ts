import { BadRequestException, ConflictException } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { KitchenService } from '../kitchen/kitchen.service';
import {
    requiresPaymentToComplete,
    settleMethodsForTaxBasis,
} from './settle-on-complete';

/**
 * A till order whose payment never landed (the tender call dropped after the
 * order was created) must not complete silently: the completer is asked for
 * the method, and the outstanding balance is recorded through the same
 * processPayment checkout uses before the order completes.
 */
describe('settle-on-complete rules', () => {
    it('only gates sources that tender at placement', () => {
        expect(requiresPaymentToComplete('pos')).toBe(true);
        expect(requiresPaymentToComplete('call_centre')).toBe(true);
        expect(requiresPaymentToComplete('kiosk')).toBe(true);
        expect(requiresPaymentToComplete('consumer_app')).toBe(false);
        expect(requiresPaymentToComplete('consumer_web')).toBe(false);
        expect(requiresPaymentToComplete(null)).toBe(false);
    });

    it('offers only tenders that match the GST the order was taxed at', () => {
        expect(settleMethodsForTaxBasis('cash')).toEqual(['cash']);
        expect(settleMethodsForTaxBasis('card')).toEqual([
            'card',
            'online_transfer',
        ]);
        expect(settleMethodsForTaxBasis('split')).toEqual([
            'cash',
            'card',
            'online_transfer',
        ]);
        expect(settleMethodsForTaxBasis(null)).toEqual([
            'cash',
            'card',
            'online_transfer',
        ]);
    });
});

describe('OrdersService completing an unpaid till order', () => {
    const makeSvc = (opts: {
        total: number;
        paid: number;
        source?: string;
        status?: string;
        taxBasis?: string | null;
    }) => {
        const order = {
            id: 38184,
            orderNumber: '002',
            status: opts.status ?? 'placed',
            source: opts.source ?? 'pos',
            orderType: 'dine_in',
            taxBasis: opts.taxBasis === undefined ? 'card' : opts.taxBasis,
            totalAmount: opts.total,
            branchId: 1,
            brandId: 1,
        };
        const processPayment = jest.fn().mockResolvedValue({});
        const query = jest.fn((sql: string) => {
            if (sql.includes('AS paid'))
                return Promise.resolve([
                    { total: String(opts.total), paid: String(opts.paid) },
                ]);
            // The cod helper's "anything tendered?" probe.
            if (sql.includes('FROM payments'))
                return Promise.resolve(opts.paid > 0 ? [{ one: 1 }] : []);
            if (sql.includes('FOR UPDATE'))
                return Promise.resolve([{ cur: order.status }]);
            return Promise.resolve([]);
        });
        const svc = Object.create(
            OrdersService.prototype,
        ) as unknown as OrdersService;
        Object.assign(svc, {
            orderRepo: { findOne: jest.fn().mockResolvedValue(order) },
            dataSource: { query },
            loyaltyService: {
                earnOnOrderComplete: jest.fn().mockResolvedValue(undefined),
            },
            paymentsService: { processPayment },
            pushNotificationService: { notifyConsumerOrder: jest.fn() },
            logger: { error: jest.fn(), warn: jest.fn(), log: jest.fn() },
            findForAdmin: jest.fn().mockResolvedValue({ id: order.id }),
            maybeAutoAssignDeliveryOnPreparing: jest.fn(),
        });
        const transitioned = () =>
            query.mock.calls.some(([sql]) =>
                String(sql).includes('FOR UPDATE'),
            );
        return { svc, processPayment, transitioned };
    };

    it('refuses with PAYMENT_REQUIRED and what the modal needs, completing nothing', async () => {
        const { svc, processPayment, transitioned } = makeSvc({
            total: 2104.92,
            paid: 0,
        });
        const err = await svc
            .updateStatus(38184, null, 'completed')
            .catch((e: unknown) => e);
        expect(err).toBeInstanceOf(ConflictException);
        expect((err as ConflictException).getResponse()).toMatchObject({
            code: 'PAYMENT_REQUIRED',
            order_id: 38184,
            order_number: '002',
            outstanding: 2104.92,
            tax_basis: 'card',
            payment_methods: ['card', 'online_transfer'],
        });
        expect(processPayment).not.toHaveBeenCalled();
        expect(transitioned()).toBe(false);
    });

    it('records the outstanding balance by the chosen method, then completes', async () => {
        const { svc, processPayment, transitioned } = makeSvc({
            total: 2104.92,
            paid: 0,
        });
        await svc.updateStatus(38184, null, 'completed', null, null, 'card');
        expect(processPayment).toHaveBeenCalledWith(
            38184,
            'card',
            2104.92,
            undefined,
            'settle:order:38184:210492',
        );
        expect(transitioned()).toBe(true);
    });

    it('settles only what a part-paid split bill still owes', async () => {
        const { svc, processPayment } = makeSvc({
            total: 1000,
            paid: 600,
            taxBasis: 'split',
        });
        await svc.updateStatus(38184, null, 'completed', null, null, 'card');
        expect(processPayment).toHaveBeenCalledWith(
            38184,
            'card',
            400,
            undefined,
            'settle:order:38184:40000',
        );
    });

    it('rejects a tender that contradicts the GST the order was taxed at', async () => {
        const { svc, processPayment, transitioned } = makeSvc({
            total: 500,
            paid: 0,
            taxBasis: 'cash',
        });
        await expect(
            svc.updateStatus(38184, null, 'completed', null, null, 'card'),
        ).rejects.toBeInstanceOf(BadRequestException);
        expect(processPayment).not.toHaveBeenCalled();
        expect(transitioned()).toBe(false);
    });

    it('completes a fully paid order without asking', async () => {
        const { svc, processPayment, transitioned } = makeSvc({
            total: 500,
            paid: 500,
        });
        await svc.updateStatus(38184, null, 'completed');
        expect(processPayment).not.toHaveBeenCalled();
        expect(transitioned()).toBe(true);
    });

    it('leaves consumer-app orders to the cod tender on completion', async () => {
        const { svc, processPayment } = makeSvc({
            total: 500,
            paid: 0,
            source: 'consumer_app',
        });
        await svc.updateStatus(38184, null, 'completed');
        expect(processPayment).toHaveBeenCalledWith(
            38184,
            'cod',
            500,
            undefined,
            'cod:order:38184',
        );
    });

    it('does not gate transitions other than completion', async () => {
        const { svc, processPayment, transitioned } = makeSvc({
            total: 500,
            paid: 0,
        });
        await svc.updateStatus(38184, null, 'preparing');
        expect(processPayment).not.toHaveBeenCalled();
        expect(transitioned()).toBe(true);
    });

    it('does not re-gate an order that is already completed', async () => {
        const { svc, processPayment } = makeSvc({
            total: 500,
            paid: 0,
            status: 'completed',
        });
        await expect(
            svc.updateStatus(38184, null, 'completed'),
        ).resolves.toBeDefined();
        expect(processPayment).not.toHaveBeenCalled();
    });
});

describe('KitchenService completing an unpaid till order (FOH Packing)', () => {
    it('runs the same settle gate before the transition', async () => {
        const order = { id: 7, branchId: 1, brandId: 1, status: 'ready' };
        const settleBeforeCompletion = jest
            .fn()
            .mockRejectedValue(new ConflictException('PAYMENT_REQUIRED'));
        const query = jest.fn().mockResolvedValue([{ cur: 'ready' }]);
        const svc = Object.create(
            KitchenService.prototype,
        ) as unknown as KitchenService;
        Object.assign(svc, {
            orderRepo: { findOne: jest.fn().mockResolvedValue(order) },
            dataSource: { query },
            ordersService: { settleBeforeCompletion },
        });
        await expect(
            svc.updateStatus(7, 1, 'completed', null, null),
        ).rejects.toBeInstanceOf(ConflictException);
        expect(settleBeforeCompletion).toHaveBeenCalledWith(order, null);
        expect(query).not.toHaveBeenCalled();
    });
});
