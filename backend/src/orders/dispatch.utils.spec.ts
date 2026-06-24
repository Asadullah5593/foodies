import {
    freshnessState,
    selectNextRoundRobin,
    riderPassesTierCap,
    selectRiderForBatchableOrder,
} from './dispatch.utils';

describe('dispatch utils', () => {
    describe('selectNextRoundRobin', () => {
        it('returns null when no eligible riders exist', () => {
            expect(selectNextRoundRobin([], null)).toBeNull();
        });

        it('returns first sorted rider when no last rider exists', () => {
            expect(selectNextRoundRobin([7, 2, 4], null)).toBe(2);
        });

        it('cycles to next rider after last assigned', () => {
            expect(selectNextRoundRobin([2, 4, 7], 4)).toBe(7);
        });

        it('wraps around to first rider after final rider', () => {
            expect(selectNextRoundRobin([2, 4, 7], 7)).toBe(2);
        });

        it('falls back to first rider when last rider is no longer eligible', () => {
            expect(selectNextRoundRobin([2, 4, 7], 11)).toBe(2);
        });
    });

    describe('freshnessState', () => {
        it('returns false when timestamp is missing', () => {
            expect(freshnessState(null, 90, 1_000_000)).toBe(false);
        });

        it('returns true when timestamp is inside TTL', () => {
            const now = 1_000_000;
            const recent = new Date(now - 89_000);
            expect(freshnessState(recent, 90, now)).toBe(true);
        });

        it('returns false when timestamp is outside TTL', () => {
            const now = 1_000_000;
            const stale = new Date(now - 91_000);
            expect(freshnessState(stale, 90, now)).toBe(false);
        });
    });

    describe('riderPassesTierCap', () => {
        it('priority requires a fully idle rider', () => {
            expect(
                riderPassesTierCap(
                    { activeOrders: 0, hasPriorityActive: false },
                    'priority',
                    3,
                ),
            ).toBe(true);
            expect(
                riderPassesTierCap(
                    { activeOrders: 1, hasPriorityActive: false },
                    'priority',
                    3,
                ),
            ).toBe(false);
        });

        it('standard respects the batch cap', () => {
            expect(
                riderPassesTierCap(
                    { activeOrders: 1, hasPriorityActive: false },
                    'standard',
                    2,
                ),
            ).toBe(true);
            expect(
                riderPassesTierCap(
                    { activeOrders: 2, hasPriorityActive: false },
                    'standard',
                    2,
                ),
            ).toBe(false);
        });

        it('cap of 1 means no stacking (today behaviour)', () => {
            expect(
                riderPassesTierCap(
                    { activeOrders: 1, hasPriorityActive: false },
                    'standard',
                    1,
                ),
            ).toBe(false);
            expect(
                riderPassesTierCap(
                    { activeOrders: 0, hasPriorityActive: false },
                    'standard',
                    1,
                ),
            ).toBe(true);
        });

        it('a priority-locked rider is excluded from standard/saver', () => {
            expect(
                riderPassesTierCap(
                    { activeOrders: 1, hasPriorityActive: true },
                    'saver',
                    5,
                ),
            ).toBe(false);
        });

        it('clamps a missing/zero cap to 1', () => {
            expect(
                riderPassesTierCap(
                    { activeOrders: 0, hasPriorityActive: false },
                    'standard',
                    0,
                ),
            ).toBe(true);
            expect(
                riderPassesTierCap(
                    { activeOrders: 1, hasPriorityActive: false },
                    'standard',
                    0,
                ),
            ).toBe(false);
        });
    });

    describe('selectRiderForBatchableOrder', () => {
        it('returns null when nobody is eligible', () => {
            expect(
                selectRiderForBatchableOrder([], null, 'standard'),
            ).toBeNull();
        });

        it('standard/saver prefers a busy (batchable) rider over an idle one', () => {
            const eligible = [
                { riderId: 1, activeOrders: 0 },
                { riderId: 2, activeOrders: 1 },
                { riderId: 3, activeOrders: 0 },
            ];
            expect(
                selectRiderForBatchableOrder(eligible, null, 'standard'),
            ).toBe(2);
        });

        it('round-robins among busy riders when several can batch', () => {
            const eligible = [
                { riderId: 2, activeOrders: 1 },
                { riderId: 5, activeOrders: 1 },
            ];
            expect(selectRiderForBatchableOrder(eligible, 2, 'standard')).toBe(
                5,
            );
        });

        it('falls back to idle riders when none are batchable', () => {
            const eligible = [
                { riderId: 4, activeOrders: 0 },
                { riderId: 9, activeOrders: 0 },
            ];
            expect(selectRiderForBatchableOrder(eligible, null, 'saver')).toBe(
                4,
            );
        });

        it('priority ignores busy-preference and round-robins all eligible', () => {
            const eligible = [
                { riderId: 1, activeOrders: 0 },
                { riderId: 6, activeOrders: 0 },
            ];
            expect(selectRiderForBatchableOrder(eligible, 1, 'priority')).toBe(
                6,
            );
        });
    });
});
