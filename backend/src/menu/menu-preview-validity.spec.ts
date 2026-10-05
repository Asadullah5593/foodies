import { MenuService } from './menu.service';

/**
 * The menu's "was / now" prices read a picked "valid until" date on the browsed
 * branch's clock. The branch is only looked up when an offer has such a date,
 * and its timezone travels on the offers into the pure preview.
 */
describe('MenuService — preview offers and validity dates', () => {
    type Preview = { discounted_price: number; discount_amount: number };
    type Harness = {
        discountRepo: unknown;
        loadPreviewOffers: (
            tenantId: number | null,
            branchId: number | null,
        ) => Promise<Array<{ timezone?: string | null }>>;
        previewFor: (
            item: { id: number; categoryId: number; brandId: number },
            price: number,
            offers: unknown[],
            branchId: number | null,
            now: Date,
            channel: string | null,
        ) => Preview;
    };

    const offer = (over: Record<string, unknown>) => ({
        id: 1,
        name: '10% pizzas',
        offerKind: 'discount',
        type: 'percentage',
        value: 10,
        minOrderAmount: null,
        maxDiscountAmount: null,
        applicationScope: 'category',
        applicationScopeIds: [3],
        eligibilityBranchIds: null,
        eligibilityBrandIds: null,
        audience: null,
        requiresCard: false,
        posOnly: false,
        channels: null,
        orderTypes: null,
        validFrom: null,
        validUntil: null,
        validTimeStart: null,
        validTimeEnd: null,
        validDaysOfWeek: null,
        ...over,
    });

    function makeService(rows: unknown[], branchTimezone = 'Asia/Karachi') {
        const query = jest
            .fn()
            .mockResolvedValue([{ timezone: branchTimezone }]);
        const svc = Object.create(MenuService.prototype) as Harness;
        svc.discountRepo = {
            find: jest.fn().mockResolvedValue(rows),
            manager: { query },
        };
        return { svc, query };
    }

    const item = { id: 55, categoryId: 3, brandId: 2 };
    const picked = (day: string) => new Date(day);
    const pkt = (local: string) => new Date(`${local}+05:00`);

    it("reads a picked date on the browsed branch's clock", async () => {
        const { svc, query } = makeService([
            offer({ validUntil: picked('2026-11-30') }),
        ]);
        const offers = await svc.loadPreviewOffers(6, 16);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('FROM branches WHERE id'),
            [16],
        );
        expect(offers.map((o) => o.timezone)).toEqual(['Asia/Karachi']);

        const at = (local: string) =>
            svc.previewFor(item, 800, offers, 16, pkt(local), 'app')
                .discounted_price;
        expect(at('2026-11-30T05:01:00')).toBe(720);
        expect(at('2026-11-30T23:59:30')).toBe(720);
        expect(at('2026-12-01T00:00:30')).toBe(800);
    });

    it('keeps the UTC day for a branch left on UTC', async () => {
        const { svc } = makeService(
            [offer({ validUntil: picked('2026-11-30') })],
            'UTC',
        );
        const offers = await svc.loadPreviewOffers(6, 16);
        // 02:00 on 1 Dec in Pakistan is still 30 Nov in UTC.
        expect(
            svc.previewFor(
                item,
                800,
                offers,
                16,
                pkt('2026-12-01T02:00:00'),
                'app',
            ).discounted_price,
        ).toBe(720);
    });

    it('looks nothing up when no offer has a picked date', async () => {
        const { svc, query } = makeService([offer({})]);
        const offers = await svc.loadPreviewOffers(6, 16);
        expect(query).not.toHaveBeenCalled();
        expect(
            svc.previewFor(
                item,
                800,
                offers,
                16,
                pkt('2026-11-30T21:00:00'),
                'app',
            ).discounted_price,
        ).toBe(720);
    });

    it('has no offers, and asks nothing, without a tenant', async () => {
        const { svc, query } = makeService([
            offer({ validUntil: picked('2026-11-30') }),
        ]);
        expect(await svc.loadPreviewOffers(null, 16)).toEqual([]);
        expect(query).not.toHaveBeenCalled();
    });
});
