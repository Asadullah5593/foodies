import { BadRequestException } from '@nestjs/common';
import { PaymentsService } from './payments.service';

/**
 * The tender clamp: a payment may settle the bill, never exceed it. The POS can
 * submit an amount priced from a quote that went stale in the same moment the
 * order was re-priced (a checkout-page staff discount landing with the
 * placement); recording that gross figure inflated every payments-based report
 * past the money that actually changed hands.
 */
describe('PaymentsService.processPayment clamp', () => {
    type Row = { orderId: number; amount: number; [k: string]: unknown };

    const setup = (opts: {
        totalAmount: number;
        alreadyPaid: number;
        latest?: Row | null;
    }) => {
        const saved: Row[] = [];
        const statusUpdates: unknown[][] = [];
        const paymentRepo = {
            findOne: jest.fn((q: { where: { idempotencyKey?: string } }) =>
                Promise.resolve(
                    q.where.idempotencyKey ? null : (opts.latest ?? null),
                ),
            ),
            create: jest.fn((v: Row) => v),
            save: jest.fn((v: Row) => {
                saved.push(v);
                return Promise.resolve(v);
            }),
        };
        const manager = {
            query: jest.fn((sql: string, params: unknown[]) => {
                if (sql.includes('FOR UPDATE'))
                    return Promise.resolve([
                        {
                            id: params[0],
                            status: 'placed',
                            total_amount: String(opts.totalAmount),
                        },
                    ]);
                if (sql.includes('SUM(amount)'))
                    return Promise.resolve([
                        { total: String(opts.alreadyPaid) },
                    ]);
                statusUpdates.push(params);
                return Promise.resolve([]);
            }),
            getRepository: jest.fn(() => paymentRepo),
        };
        const dataSource = {
            transaction: (fn: (m: typeof manager) => unknown) => fn(manager),
        };
        const service = new PaymentsService(
            paymentRepo as never,
            {} as never,
            dataSource as never,
        );
        return { service, saved, statusUpdates };
    };

    it('records an exact tender untouched and advances the order', async () => {
        const { service, saved, statusUpdates } = setup({
            totalAmount: 100,
            alreadyPaid: 0,
        });
        await service.processPayment(1, 'card', 100);
        expect(saved).toHaveLength(1);
        expect(saved[0].amount).toBe(100);
        expect(statusUpdates).toHaveLength(1);
    });

    it('clamps an over-tender to the outstanding balance', async () => {
        // The staff-discount race: screen quoted 3560.76, server billed 3204.68.
        const { service, saved } = setup({
            totalAmount: 3204.68,
            alreadyPaid: 0,
        });
        await service.processPayment(1, 'card', 3560.76);
        expect(saved).toHaveLength(1);
        expect(saved[0].amount).toBe(3204.68);
    });

    it('clamps a split second tender so the order sums to its total', async () => {
        const { service, saved } = setup({
            totalAmount: 100,
            alreadyPaid: 60,
        });
        await service.processPayment(1, 'card', 45);
        expect(saved[0].amount).toBe(40);
    });

    it('is a no-op returning the latest row when the order is already fully paid', async () => {
        const latest = { orderId: 1, amount: 100 };
        const { service, saved, statusUpdates } = setup({
            totalAmount: 100,
            alreadyPaid: 100,
            latest,
        });
        const res = await service.processPayment(1, 'card', 100);
        expect(saved).toHaveLength(0);
        expect(statusUpdates).toHaveLength(0);
        expect(res).toBe(latest);
    });

    it('still records the zero tender that advances a fully comped order', async () => {
        const { service, saved, statusUpdates } = setup({
            totalAmount: 0,
            alreadyPaid: 0,
        });
        await service.processPayment(1, 'cash', 0);
        expect(saved).toHaveLength(1);
        expect(saved[0].amount).toBe(0);
        expect(statusUpdates).toHaveLength(1);
    });

    it('rejects a negative amount outright', async () => {
        const { service } = setup({ totalAmount: 100, alreadyPaid: 0 });
        await expect(service.processPayment(1, 'cash', -5)).rejects.toThrow(
            BadRequestException,
        );
    });
});
