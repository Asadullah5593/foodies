import {
    bogoUnitDiscounts,
    priceBogoComponents,
    validateBogoComponents,
    isComponentAllowedInSlot,
    round2,
    type BogoComponentConstraint,
} from './bogo-pricing';

describe('bogo-pricing', () => {
    describe('bogoUnitDiscounts', () => {
        it('empty input → empty output', () => {
            expect(bogoUnitDiscounts([], 1, 1, 50)).toEqual([]);
        });

        it('pct <= 0 → no discounts', () => {
            expect(bogoUnitDiscounts([1800, 1200], 1, 1, 0)).toEqual([0, 0]);
            expect(bogoUnitDiscounts([1800, 1200], 1, 1, -10)).toEqual([0, 0]);
        });

        it('buy1get1 50%: only the CHEAPER of two is halved', () => {
            // dearer (1800) full, cheaper (1200) gets 600 off
            expect(bogoUnitDiscounts([1800, 1200], 1, 1, 50)).toEqual([0, 600]);
            // order independence: cheaper first still discounts the cheaper one
            expect(bogoUnitDiscounts([1200, 1800], 1, 1, 50)).toEqual([600, 0]);
        });

        it('equal prices: exactly one unit discounted (deterministic, the later index)', () => {
            expect(bogoUnitDiscounts([1500, 1500], 1, 1, 50)).toEqual([0, 750]);
        });

        it('three pizzas, buy1get1: one pair discounts the 2nd-dearest; the 3rd is leftover (not discounted)', () => {
            // desc [1800,1500,1200] → cohort of 2 = {1800,1500}, cheaper=1500 discounted; 1200 leftover
            expect(bogoUnitDiscounts([1800, 1500, 1200], 1, 1, 50)).toEqual([
                0, 750, 0,
            ]);
        });

        it('four pizzas, buy1get1: two cohorts → the two cheaper-of-each-pair discounted', () => {
            // desc [2000,1800,1500,1200] → pairs (2000,1800)->1800, (1500,1200)->1200
            const d = bogoUnitDiscounts([2000, 1800, 1500, 1200], 1, 1, 50);
            expect(d).toEqual([0, 900, 0, 600]);
        });

        it('buy2get1: cohort of 3 discounts the single cheapest of the trio', () => {
            expect(bogoUnitDiscounts([3000, 2000, 1000], 2, 1, 50)).toEqual([
                0, 0, 500,
            ]);
        });

        it('clamps pct above 100 and floors buy/get to >= 1', () => {
            expect(bogoUnitDiscounts([1000, 1000], 1, 1, 150)).toEqual([0, 1000]);
            expect(bogoUnitDiscounts([1000, 800], 0, 0, 50)).toEqual([0, 400]);
        });

        it('single unit never discounts (no complete cohort)', () => {
            expect(bogoUnitDiscounts([1500], 1, 1, 50)).toEqual([0]);
        });
    });

    describe('priceBogoComponents', () => {
        it('returns final per-component prices (full + half-cheaper), rounded', () => {
            expect(priceBogoComponents([1800, 1200], 1, 1, 50)).toEqual([
                1800, 600,
            ]);
            expect(priceBogoComponents([1500, 1500], 1, 1, 50)).toEqual([
                1500, 750,
            ]);
        });

        it('rounds each component to 2dp', () => {
            // cheaper 333.33 → half 166.665 → round2 166.67; price kept 166.67? no: kept full
            const out = priceBogoComponents([999.99, 333.33], 1, 1, 50);
            expect(out[0]).toBe(999.99);
            expect(out[1]).toBe(round2(333.33 - 333.33 / 2));
            expect(out[1]).toBe(166.67);
        });

        it('pct 0 → both components at full price', () => {
            expect(priceBogoComponents([1800, 1200], 1, 1, 0)).toEqual([
                1800, 1200,
            ]);
        });
    });

    describe('validateBogoComponents', () => {
        const mk = (
            o: Partial<BogoComponentConstraint> & { slotIndex: number },
        ): BogoComponentConstraint => ({
            categoryId: 1,
            label: null,
            sizeKey: '12',
            mirrorSlotIndex: null,
            mirrorMatchSize: false,
            mirrorMatchCategory: false,
            allowedSizeKeys: null,
            ...o,
        });

        const slot0 = (o: Partial<BogoComponentConstraint> = {}) =>
            mk({ slotIndex: 0, allowedSizeKeys: ['12', '14'], ...o });
        const slot1 = (o: Partial<BogoComponentConstraint> = {}) =>
            mk({
                slotIndex: 1,
                allowedSizeKeys: ['12', '14'],
                mirrorSlotIndex: 0,
                mirrorMatchSize: true,
                mirrorMatchCategory: true,
                ...o,
            });

        it('valid: same size + same (category,label) → null', () => {
            expect(
                validateBogoComponents([
                    slot0({ categoryId: 1, label: 'Classic', sizeKey: '12' }),
                    slot1({ categoryId: 1, label: 'Classic', sizeKey: '12' }),
                ]),
            ).toBeNull();
        });

        it('rejects different sizes', () => {
            expect(
                validateBogoComponents([
                    slot0({ sizeKey: '12', label: 'Classic' }),
                    slot1({ sizeKey: '14', label: 'Classic' }),
                ]),
            ).toMatch(/same size/i);
        });

        it('rejects Classic + Signature (same categoryId, different label) under strict match', () => {
            expect(
                validateBogoComponents([
                    slot0({ categoryId: 1, label: 'Classic' }),
                    slot1({ categoryId: 1, label: 'Signature' }),
                ]),
            ).toMatch(/same category/i);
        });

        it('rejects Classic + BYO (different categoryId)', () => {
            expect(
                validateBogoComponents([
                    slot0({ categoryId: 1, label: 'Classic' }),
                    slot1({ categoryId: 2, label: null }),
                ]),
            ).toMatch(/same category/i);
        });

        it('allows BYO + BYO (same categoryId, both null label)', () => {
            expect(
                validateBogoComponents([
                    slot0({ categoryId: 2, label: null }),
                    slot1({ categoryId: 2, label: null }),
                ]),
            ).toBeNull();
        });

        it('allows Margherita(Classic) + Classic (same categoryId & label)', () => {
            expect(
                validateBogoComponents([
                    slot0({ categoryId: 1, label: 'Classic' }),
                    slot1({ categoryId: 1, label: 'Classic' }),
                ]),
            ).toBeNull();
        });

        it('rejects a disallowed size (7" when allowed is 12/14)', () => {
            expect(
                validateBogoComponents([
                    slot0({ sizeKey: '7', label: 'Classic' }),
                    slot1({ sizeKey: '7', label: 'Classic' }),
                ]),
            ).toMatch(/only available/i);
        });

        it('rejects a null size when an allow-list is set', () => {
            expect(
                validateBogoComponents([
                    slot0({ sizeKey: null, label: 'Classic' }),
                ]),
            ).toMatch(/only available/i);
        });

        it('no allow-list → size unrestricted', () => {
            expect(
                validateBogoComponents([
                    mk({ slotIndex: 0, sizeKey: '7', allowedSizeKeys: null }),
                ]),
            ).toBeNull();
        });

        it('rejects when the mirrored slot is missing', () => {
            expect(
                validateBogoComponents([
                    slot1({ label: 'Classic' }), // mirrors slot 0 which is absent
                ]),
            ).toMatch(/mirrored slot is missing/i);
        });
    });

    describe('isComponentAllowedInSlot', () => {
        it('choice_list: only ids in the list are allowed', () => {
            const slot = {
                type: 'choice_list',
                sourceMenuItemId: null,
                sourceCategoryId: null,
                sourceMenuItemIds: [10, 20, 30],
            };
            expect(isComponentAllowedInSlot({ menuItemId: 20, categoryId: 1 }, slot)).toBe(true);
            expect(isComponentAllowedInSlot({ menuItemId: 99, categoryId: 1 }, slot)).toBe(false);
        });
        it('choice_category: only items of the source category are allowed', () => {
            const slot = {
                type: 'choice_category',
                sourceMenuItemId: null,
                sourceCategoryId: 7,
                sourceMenuItemIds: null,
            };
            expect(isComponentAllowedInSlot({ menuItemId: 1, categoryId: 7 }, slot)).toBe(true);
            expect(isComponentAllowedInSlot({ menuItemId: 1, categoryId: 8 }, slot)).toBe(false);
            expect(isComponentAllowedInSlot({ menuItemId: 1, categoryId: null }, slot)).toBe(false);
        });
        it('fixed: only the single source item is allowed', () => {
            const slot = {
                type: 'fixed',
                sourceMenuItemId: 42,
                sourceCategoryId: null,
                sourceMenuItemIds: null,
            };
            expect(isComponentAllowedInSlot({ menuItemId: 42, categoryId: 1 }, slot)).toBe(true);
            expect(isComponentAllowedInSlot({ menuItemId: 43, categoryId: 1 }, slot)).toBe(false);
        });
    });
});
