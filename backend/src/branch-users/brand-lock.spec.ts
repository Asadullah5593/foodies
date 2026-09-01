import {
    BRAND_LOCK_SQL,
    brandIdsFromInput,
    brandLockColumns,
    isBrandLocked,
    rowBrandIds,
} from './brand-lock';

/**
 * branch_users is keyed on (branch_id, user_id), so a user's brands at a branch
 * live in one row's array. brand_id trails it as the first entry, which means
 * every read has to agree on which column wins — that is what these pin down.
 */
describe('rowBrandIds', () => {
    it('prefers the list', () => {
        expect(rowBrandIds({ brandIds: [7, 3], brandId: 3 })).toEqual([3, 7]);
    });

    it('falls back to the single column for a row written before the list existed', () => {
        expect(rowBrandIds({ brandId: 3, brandIds: null })).toEqual([3]);
        expect(rowBrandIds({ brand_id: 3 })).toEqual([3]);
    });

    it('treats an empty list as no list, not as no brands', () => {
        // An empty array must never read as "locked to nothing", which would
        // lock the user out of every brand instead of unlocking them.
        expect(rowBrandIds({ brandIds: [], brandId: 3 })).toEqual([3]);
        expect(rowBrandIds({ brandIds: [], brandId: null })).toBeNull();
    });

    it('says null — all brands — when nothing is set', () => {
        expect(rowBrandIds({})).toBeNull();
        expect(rowBrandIds(null)).toBeNull();
        expect(rowBrandIds(undefined)).toBeNull();
        expect(rowBrandIds({ brandId: null, brandIds: null })).toBeNull();
    });

    it('reads the snake_case spelling raw SQL returns', () => {
        expect(rowBrandIds({ brand_ids: [3, 7] })).toEqual([3, 7]);
    });

    it('drops junk and duplicates, and sorts', () => {
        expect(
            rowBrandIds({
                brandIds: [7, 3, 7, 0, -1, NaN as unknown as number],
            }),
        ).toEqual([3, 7]);
    });

    it('isBrandLocked mirrors it', () => {
        expect(isBrandLocked({ brandIds: [3] })).toBe(true);
        expect(isBrandLocked({})).toBe(false);
    });
});

describe('brandLockColumns', () => {
    it('keeps brand_id as the FIRST of the list, so a single-column reader restricts rather than leaks', () => {
        expect(brandLockColumns([7, 3])).toEqual({
            brandId: 3,
            brandIds: [3, 7],
        });
    });

    it('writes both columns for a single brand', () => {
        expect(brandLockColumns([3])).toEqual({ brandId: 3, brandIds: [3] });
    });

    it('clears both for all-brands', () => {
        expect(brandLockColumns([])).toEqual({ brandId: null, brandIds: null });
        expect(brandLockColumns(null)).toEqual({
            brandId: null,
            brandIds: null,
        });
        expect(brandLockColumns(undefined)).toEqual({
            brandId: null,
            brandIds: null,
        });
    });

    it('round-trips through rowBrandIds', () => {
        for (const wanted of [[3], [3, 7], [7, 3, 3]]) {
            const cols = brandLockColumns(wanted);
            expect(rowBrandIds(cols)).toEqual(
                [...new Set(wanted)].sort((a, b) => a - b),
            );
        }
    });
});

describe('brandIdsFromInput', () => {
    it('takes the list when it has anything', () => {
        expect(brandIdsFromInput({ brand_ids: [3, 7], brand_id: 9 })).toEqual([
            3, 7,
        ]);
    });

    it('falls back to the single field the old clients send', () => {
        expect(brandIdsFromInput({ brand_id: 3 })).toEqual([3]);
        expect(brandIdsFromInput({ brand_ids: [], brand_id: 3 })).toEqual([3]);
    });

    it('returns nothing for all-brands', () => {
        expect(brandIdsFromInput({})).toEqual([]);
        expect(brandIdsFromInput({ brand_id: null, brand_ids: null })).toEqual(
            [],
        );
    });
});

describe('BRAND_LOCK_SQL', () => {
    it('reads both columns off the given alias', () => {
        const sql = BRAND_LOCK_SQL('bu');
        expect(sql).toContain('bu.brand_ids');
        expect(sql).toContain('bu.brand_id');
        // An empty array must collapse to NULL so `IS NULL` still means
        // "all brands", exactly as the single column did.
        expect(sql).toContain("NULLIF(bu.brand_ids, '{}')");
    });
});
