import { DiscountsService } from './discounts.service';

/**
 * The till's "Offers" buttons list an offer for the whole of a picked date on
 * the till's own branch clock — the same rule checkout prices by, so a button
 * never shows an offer the order would refuse, nor hides one it would accept.
 */
describe('DiscountsService.findManualForTill — validity dates', () => {
    const KARACHI = 'Asia/Karachi';

    const manual = (over: Record<string, unknown>) => ({
        id: 1,
        name: 'Weekend BOGO',
        type: 'percentage',
        value: 10,
        activation: 'manual',
        offerKind: 'discount',
        validFrom: null,
        validUntil: null,
        eligibilityBrandIds: null,
        eligibilityBranchIds: null,
        ...over,
    });

    function makeService(rows: unknown[], branchTimezone = KARACHI) {
        const query = jest.fn((sql: string) =>
            Promise.resolve([
                {
                    timezone: sql.includes('branch_brands')
                        ? KARACHI
                        : branchTimezone,
                },
            ]),
        );
        const repo = {
            find: jest.fn().mockResolvedValue(rows),
            manager: { query },
        };
        const noop = {} as never;
        const service = new DiscountsService(repo as never, noop, noop, noop);
        return { service, query };
    }

    const atPkt = (local: string) =>
        jest.useFakeTimers({ now: new Date(`${local}+05:00`) });
    const picked = (day: string) => new Date(day);
    const ids = (list: Array<{ id: number }>) => list.map((o) => o.id);

    afterEach(() => jest.useRealTimers());

    it('keeps an offer on its last day until midnight', async () => {
        const rows = [manual({ id: 5, validUntil: picked('2026-11-30') })];
        atPkt('2026-11-30T21:00:00');
        const evening = await makeService(rows).service.findManualForTill(
            6,
            null,
            { branchId: 16 },
        );
        expect(ids(evening)).toEqual([5]);

        atPkt('2026-12-01T00:00:30');
        const nextDay = await makeService(rows).service.findManualForTill(
            6,
            null,
            { branchId: 16 },
        );
        expect(ids(nextDay)).toEqual([]);
    });

    it('shows an offer from midnight on its first day', async () => {
        const rows = [manual({ id: 5, validFrom: picked('2026-10-01') })];
        atPkt('2026-09-30T23:59:30');
        const before = await makeService(rows).service.findManualForTill(
            6,
            null,
            { branchId: 16 },
        );
        expect(ids(before)).toEqual([]);

        atPkt('2026-10-01T00:00:30');
        const first = await makeService(rows).service.findManualForTill(
            6,
            null,
            { branchId: 16 },
        );
        expect(ids(first)).toEqual([5]);
    });

    it("reads the date on the till's branch clock", async () => {
        const rows = [manual({ id: 5, validUntil: picked('2026-11-30') })];
        // 02:00 on 1 Dec in Pakistan is still 30 Nov for a branch left on UTC.
        atPkt('2026-12-01T02:00:00');
        const { service, query } = makeService(rows, 'UTC');
        const list = await service.findManualForTill(6, null, { branchId: 16 });
        expect(ids(list)).toEqual([5]);
        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0]).toEqual([
            expect.stringContaining('FROM branches WHERE id'),
            [16],
        ]);
    });

    it("falls back to the tenant's branches when the till sent no branch", async () => {
        const rows = [manual({ id: 5, validUntil: picked('2026-11-30') })];
        atPkt('2026-11-30T21:00:00');
        const { service, query } = makeService(rows);
        const list = await service.findManualForTill(6, null);
        expect(ids(list)).toEqual([5]);
        expect(query.mock.calls[0]).toEqual([
            expect.stringContaining('branch_brands'),
            [6],
        ]);
    });

    it('asks for no timezone when nothing has a picked date', async () => {
        const { service, query } = makeService([
            manual({ id: 5 }),
            manual({ id: 6, offerKind: 'product_promotion' }),
        ]);
        const list = await service.findManualForTill(6, null, { branchId: 16 });
        expect(ids(list)).toEqual([5, 6]);
        expect(query).not.toHaveBeenCalled();
    });
});
