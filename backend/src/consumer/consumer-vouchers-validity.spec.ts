import { ConsumerController } from './consumer.controller';

/**
 * The app's voucher wallet. A voucher takes its coupon's "valid until" date as
 * its expiry; that date is saved as midnight UTC (05:00 in Pakistan), so the
 * voucher used to leave the wallet at 05:00 on the coupon's last day. It now
 * stays for that whole day on the business's clock. The response shape is the
 * one the mobile app already reads.
 */
describe('ConsumerController — voucher expiry', () => {
    type Harness = {
        voucherRepo: unknown;
        discountRepo: unknown;
        getMyVouchers: (req: {
            user: { id: number };
        }) => Promise<Array<{ id: number; expires_at: string | null }>>;
        resolveVoucher: (
            token: string,
        ) => Promise<{ valid: boolean; code: string | null }>;
    };

    const voucher = (over: Record<string, unknown>) => ({
        id: 1,
        tenantId: 6,
        offerId: 20,
        customerId: 99,
        qrToken: 'qr-1',
        status: 'active',
        uses: 0,
        expiresAt: null,
        ...over,
    });

    function makeController(vouchers: Array<Record<string, unknown>>) {
        const query = jest
            .fn()
            .mockResolvedValue([{ timezone: 'Asia/Karachi' }]);
        const controller = Object.create(
            ConsumerController.prototype,
        ) as Harness;
        controller.voucherRepo = {
            find: jest.fn().mockResolvedValue(vouchers),
            findOne: jest.fn().mockResolvedValue(vouchers[0] ?? null),
            manager: { query },
        };
        controller.discountRepo = {
            find: jest
                .fn()
                .mockResolvedValue([{ id: 20, name: 'Welcome', value: 10 }]),
            findOne: jest.fn().mockResolvedValue({
                id: 20,
                name: 'Welcome',
                code: 'WELCOME',
            }),
        };
        return { controller, query };
    }

    const atPkt = (local: string) =>
        jest.useFakeTimers({ now: new Date(`${local}+05:00`) });
    const picked = (day: string) => new Date(day);
    const me = { user: { id: 99 } };

    const savedTenant = process.env.TENANT_ID;
    beforeAll(() => {
        process.env.TENANT_ID = '6';
    });
    afterAll(() => {
        if (savedTenant === undefined) delete process.env.TENANT_ID;
        else process.env.TENANT_ID = savedTenant;
    });
    afterEach(() => jest.useRealTimers());

    describe('GET vouchers/mine', () => {
        const wallet = async (vouchers: Array<Record<string, unknown>>) =>
            (await makeController(vouchers).controller.getMyVouchers(me)).map(
                (v) => v.id,
            );

        it("keeps a voucher through its coupon's last day", async () => {
            const vouchers = [voucher({ expiresAt: picked('2026-11-30') })];
            atPkt('2026-11-30T05:01:00');
            expect(await wallet(vouchers)).toEqual([1]);
            atPkt('2026-11-30T23:59:30');
            expect(await wallet(vouchers)).toEqual([1]);
        });

        it('drops it once that day is over', async () => {
            atPkt('2026-12-01T00:00:30');
            expect(
                await wallet([voucher({ expiresAt: picked('2026-11-30') })]),
            ).toEqual([]);
        });

        it('still drops a voucher on its own clock at that moment', async () => {
            const expiry = new Date('2026-10-12T09:23:11.123Z');
            const vouchers = [voucher({ expiresAt: expiry })];
            jest.useFakeTimers({ now: new Date(expiry.getTime() - 1000) });
            expect(await wallet(vouchers)).toEqual([1]);
            jest.useFakeTimers({ now: new Date(expiry.getTime() + 1000) });
            expect(await wallet(vouchers)).toEqual([]);
        });

        it('sends the stored expiry unchanged', async () => {
            atPkt('2026-11-30T21:00:00');
            const { controller } = makeController([
                voucher({ expiresAt: picked('2026-11-30') }),
            ]);
            const [v] = await controller.getMyVouchers(me);
            expect(v.expires_at).toBe('2026-11-30T00:00:00.000Z');
        });

        it("reads the date on the clock the voucher's tenant runs on", async () => {
            atPkt('2026-11-30T21:00:00');
            const { controller, query } = makeController([
                voucher({ expiresAt: picked('2026-11-30') }),
            ]);
            await controller.getMyVouchers(me);
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('branch_brands'),
                [6],
            );
        });

        it('asks for no timezone for an empty wallet or one without picked dates', async () => {
            const empty = makeController([]);
            expect(await empty.controller.getMyVouchers(me)).toEqual([]);
            expect(empty.query).not.toHaveBeenCalled();

            const open = makeController([voucher({})]);
            expect(await open.controller.getMyVouchers(me)).toHaveLength(1);
            expect(open.query).not.toHaveBeenCalled();
        });
    });

    describe('GET vouchers/resolve (scanned QR)', () => {
        const resolve = (vouchers: Array<Record<string, unknown>>) =>
            makeController(vouchers).controller.resolveVoucher('qr-1');

        it("is valid through the coupon's last day", async () => {
            const vouchers = [voucher({ expiresAt: picked('2026-11-30') })];
            atPkt('2026-11-30T21:00:00');
            expect(await resolve(vouchers)).toMatchObject({
                valid: true,
                code: 'WELCOME',
            });
        });

        it('is invalid once that day is over, and gives no code', async () => {
            const vouchers = [voucher({ expiresAt: picked('2026-11-30') })];
            atPkt('2026-12-01T00:00:30');
            expect(await resolve(vouchers)).toMatchObject({
                valid: false,
                code: null,
            });
        });

        it('stays invalid for a voucher that is not active', async () => {
            atPkt('2026-11-30T21:00:00');
            expect(
                await resolve([
                    voucher({
                        status: 'exhausted',
                        expiresAt: picked('2026-11-30'),
                    }),
                ]),
            ).toMatchObject({ valid: false, code: null });
        });
    });
});
