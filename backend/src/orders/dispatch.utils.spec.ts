import { freshnessState, selectNextRoundRobin } from './dispatch.utils';

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
});
