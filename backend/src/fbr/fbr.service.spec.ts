import { Repository } from 'typeorm';
import { Branch } from '../entities/branch.entity';
import { Order } from '../entities/order.entity';
import { FbrService } from './fbr.service';

/**
 * FbrService unit tests: payload construction and the non-blocking
 * fiscalize/fallback/retry contract. No real HTTP — fetch is mocked.
 */

const PRIOR_REAL = '515011DDD9999011111111';

function makeBranch(over: Partial<Branch> = {}): Branch {
    return {
        id: 7,
        name: 'Test Branch',
        timezone: 'Asia/Karachi',
        fbrEnabled: true,
        fbrPosId: '943050',
        fbrToken: 'test-token',
        fbrEnvironment: 'sandbox',
        fbrPctCode: null,
        ...over,
    } as Branch;
}

function makeOrder(over: Partial<Order> = {}): Order {
    return {
        id: 42,
        branchId: 7,
        orderId: 'FDS-A7K2M9QX',
        orderNumber: '014',
        totalAmount: 1150,
        taxAmount: 150,
        discountAmount: 100,
        taxBasis: 'cash',
        customerName: 'Ayesha',
        customerPhone: '03001234567',
        placedAt: new Date('2026-07-19T12:00:00Z'),
        payments: [],
        fbrInvoiceNumber: null,
        fbrNumberSource: null,
        orderItems: [
            {
                id: 1,
                menuItemId: 11,
                nameSnapshot: 'Zinger Burger',
                quantity: 2,
                subtotal: 700,
            },
            {
                id: 2,
                menuItemId: 12,
                nameSnapshot: 'Fries',
                quantity: 1,
                subtotal: 300,
            },
        ],
        ...over,
    } as unknown as Order;
}

function makeService(order: Order | null, branch: Branch | null) {
    if (order && branch) (order as { branch?: Branch }).branch = branch;
    const orderRepo = {
        // fiscalizeOrder loads by id; latestRealFbrNumber queries by
        // fbrNumberSource — dispatch on the where clause.
        findOne: jest.fn(
            (args: {
                where: { fbrNumberSource?: string };
            }): Promise<unknown> =>
                args?.where?.fbrNumberSource === 'fbr'
                    ? Promise.resolve({ id: 9, fbrInvoiceNumber: PRIOR_REAL })
                    : Promise.resolve(order),
        ),
        update: jest.fn(() => Promise.resolve(undefined)),
    };
    const branchRepo = {};
    const service = new FbrService(
        orderRepo as unknown as Repository<Order>,
        branchRepo as unknown as Repository<Branch>,
    );
    return { service, orderRepo };
}

describe('FbrService.buildPayload', () => {
    const service = makeService(null, null).service;

    it('maps the order onto the FBR IMS invoice shape', () => {
        const payload = service.buildPayload(makeOrder(), makeBranch());
        expect(payload.InvoiceNumber).toBe('FDS-A7K2M9QX');
        expect(payload.USIN).toBe('FDS-A7K2M9QX');
        expect(payload.POSID).toBe('943050');
        expect(payload.TotalBillAmount).toBe(1150);
        expect(payload.TotalTaxCharged).toBe(150);
        expect(payload.TotalSaleValue).toBe(1000); // bill minus tax
        expect(payload.Discount).toBe(100);
        expect(payload.TotalQuantity).toBe(3);
        expect(payload.InvoiceType).toBe(1);
        expect(payload.BuyerName).toBe('Ayesha');
        expect(payload.Items).toHaveLength(2);
        expect(payload.Items[0].ItemName).toBe('Zinger Burger');
        expect(payload.Items[0].PCTCode).toBe('98211000'); // restaurant default
    });

    it('allocates per-line tax proportionally and the lines sum to the total', () => {
        const payload = service.buildPayload(makeOrder(), makeBranch());
        const lineTax = payload.Items.reduce((s, l) => s + l.TaxCharged, 0);
        expect(Math.round(lineTax * 100) / 100).toBe(150);
        // 700/1000 and 300/1000 of 150
        expect(payload.Items[0].TaxCharged).toBe(105);
        expect(payload.Items[1].TaxCharged).toBe(45);
    });

    it('prefers the branch PCT code over the default', () => {
        const payload = service.buildPayload(
            makeOrder(),
            makeBranch({ fbrPctCode: '11223344' }),
        );
        expect(payload.Items.every((l) => l.PCTCode === '11223344')).toBe(true);
    });

    it('derives PaymentMode from the tender basis stamped at placement', () => {
        const b = makeBranch();
        expect(
            service.buildPayload(makeOrder({ taxBasis: 'cash' }), b)
                .PaymentMode,
        ).toBe(1);
        expect(
            service.buildPayload(makeOrder({ taxBasis: 'card' }), b)
                .PaymentMode,
        ).toBe(2);
        expect(
            service.buildPayload(makeOrder({ taxBasis: 'split' }), b)
                .PaymentMode,
        ).toBe(5);
    });

    it('formats DateTime in the branch timezone', () => {
        const payload = service.buildPayload(makeOrder(), makeBranch());
        // 12:00 UTC = 17:00 in Asia/Karachi (+05:00)
        expect(payload.DateTime).toBe('2026-07-19 17:00:00');
    });
});

