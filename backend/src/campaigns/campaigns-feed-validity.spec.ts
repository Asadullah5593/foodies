import { CampaignsService } from './campaigns.service';

/**
 * The app's campaign feed keeps a campaign, and each item in it, for the whole
 * of a picked "valid until" date on the business's clock — not until 05:00
 * Pakistan time, which is the midnight UTC a date-only input is saved as.
 */
describe('CampaignsService.feed — validity dates', () => {
    const campaign = (over: Record<string, unknown>) => ({
        id: 7,
        tenantId: 6,
        name: 'Winter',
        imageUrl: null,
        isActive: true,
        validFrom: null,
        validUntil: null,
        ...over,
    });
    const item = (over: Record<string, unknown>) => ({
        id: 1,
        campaignId: 7,
        kind: 'info',
        title: 'Hello',
        isActive: true,
        validFrom: null,
        validUntil: null,
        ...over,
    });

    function makeService(campaigns: unknown[], items: unknown[]) {
        const query = jest
            .fn()
            .mockResolvedValue([{ timezone: 'Asia/Karachi' }]);
        const campaignRepo = {
            find: jest.fn().mockResolvedValue(campaigns),
            manager: { query },
        };
        const itemRepo = { find: jest.fn().mockResolvedValue(items) };
        const noop = {} as never;
        const service = new CampaignsService(
            campaignRepo as never,
            itemRepo as never,
            noop,
            noop,
            noop,
            noop,
        );
        return { service, query };
    }

    const pkt = (local: string) => new Date(`${local}+05:00`);
    const picked = (day: string) => new Date(day);
    const shape = (feed: Array<{ id: number; items: Array<{ id: number }> }>) =>
        feed.map((c) => [c.id, c.items.map((i) => i.id)]);

    it('keeps a campaign through its last day and drops it after', async () => {
        const { service } = makeService(
            [campaign({ validUntil: picked('2026-11-30') })],
            [item({ id: 1 })],
        );
        expect(
            shape(await service.feed(6, pkt('2026-11-30T05:01:00'))),
        ).toEqual([[7, [1]]]);
        expect(
            shape(await service.feed(6, pkt('2026-11-30T23:59:30'))),
        ).toEqual([[7, [1]]]);
        expect(
            shape(await service.feed(6, pkt('2026-12-01T00:00:30'))),
        ).toEqual([]);
    });

    it('starts a campaign at midnight on its first day', async () => {
        const { service } = makeService(
            [campaign({ validFrom: picked('2026-10-01') })],
            [item({ id: 1 })],
        );
        expect(
            shape(await service.feed(6, pkt('2026-09-30T23:59:30'))),
        ).toEqual([]);
        expect(
            shape(await service.feed(6, pkt('2026-10-01T00:00:30'))),
        ).toEqual([[7, [1]]]);
    });

    it('applies the same rule to each item inside a campaign', async () => {
        const { service, query } = makeService(
            [campaign({})],
            [
                item({ id: 1, validUntil: picked('2026-11-30') }),
                item({ id: 2, validFrom: picked('2026-12-01') }),
            ],
        );
        expect(
            shape(await service.feed(6, pkt('2026-11-30T21:00:00'))),
        ).toEqual([[7, [1]]]);
        expect(
            shape(await service.feed(6, pkt('2026-12-01T00:00:30'))),
        ).toEqual([[7, [2]]]);
        // The campaign had no dates; the items' did, and that is what asked.
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('branch_brands'),
            [6],
        );
    });

    it('looks the timezone up once for campaigns and items together', async () => {
        const { service, query } = makeService(
            [campaign({ validUntil: picked('2026-12-31') })],
            [item({ id: 1, validUntil: picked('2026-11-30') })],
        );
        await service.feed(6, pkt('2026-11-30T21:00:00'));
        expect(query).toHaveBeenCalledTimes(1);
    });

    it('asks for no timezone when nothing has a picked date', async () => {
        const { service, query } = makeService(
            [campaign({})],
            [item({ id: 1 })],
        );
        expect(
            shape(await service.feed(6, pkt('2026-11-30T21:00:00'))),
        ).toEqual([[7, [1]]]);
        expect(query).not.toHaveBeenCalled();
    });
});
