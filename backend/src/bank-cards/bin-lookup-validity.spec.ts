import { BankCardsService } from './bank-cards.service';

/**
 * The till's card lookup says "available now" for the whole of a picked
 * "valid until" date — the same rule checkout prices the card offer by.
 */
describe('BankCardsService.lookupByBin — validity dates', () => {
    const KARACHI = 'Asia/Karachi';

    const card = (over: Record<string, unknown>) => ({
        id: 7,
        tenantId: 6,
        name: 'HBL Premium',
        binPrefixes: ['455670'],
        discountType: 'percentage',
        discountValue: 20,
        minOrderAmount: null,
        maxDiscountAmount: null,
        validFrom: null,
        validUntil: null,
        validTimeStart: null,
        validTimeEnd: null,
        validDaysOfWeek: null,
        eligibilityBrandIds: null,
        eligibilityBranchIds: null,
        isActive: true,
        ...over,
    });

    function makeService(cards: unknown[], branchTimezone = KARACHI) {
        const query = jest.fn().mockResolvedValue([{ timezone: KARACHI }]);
        const repo = {
            find: jest.fn().mockResolvedValue(cards),
            manager: { query },
        };
        const branchRepo = {
            findOne: jest
                .fn()
                .mockResolvedValue({ id: 16, timezone: branchTimezone }),
        };
        const service = new BankCardsService(
            repo as never,
            {} as never,
            branchRepo as never,
        );
        return { service, query, branchRepo };
    }

    const atPkt = (local: string) =>
        jest.useFakeTimers({ now: new Date(`${local}+05:00`) });
    const picked = (day: string) => new Date(day);
    const availability = (r: {
        matches: Array<{ available_now: boolean | null }>;
    }) => r.matches.map((m) => m.available_now);

    afterEach(() => jest.useRealTimers());

    it('is available through the last day and not after it', async () => {
        const cards = [card({ validUntil: picked('2026-11-30') })];
        atPkt('2026-11-30T21:00:00');
        const evening = await makeService(cards).service.lookupByBin(
            6,
            '455670',
            null,
            16,
        );
        expect(availability(evening)).toEqual([true]);

        atPkt('2026-12-01T00:00:30');
        const nextDay = await makeService(cards).service.lookupByBin(
            6,
            '455670',
            null,
            16,
        );
        expect(availability(nextDay)).toEqual([false]);
    });

    it('is available from midnight on the first day', async () => {
        const cards = [card({ validFrom: picked('2026-10-01') })];
        atPkt('2026-09-30T23:59:30');
        const before = await makeService(cards).service.lookupByBin(
            6,
            '455670',
            null,
            16,
        );
        expect(availability(before)).toEqual([false]);

        atPkt('2026-10-01T00:00:30');
        const first = await makeService(cards).service.lookupByBin(
            6,
            '455670',
            null,
            16,
        );
        expect(availability(first)).toEqual([true]);
    });

    it("uses the branch's clock when the lookup names a branch", async () => {
        const cards = [card({ validUntil: picked('2026-11-30') })];
        // 02:00 on 1 Dec in Pakistan is still 30 Nov for a branch left on UTC.
        atPkt('2026-12-01T02:00:00');
        const { service, query } = makeService(cards, 'UTC');
        const r = await service.lookupByBin(6, '455670', null, 16);
        expect(availability(r)).toEqual([true]);
        expect(query).not.toHaveBeenCalled();
    });

    it("uses the tenant's branches when it names none", async () => {
        const cards = [card({ validUntil: picked('2026-11-30') })];
        atPkt('2026-11-30T21:00:00');
        const { service, query, branchRepo } = makeService(cards);
        const r = await service.lookupByBin(6, '455670', null, null);
        expect(availability(r)).toEqual([true]);
        expect(branchRepo.findOne).not.toHaveBeenCalled();
        expect(query).toHaveBeenCalledWith(
            expect.stringContaining('branch_brands'),
            [6],
        );
    });

    it('asks for no timezone when no card has a picked date', async () => {
        const { service, query } = makeService([
            card({}),
            card({ id: 8, binPrefixes: ['520000'] }),
        ]);
        const r = await service.lookupByBin(6, '455670', null, null);
        expect(availability(r)).toEqual([true]);
        expect(query).not.toHaveBeenCalled();
    });
});
