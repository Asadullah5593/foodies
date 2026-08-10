import { PaymentGatewayProvider } from './epg.types';
import { EpgPaymentSession } from './epg-payment-session.entity';
import { EpgService } from './epg.service';

/**
 * Unit tests for the confirmation state machine — the money-moving core.
 * Everything is mocked (gateway, session repo, OrdersService, PaymentsService)
 * so we can assert each branch precisely: paid, declined, expiry, bank-down,
 * double-confirm idempotency, price mismatch, and paid-but-order-failed.
 */

function makeSession(over: Partial<EpgPaymentSession> = {}): EpgPaymentSession {
    return {
        id: 1,
        publicToken: 'tok-1',
        tenantId: 7,
        branchId: 10,
        status: 'pending',
        orderNumber: 'FDSABC123',
        bankOrderId: 'md-1',
        formUrl: 'https://pay/form',
        amountMinor: 50000, // PKR 500 (stored as bigint -> string at runtime; Number() in code)
        currency: '586',
        cart: { branch_id: 10, order_type: 'delivery', items: [{}] },
        customerId: null,
        customerPhone: '03001234567',
        idempotencyKey: 'epg:FDSABC123',
        createdOrderGroupId: null,
        bankOrderStatus: null,
        lastPolledAt: null,
        expiresAt: new Date(Date.now() + 10 * 60 * 1000),
        rawStatus: null,
        failureReason: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ...over,
    } as EpgPaymentSession;
}

function build(opts: {
    gateway: Partial<PaymentGatewayProvider>;
    createOrder?: jest.Mock;
    processPayment?: jest.Mock;
}) {
    const updates: Array<Partial<EpgPaymentSession>> = [];
    const sessionRepo = {
        update: jest.fn((_id: number, patch: Partial<EpgPaymentSession>) => {
            updates.push(patch);
            return Promise.resolve();
        }),
    };
    const orders = {
        createOrder:
            opts.createOrder ??
            jest.fn().mockResolvedValue({
                order_group_id: 'grp-1',
                orders: [{ id: 100, total_amount: 500 }],
            }),
    };
    const payments = {
        processPayment: opts.processPayment ?? jest.fn().mockResolvedValue({}),
    };
    const service = new EpgService(
        opts.gateway as PaymentGatewayProvider,
        sessionRepo as never,
        {} as never, // branchRepo (unused in confirm paths)
        orders as never,
        payments as never,
    );
    return { service, updates, sessionRepo, orders, payments };
}

