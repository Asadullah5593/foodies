import { CouponsService } from './coupons.service';

/**
 * A coupon rename must follow through to its already-issued vouchers (whose
 * `code` embeds the coupon code), so POS — which redeems against the coupon's
 * current `discounts.code` — never drifts from what the voucher displays.
 */
describe('CouponsService.update — voucher code propagation', () => {
    function makeService() {
        const discounts = { update: jest.fn().mockResolvedValue({ id: 20 }) };
        const voucherRepo = { query: jest.fn().mockResolvedValue(undefined) };
        const noop = {} as never;
        const service = new CouponsService(
            discounts as never,
            noop, // discountRepo (unused on this path)
            voucherRepo as never,
            noop, // realizationRepo
            noop, // customerRepo
        );
        return { service, discounts, voucherRepo };
    }

    it('propagates a code change to existing vouchers (scoped to the offer + tenant)', async () => {
        const { service, voucherRepo } = makeService();
        await service.update(20, 6, { code: '10OFF101' });
        expect(voucherRepo.query).toHaveBeenCalledTimes(1);
        const [sql, params] = voucherRepo.query.mock.calls[0];
        expect(sql).toContain('UPDATE vouchers');
        expect(sql).toContain('SET code = d.code');
        // only rewrites rows that differ, and stays within the offer + tenant
        expect(sql).toContain('v.code IS DISTINCT FROM d.code');
        expect(sql).toContain('v.offer_id = $1');
        expect(sql).toContain('d.tenant_id = $2');
        expect(params).toEqual([20, 6]);
    });

    it('does NOT touch vouchers when the update omits code', async () => {
        const { service, voucherRepo } = makeService();
        await service.update(20, 6, { name: 'Renamed only' });
        expect(voucherRepo.query).not.toHaveBeenCalled();
    });

    it('still delegates the field update to DiscountsService', async () => {
        const { service, discounts } = makeService();
        await service.update(20, 6, { code: 'NEWCODE' }, [3]);
        expect(discounts.update).toHaveBeenCalledWith(20, 6, { code: 'NEWCODE' }, [3]);
    });
});

/**
 * Validity dates are picked as plain dates and saved as midnight UTC (05:00 in
 * Pakistan). A coupon is on offer, and a voucher that took its coupon's
 * "valid until" is usable, for that whole day on the business's clock.
 */
