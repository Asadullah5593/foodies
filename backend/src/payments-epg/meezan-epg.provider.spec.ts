import { EpgError } from './epg.types';
import { MeezanEpgConfig, MeezanEpgProvider } from './meezan-epg.provider';

/**
 * Unit tests for the Meezan EPG provider. `fetch` is stubbed (the FBR spec
 * stubs it the same way) so we assert the wire contract without a network call:
 * paisa conversion, currency, form encoding, errorCode handling, and status
 * parsing (including the version-03 paymentAmountInfo block).
 */

const CONFIG: MeezanEpgConfig = {
    baseUrl: 'https://test.example/payment/rest/',
    userName: 'ibft_merchant',
    password: 'secret',
    currency: '586',
    timeoutMs: 5000,
    defaultLanguage: 'en',
};

type FetchArgs = { url: string; init: RequestInit };

/** Stub global.fetch to return `json`, capturing the request for assertions. */
function stubFetch(json: unknown, status = 200): { calls: FetchArgs[] } {
    const calls: FetchArgs[] = [];
    global.fetch = jest.fn((url: string, init: RequestInit) => {
        calls.push({ url, init });
        return Promise.resolve({
            status,
            text: () =>
                Promise.resolve(
                    typeof json === 'string' ? json : JSON.stringify(json),
                ),
        } as unknown as Response);
    }) as unknown as typeof fetch;
    return { calls };
}

/** Parse the urlencoded body of the last fetch call into a plain object. */
function body(calls: FetchArgs[]): Record<string, string> {
    const last = calls[calls.length - 1];
    return Object.fromEntries(
        new URLSearchParams(last.init.body as string).entries(),
    );
}

afterEach(() => jest.restoreAllMocks());

describe('MeezanEpgProvider — config', () => {
    it('throws EPG_CONFIG_ERROR when credentials are missing', () => {
        expect(
            () => new MeezanEpgProvider({ ...CONFIG, password: '' }),
        ).toThrow(EpgError);
    });

    it('normalises a base URL without a trailing slash', async () => {
        const { calls } = stubFetch({ orderId: 'o', formUrl: 'f' });
        const p = new MeezanEpgProvider({
            ...CONFIG,
            baseUrl: 'https://test.example/payment/rest',
        });
        await p.registerOrder({
            orderNumber: 'FDS-ABC-1',
            amountMajor: 1,
            returnUrl: 'https://app/return',
        });
        expect(calls[0].url).toBe(
            'https://test.example/payment/rest/register.do',
        );
    });
});