describe('EpgService.pollAndConfirm', () => {
    it('status 2 -> creates order, records card payment, marks paid', async () => {
        const { service, orders, payments, updates } = build({
            gateway: {
                getOrderStatus: jest
                    .fn()
                    .mockResolvedValue({ orderStatus: 2, raw: { ok: 1 } }),
            },
        });
        const out = await service.pollAndConfirm(makeSession());

        expect(orders.createOrder).toHaveBeenCalledTimes(1);
        // createOrder(cart, tenantId, createdBy=null, source, customerId, allowedBrandIds=null, idemKey)
        expect(orders.createOrder).toHaveBeenCalledWith(
            expect.objectContaining({ order_type: 'delivery' }),
            7,
            null,
            'consumer_app',
            null,
            null,
            'epg:FDSABC123',
        );
        // card tender recorded for the created order, keyed for idempotency
        expect(payments.processPayment).toHaveBeenCalledWith(
            100,
            'card',
            500,
            'md-1',
            'epg:FDSABC123:100',
        );
        expect(out.status).toBe('paid');
        expect(out.createdOrderGroupId).toBe('grp-1');
        expect(updates.at(-1)).toMatchObject({
            status: 'paid',
            createdOrderGroupId: 'grp-1',
        });
    });

    it('status 6 (declined) -> failed, no order created', async () => {
        const { service, orders } = build({
            gateway: {
                getOrderStatus: jest
                    .fn()
                    .mockResolvedValue({ orderStatus: 6, raw: {} }),
            },
        });
        const out = await service.pollAndConfirm(makeSession());
        expect(out.status).toBe('failed');
        expect(orders.createOrder).not.toHaveBeenCalled();
    });

    it('status 0 before expiry -> stays pending', async () => {
        const { service } = build({
            gateway: {
                getOrderStatus: jest
                    .fn()
                    .mockResolvedValue({ orderStatus: 0, raw: {} }),
            },
        });
        const out = await service.pollAndConfirm(makeSession());
        expect(out.status).toBe('pending');
    });

    it('status 0 past expiry -> expired', async () => {
        const { service } = build({
            gateway: {
                getOrderStatus: jest
                    .fn()
                    .mockResolvedValue({ orderStatus: 0, raw: {} }),
            },
        });
        const out = await service.pollAndConfirm(
            makeSession({ expiresAt: new Date(Date.now() - 1000) }),
        );
        expect(out.status).toBe('expired');
    });

    it('status 1 past expiry -> error (manual review, never silently expired)', async () => {
        const { service } = build({
            gateway: {
                getOrderStatus: jest
                    .fn()
                    .mockResolvedValue({ orderStatus: 1, raw: {} }),
            },
        });
        const out = await service.pollAndConfirm(
            makeSession({ expiresAt: new Date(Date.now() - 1000) }),
        );
        expect(out.status).toBe('error');
    });

    it('bank unreachable -> stays pending (never expires a possibly-paid order)', async () => {
        const { service, updates } = build({
            gateway: {
                getOrderStatus: jest
                    .fn()
                    .mockRejectedValue(new Error('ECONNRESET')),
            },
        });
        const out = await service.pollAndConfirm(
            makeSession({ expiresAt: new Date(Date.now() - 1000) }),
        );
        expect(out.status).toBe('pending');
        // only lastPolledAt was touched, no terminal transition
        expect(Object.keys(updates.at(-1) ?? {})).toEqual(['lastPolledAt']);
    });

    it('already-terminal session is untouched (idempotent re-poll)', async () => {
        const getOrderStatus = jest.fn();
        const { service, orders } = build({ gateway: { getOrderStatus } });
        const out = await service.pollAndConfirm(
            makeSession({ status: 'paid' }),
        );
        expect(getOrderStatus).not.toHaveBeenCalled();
        expect(orders.createOrder).not.toHaveBeenCalled();
        expect(out.status).toBe('paid');
    });

    it('paid but createOrder throws -> error (money captured, flag for refund)', async () => {
        const { service } = build({
            gateway: {
                getOrderStatus: jest
                    .fn()
                    .mockResolvedValue({ orderStatus: 2, raw: {} }),
            },
            createOrder: jest
                .fn()
                .mockRejectedValue(new Error('item out of stock')),
        });
        const out = await service.pollAndConfirm(makeSession());
        expect(out.status).toBe('error');
        expect(out.failureReason).toContain('paid but order creation failed');
    });

    it('price mismatch (menu changed in window) -> error + flagged', async () => {
        const { service } = build({
            gateway: {
                getOrderStatus: jest
                    .fn()
                    .mockResolvedValue({ orderStatus: 2, raw: {} }),
            },
            // charged 500 (amountMinor 50000) but order re-priced to 550
            createOrder: jest.fn().mockResolvedValue({
                order_group_id: 'grp-2',
                orders: [{ id: 101, total_amount: 550 }],
            }),
        });
        const out = await service.pollAndConfirm(makeSession());
        expect(out.status).toBe('error');
        expect(out.failureReason).toContain('price mismatch');
    });

    it('payment recording failure -> error (order exists, tender not recorded)', async () => {
        const { service } = build({
            gateway: {
                getOrderStatus: jest
                    .fn()
                    .mockResolvedValue({ orderStatus: 2, raw: {} }),
            },
            processPayment: jest.fn().mockRejectedValue(new Error('db down')),
        });
        const out = await service.pollAndConfirm(makeSession());
        expect(out.status).toBe('error');
        expect(out.createdOrderGroupId).toBe('grp-1');
    });
});