describe('FbrService.fiscalizeOrder', () => {
    const realFetch = global.fetch;
    afterEach(() => {
        global.fetch = realFetch;
        jest.restoreAllMocks();
        delete process.env.FBR_RETRY_DELAY_MS;
    });

    const okResponse = (body: unknown) =>
        ({
            status: 200,
            json: () => Promise.resolve(body),
        }) as unknown as Response;

    it('FBR disabled: stamps the branch fallback number, calls FBR never', async () => {
        const fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
        const { service, orderRepo } = makeService(
            makeOrder(),
            makeBranch({ fbrEnabled: false }),
        );
        await service.fiscalizeOrder(42);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(orderRepo.update).toHaveBeenCalledWith(42, {
            fbrInvoiceNumber: PRIOR_REAL,
            fbrNumberSource: 'fallback',
        });
    });

    it('FBR disabled and no prior real number: stamps nothing', async () => {
        const { service, orderRepo } = makeService(
            makeOrder(),
            makeBranch({ fbrEnabled: false }),
        );
        orderRepo.findOne.mockImplementation(
            (args: { where: { fbrNumberSource?: string } }) =>
                args?.where?.fbrNumberSource === 'fbr'
                    ? Promise.resolve(null)
                    : Promise.resolve(makeOrder()),
        );
        await service.fiscalizeOrder(42);
        expect(orderRepo.update).not.toHaveBeenCalled();
    });

    it('success: stores the number FBR returned, source "fbr"', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve(
                okResponse({ InvoiceNumber: '515011DDD0000000000042' }),
            ),
        ) as unknown as typeof fetch;
        const { service, orderRepo } = makeService(makeOrder(), makeBranch());
        await service.fiscalizeOrder(42);
        expect(orderRepo.update).toHaveBeenCalledWith(42, {
            fbrInvoiceNumber: '515011DDD0000000000042',
            fbrNumberSource: 'fbr',
        });
    });

    it('FBR unreachable: sale is NOT blocked — fallback stamped, one retry succeeds later', async () => {
        process.env.FBR_RETRY_DELAY_MS = '25';
        const fetchMock = jest
            .fn()
            .mockRejectedValueOnce(new Error('ECONNREFUSED'))
            .mockResolvedValueOnce(
                okResponse({ InvoiceNumber: '515011DDD0000000000043' }),
            );
        global.fetch = fetchMock as unknown as typeof fetch;
        const { service, orderRepo } = makeService(makeOrder(), makeBranch());
        await service.fiscalizeOrder(42); // resolves despite the failure
        expect(orderRepo.update).toHaveBeenCalledWith(42, {
            fbrInvoiceNumber: PRIOR_REAL,
            fbrNumberSource: 'fallback',
        });
        // The single background retry fires and overwrites with the real number.
        await new Promise((r) => setTimeout(r, 120));
        expect(fetchMock).toHaveBeenCalledTimes(2);
        expect(orderRepo.update).toHaveBeenLastCalledWith(42, {
            fbrInvoiceNumber: '515011DDD0000000000043',
            fbrNumberSource: 'fbr',
        });
    });

    it('FBR service reports an error body: treated as failure, fallback stamped', async () => {
        global.fetch = jest.fn(() =>
            Promise.resolve(okResponse({ Message: 'Invalid POSID' })),
        ) as unknown as typeof fetch;
        const { service, orderRepo } = makeService(makeOrder(), makeBranch());
        await service.fiscalizeOrder(42);
        expect(orderRepo.update).toHaveBeenCalledWith(42, {
            fbrInvoiceNumber: PRIOR_REAL,
            fbrNumberSource: 'fallback',
        });
    });

    it('enabled but credentials missing: fallback, no call, no retry', async () => {
        const fetchMock = jest.fn();
        global.fetch = fetchMock as unknown as typeof fetch;
        const { service, orderRepo } = makeService(
            makeOrder(),
            makeBranch({ fbrToken: null }),
        );
        await service.fiscalizeOrder(42);
        expect(fetchMock).not.toHaveBeenCalled();
        expect(orderRepo.update).toHaveBeenCalledWith(42, {
            fbrInvoiceNumber: PRIOR_REAL,
            fbrNumberSource: 'fallback',
        });
    });
});
