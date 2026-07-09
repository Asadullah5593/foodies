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