describe('MeezanEpgProvider.registerOrder', () => {
    it('sends amount in paisa, currency 586, and the core params', async () => {
        const { calls } = stubFetch({
            orderId: 'md-1',
            formUrl: 'https://pay/form',
            errorCode: '0',
        });
        const p = new MeezanEpgProvider(CONFIG);
        const res = await p.registerOrder({
            orderNumber: 'FDS-ABCD1234-1',
            amountMajor: 500, // -> 50000 paisa
            returnUrl: 'https://app.foodies-pakistan.com/pay/return',
        });

        const b = body(calls);
        expect(b.amount).toBe('50000');
        expect(b.currency).toBe('586');
        expect(b.orderNumber).toBe('FDS-ABCD1234-1');
        expect(b.userName).toBe('ibft_merchant');
        expect(b.returnUrl).toBe('https://app.foodies-pakistan.com/pay/return');
        expect(calls[0].init.method).toBe('POST');
        expect(res).toEqual({
            bankOrderId: 'md-1',
            formUrl: 'https://pay/form',
        });
    });

    it('rounds fractional rupees to the nearest paisa', async () => {
        const { calls } = stubFetch({ orderId: 'o', formUrl: 'f' });
        const p = new MeezanEpgProvider(CONFIG);
        await p.registerOrder({
            orderNumber: 'FDS-X-1',
            amountMajor: 123.45, // float dust -> must be 12345
            returnUrl: 'https://app/return',
        });
        expect(body(calls).amount).toBe('12345');
    });

    it('omits failUrl unless provided', async () => {
        const { calls } = stubFetch({ orderId: 'o', formUrl: 'f' });
        const p = new MeezanEpgProvider(CONFIG);
        await p.registerOrder({
            orderNumber: 'FDS-Y-1',
            amountMajor: 10,
            returnUrl: 'https://app/return',
        });
        expect('failUrl' in body(calls)).toBe(false);
    });

    it('throws EPG_GATEWAY_ERROR carrying the bank errorCode', async () => {
        stubFetch({ errorCode: '5', errorMessage: 'Amount is invalid' });
        const p = new MeezanEpgProvider(CONFIG);
        await expect(
            p.registerOrder({
                orderNumber: 'FDS-Z-1',
                amountMajor: 10,
                returnUrl: 'https://app/return',
            }),
        ).rejects.toMatchObject({
            code: 'EPG_GATEWAY_ERROR',
            gatewayErrorCode: '5',
        });
    });

    it('throws EPG_HTTP_ERROR on HTTP >= 400', async () => {
        stubFetch({}, 500);
        const p = new MeezanEpgProvider(CONFIG);
        await expect(
            p.registerOrder({
                orderNumber: 'FDS-Q-1',
                amountMajor: 10,
                returnUrl: 'https://app/return',
            }),
        ).rejects.toMatchObject({ code: 'EPG_HTTP_ERROR' });
    });

    it('throws EPG_INVALID_RESPONSE on non-JSON', async () => {
        stubFetch('<html>gateway down</html>');
        const p = new MeezanEpgProvider(CONFIG);
        await expect(
            p.registerOrder({
                orderNumber: 'FDS-R-1',
                amountMajor: 10,
                returnUrl: 'https://app/return',
            }),
        ).rejects.toMatchObject({ code: 'EPG_INVALID_RESPONSE' });
    });

    it('throws EPG_INVALID_RESPONSE when orderId/formUrl are absent', async () => {
        stubFetch({ errorCode: '0' });
        const p = new MeezanEpgProvider(CONFIG);
        await expect(
            p.registerOrder({
                orderNumber: 'FDS-S-1',
                amountMajor: 10,
                returnUrl: 'https://app/return',
            }),
        ).rejects.toMatchObject({ code: 'EPG_INVALID_RESPONSE' });
    });
});

describe('MeezanEpgProvider.getOrderStatus', () => {
    it('requires at least one reference', async () => {
        const p = new MeezanEpgProvider(CONFIG);
        await expect(p.getOrderStatus({})).rejects.toMatchObject({
            code: 'EPG_CONFIG_ERROR',
        });
    });

    it('sends orderId (not orderNumber) when both are given', async () => {
        const { calls } = stubFetch({ orderStatus: 2, errorCode: '0' });
        const p = new MeezanEpgProvider(CONFIG);
        await p.getOrderStatus({ bankOrderId: 'md-1', orderNumber: 'FDS-1' });
        const b = body(calls);
        expect(b.orderId).toBe('md-1');
        expect('orderNumber' in b).toBe(false);
    });

    it('parses status 2 and the version-03 paymentAmountInfo block', async () => {
        stubFetch({
            errorCode: '0',
            orderStatus: 2,
            orderNumber: '20260723-1',
            amount: 50000,
            currency: '586',
            paymentAmountInfo: {
                approvedAmount: 50000,
                depositedAmount: 50000,
                refundedAmount: 0,
            },
        });
        const p = new MeezanEpgProvider(CONFIG);
        const s = await p.getOrderStatus({ bankOrderId: 'md-1' });
        expect(s.orderStatus).toBe(2);
        expect(s.amountMinor).toBe(50000);
        expect(s.depositedAmountMinor).toBe(50000);
        expect(s.refundedAmountMinor).toBe(0);
        expect(s.raw).toBeDefined();
    });

    it('tolerates capitalised OrderStatus and omitted paymentAmountInfo', async () => {
        stubFetch({ ErrorCode: '0', OrderStatus: 0 });
        const p = new MeezanEpgProvider(CONFIG);
        const s = await p.getOrderStatus({ orderNumber: 'FDS-1' });
        expect(s.orderStatus).toBe(0);
        expect(s.depositedAmountMinor).toBeUndefined();
    });
});