describe('CouponsService — validity dates', () => {
    const atPkt = (local: string) =>
        jest.useFakeTimers({ now: new Date(`${local}+05:00`) });
    const picked = (day: string) => new Date(day);
    const timezoneQuery = () =>
        jest.fn().mockResolvedValue([{ timezone: 'Asia/Karachi' }]);

    afterEach(() => jest.useRealTimers());

    describe('awardNewCustomerVouchers', () => {
        const coupon = (over: Record<string, unknown>) => ({
            id: 20,
            offerKind: 'coupon',
            audience: 'all',
            code: 'WELCOME',
            validFrom: null,
            validUntil: null,
            voucherValidityDays: null,
            ...over,
        });

        function makeService(coupons: unknown[]) {
            const query = timezoneQuery();
            const minted: Array<{ offerId: number }> = [];
            const discountRepo = {
                find: jest.fn().mockResolvedValue(coupons),
                manager: { query },
            };
            const voucherRepo = {
                findOne: jest.fn().mockResolvedValue(null),
                create: (v: { offerId: number }) => v,
                save: jest.fn((v: { offerId: number }) => {
                    minted.push(v);
                    return Promise.resolve(v);
                }),
            };
            const noop = {} as never;
            const service = new CouponsService(
                noop,
                discountRepo as never,
                voucherRepo as never,
                noop,
                noop,
            );
            return { service, minted, query };
        }

        const mintedFor = async (coupons: unknown[]) => {
            const { service, minted } = makeService(coupons);
            await service.awardNewCustomerVouchers(6, 99);
            return minted.map((v) => v.offerId);
        };

        it('gives a new customer the coupon on its last day', async () => {
            const coupons = [coupon({ validUntil: picked('2026-11-30') })];
            atPkt('2026-11-30T21:00:00');
            expect(await mintedFor(coupons)).toEqual([20]);

            atPkt('2026-12-01T00:00:30');
            expect(await mintedFor(coupons)).toEqual([]);
        });

        it('gives it from midnight on its first day', async () => {
            const coupons = [coupon({ validFrom: picked('2026-10-01') })];
            atPkt('2026-09-30T23:59:30');
            expect(await mintedFor(coupons)).toEqual([]);

            atPkt('2026-10-01T00:00:30');
            expect(await mintedFor(coupons)).toEqual([20]);
        });

        it('asks for no timezone when no coupon has a picked date', async () => {
            const { service, minted, query } = makeService([coupon({})]);
            await service.awardNewCustomerVouchers(6, 99);
            expect(minted).toHaveLength(1);
            expect(query).not.toHaveBeenCalled();
        });
    });

    describe('customerVouchers (the till lookup)', () => {
        function makeService(vouchers: unknown[]) {
            const query = timezoneQuery();
            const customerRepo = {
                findOne: jest.fn().mockResolvedValue({
                    id: 99,
                    name: 'Ali',
                    phone: '+923001234567',
                }),
            };
            const voucherRepo = {
                find: jest.fn().mockResolvedValue(vouchers),
                manager: { query },
            };
            const discountRepo = { find: jest.fn().mockResolvedValue([]) };
            const service = new CouponsService(
                {} as never,
                discountRepo as never,
                voucherRepo as never,
                {} as never,
                customerRepo as never,
            );
            return { service, query };
        }

        const voucher = (over: Record<string, unknown>) => ({
            id: 1,
            offerId: 20,
            code: 'WELCOME',
            status: 'active',
            uses: 0,
            expiresAt: null,
            ...over,
        });

        const statuses = async (vouchers: unknown[]) => {
            const { service } = makeService(vouchers);
            const r = await service.customerVouchers(6, '03001234567');
            return r.vouchers.map((v) => v.status);
        };

        it("keeps a voucher active through its coupon's last day", async () => {
            // The voucher took the coupon's "valid until 30 Nov" as its expiry.
            const vouchers = [voucher({ expiresAt: picked('2026-11-30') })];
            atPkt('2026-11-30T05:01:00');
            expect(await statuses(vouchers)).toEqual(['active']);
            atPkt('2026-11-30T23:59:30');
            expect(await statuses(vouchers)).toEqual(['active']);

            atPkt('2026-12-01T00:00:30');
            expect(await statuses(vouchers)).toEqual(['expired']);
        });

        it('still expires a voucher on its own clock at that moment', async () => {
            // Granted + N days: a real moment, not a picked date.
            const expiry = new Date('2026-10-12T09:23:11.123Z');
            const vouchers = [voucher({ expiresAt: expiry })];
            jest.useFakeTimers({ now: new Date(expiry.getTime() - 1000) });
            expect(await statuses(vouchers)).toEqual(['active']);
            jest.useFakeTimers({ now: new Date(expiry.getTime() + 1000) });
            expect(await statuses(vouchers)).toEqual(['expired']);
        });

        it('leaves a used-up voucher as it is', async () => {
            atPkt('2026-11-30T21:00:00');
            expect(
                await statuses([
                    voucher({
                        status: 'exhausted',
                        expiresAt: picked('2026-11-30'),
                    }),
                ]),
            ).toEqual(['exhausted']);
        });

        it('asks for no timezone when no voucher expires on a picked date', async () => {
            const { service, query } = makeService([
                voucher({}),
                voucher({ id: 2, expiresAt: new Date('2026-10-12T09:23:11Z') }),
            ]);
            await service.customerVouchers(6, '03001234567');
            expect(query).not.toHaveBeenCalled();
        });
    });
});
