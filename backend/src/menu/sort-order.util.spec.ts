import { BadRequestException, ConflictException } from '@nestjs/common';
import {
    assertSortOrderAvailable,
    normalizeSortOrder,
    sortRank,
    summarizeSortOrders,
    SORT_ORDER_UNSET,
} from './sort-order.util';

describe('normalizeSortOrder', () => {
    it('leaves an omitted field alone', () => {
        expect(normalizeSortOrder(undefined)).toBeUndefined();
    });

    it('treats null and empty string as unset', () => {
        expect(normalizeSortOrder(null)).toBe(SORT_ORDER_UNSET);
        expect(normalizeSortOrder('')).toBe(SORT_ORDER_UNSET);
    });

    it('accepts whole numbers, including numeric strings from forms', () => {
        expect(normalizeSortOrder(6)).toBe(6);
        expect(normalizeSortOrder('6')).toBe(6);
        expect(normalizeSortOrder(0)).toBe(0);
    });

    it('rejects anything that is not a whole non-negative number', () => {
        expect(() => normalizeSortOrder(1.5)).toThrow(BadRequestException);
        expect(() => normalizeSortOrder('abc')).toThrow(BadRequestException);
        expect(() => normalizeSortOrder(-1)).toThrow(BadRequestException);
        expect(() => normalizeSortOrder(999999)).toThrow(BadRequestException);
    });
});

describe('sortRank', () => {
    it('ranks unset (0) after every real position', () => {
        expect(sortRank(0)).toBeGreaterThan(sortRank(99));
        expect(sortRank(null)).toBeGreaterThan(sortRank(99));
        expect(sortRank(undefined)).toBeGreaterThan(sortRank(99));
    });

    it('keeps real positions in ascending order', () => {
        expect(sortRank(1)).toBeLessThan(sortRank(2));
    });

    it('sorts a mixed list with unset rows last', () => {
        const rows = [
            { id: 1, sortOrder: 0 },
            { id: 2, sortOrder: 3 },
            { id: 3, sortOrder: 0 },
            { id: 4, sortOrder: 1 },
        ];
        const ordered = [...rows]
            .sort(
                (a, b) =>
                    sortRank(a.sortOrder) - sortRank(b.sortOrder) ||
                    a.id - b.id,
            )
            .map((r) => r.id);
        expect(ordered).toEqual([4, 2, 1, 3]);
    });
});

describe('summarizeSortOrders', () => {
    it('suggests 1 when nothing is numbered', () => {
        expect(
            summarizeSortOrders([
                { id: 1, sortOrder: 0 },
                { id: 2, sortOrder: 0 },
            ]),
        ).toEqual({ taken: [], suggested: 1 });
    });

    it('suggests one past the highest taken number', () => {
        expect(
            summarizeSortOrders([
                { id: 1, sortOrder: 1 },
                { id: 2, sortOrder: 5 },
            ]),
        ).toEqual({ taken: [1, 5], suggested: 6 });
    });

    it('dedupes and sorts the taken list, ignoring unset rows', () => {
        expect(
            summarizeSortOrders([
                { id: 1, sortOrder: 3 },
                { id: 2, sortOrder: 3 },
                { id: 3, sortOrder: 0 },
                { id: 4, sortOrder: 1 },
            ]),
        ).toEqual({ taken: [1, 3], suggested: 4 });
    });
});

describe('assertSortOrderAvailable', () => {
    const peers = [
        { id: 1, sortOrder: 1 },
        { id: 2, sortOrder: 5 },
        { id: 3, sortOrder: 0 },
        { id: 4, sortOrder: 0 },
    ];

    it('allows a free number', () => {
        expect(() =>
            assertSortOrderAvailable(6, peers, { label: 'menu item' }),
        ).not.toThrow();
    });

    it('rejects a number another row already holds', () => {
        expect(() =>
            assertSortOrderAvailable(5, peers, { label: 'menu item' }),
        ).toThrow(ConflictException);
    });

    it('names the next available number in the error', () => {
        expect(() =>
            assertSortOrderAvailable(5, peers, { label: 'menu item' }),
        ).toThrow(/Next available: 6/);
    });

    it('lets a row keep its own number while editing', () => {
        expect(() =>
            assertSortOrderAvailable(5, peers, {
                excludeId: 2,
                label: 'menu item',
            }),
        ).not.toThrow();
    });

    it('never collides on unset, so many rows may sit at 0', () => {
        expect(() =>
            assertSortOrderAvailable(SORT_ORDER_UNSET, peers, {
                label: 'menu item',
            }),
        ).not.toThrow();
    });

    it('ignores an omitted field', () => {
        expect(() =>
            assertSortOrderAvailable(undefined, peers, { label: 'menu item' }),
        ).not.toThrow();
    });
});
