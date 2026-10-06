import { BannersService } from './banners.service';

/**
 * A banner with a picked "valid until" date stays up for that whole day on the
 * business's clock, rather than coming down at 05:00 Pakistan time (midnight
 * UTC, which is what a date-only input is saved as).
 */
describe('BannersService.findActiveForTenant — validity dates', () => {
    const banner = (over: Record<string, unknown>) => ({
        id: 1,
        tenantId: 6,
        title: 'Winter deal',
        isActive: true,
        validFrom: null,
        validUntil: null,
        ...over,
    });

    function makeService(rows: unknown[]) {
        const query = jest
            .fn()
            .mockResolvedValue([{ timezone: 'Asia/Karachi' }]);
        const repo = {
            find: jest.fn().mockResolvedValue(rows),
            manager: { query },
        };
        const service = new BannersService(repo as never, {} as never);
        return { service, query };
    }

    const atPkt = (local: string) =>
        jest.useFakeTimers({ now: new Date(`${local}+05:00`) });
    const picked = (day: string) => new Date(day);
    const ids = (list: Array<{ id: number }>) => list.map((b) => b.id);

    afterEach(() => jest.useRealTimers());

    it('shows a banner through its last day and takes it down after', async () => {
        const rows = [banner({ id: 3, validUntil: picked('2026-11-30') })];
        atPkt('2026-11-30T21:00:00');
        expect(
            ids(await makeService(rows).service.findActiveForTenant(6)),
        ).toEqual([3]);

        atPkt('2026-12-01T00:00:30');
        expect(
            ids(await makeService(rows).service.findActiveForTenant(6)),
        ).toEqual([]);
    });

    it('shows a banner from midnight on its first day', async () => {
        const rows = [banner({ id: 3, validFrom: picked('2026-10-01') })];
        atPkt('2026-09-30T23:59:30');
        expect(
            ids(await makeService(rows).service.findActiveForTenant(6)),
        ).toEqual([]);

        atPkt('2026-10-01T00:00:30');
        expect(
            ids(await makeService(rows).service.findActiveForTenant(6)),
        ).toEqual([3]);
    });

    it("reads the date on the clock the tenant's branches run on", async () => {
        const rows = [banner({ id: 3, validUntil: picked('2026-11-30') })];
        atPkt('2026-11-30T21:00:00');
        const { service, query } = makeService(rows);
        await service.findActiveForTenant(6);
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('branch_brands'),
            [6],
        );
    });

    it('asks for no timezone when no banner has a picked date', async () => {
        const { service, query } = makeService([
            banner({ id: 1 }),
            banner({ id: 2 }),
        ]);
        expect(ids(await service.findActiveForTenant(6))).toEqual([1, 2]);
        expect(query).not.toHaveBeenCalled();
    });
});
