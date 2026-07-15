import {
    ScopeBrandLookup,
    detachBrands,
    effectiveBrandIds,
    isVisibleToBrands,
    manageScopeFor,
} from './offer-brand-scope.util';

const FIREAWAY = 25;
const WOK = 26;
const PERI = 27;

// item 3097 + 3098 are Fireaway, 4001 is WOK&GO; category 500 is Fireaway.
const lookup: ScopeBrandLookup = {
    itemBrands: new Map([
        [3097, FIREAWAY],
        [3098, FIREAWAY],
        [4001, WOK],
    ]),
    categoryBrands: new Map([[500, FIREAWAY]]),
};

const productPromo = (ids: number[], brands: number[] | null = null) => ({
    applicationScope: 'products',
    applicationScopeIds: ids,
    eligibilityBrandIds: brands,
});

describe('effectiveBrandIds', () => {
    it('derives the brand from the promoted products when eligibility is unset', () => {
        // The bug this whole module exists for: owner promotes a Fireaway item and
        // leaves brands blank, so the row is null but the offer is Fireaway's.
        expect(effectiveBrandIds(productPromo([3097]), lookup)).toEqual([
            FIREAWAY,
        ]);
    });

    it('derives from categories too', () => {
        expect(
            effectiveBrandIds(
                { applicationScope: 'category', applicationScopeIds: [500] },
                lookup,
            ),
        ).toEqual([FIREAWAY]);
    });

    it('dedupes and sorts across a mixed-brand product selection', () => {
        expect(
            effectiveBrandIds(productPromo([3097, 3098, 4001]), lookup),
        ).toEqual([FIREAWAY, WOK]);
    });

    it('prefers explicit eligibility over the derived brand', () => {
        expect(effectiveBrandIds(productPromo([3097], [WOK]), lookup)).toEqual([
            WOK,
        ]);
    });

    it('returns null for an unrestricted whole-order offer (= all brands)', () => {
        expect(
            effectiveBrandIds(
                {
                    applicationScope: 'whole_order',
                    applicationScopeIds: null,
                    eligibilityBrandIds: null,
                },
                lookup,
            ),
        ).toBeNull();
    });

    it('treats [] the same as null rather than as "no brands"', () => {
        expect(effectiveBrandIds(productPromo([3097], []), lookup)).toEqual([
            FIREAWAY,
        ]);
    });

    it('returns null when scope ids resolve to nothing (stale ids)', () => {
        expect(effectiveBrandIds(productPromo([999999]), lookup)).toBeNull();
    });
});

describe('isVisibleToBrands', () => {
    it('shows an owner-created Fireaway product promo to the Fireaway admin', () => {
        expect(
            isVisibleToBrands(productPromo([3097]), [FIREAWAY], lookup),
        ).toBe(true);
    });

    it('hides a WOK&GO product promo from the Fireaway admin', () => {
        expect(
            isVisibleToBrands(productPromo([4001]), [FIREAWAY], lookup),
        ).toBe(false);
    });

    it('shows all-brand offers to every brand admin (they price that POS)', () => {
        expect(
            isVisibleToBrands(
                { applicationScope: 'whole_order', eligibilityBrandIds: null },
                [FIREAWAY],
                lookup,
            ),
        ).toBe(true);
    });

    it('shows everything to an unrestricted owner', () => {
        expect(isVisibleToBrands(productPromo([4001]), null, lookup)).toBe(
            true,
        );
    });
});

describe('manageScopeFor', () => {
    it('gives the owner full control', () => {
        expect(manageScopeFor(productPromo([3097]), null, lookup)).toBe('full');
    });

    it('gives full control over an offer that only touches their brand', () => {
        expect(manageScopeFor(productPromo([3097]), [FIREAWAY], lookup)).toBe(
            'full',
        );
    });

    it('downgrades a mixed-brand offer to detach-only', () => {
        // Fireaway must not be able to edit/delete WOK&GO's half.
        expect(
            manageScopeFor(productPromo([3097, 4001]), [FIREAWAY], lookup),
        ).toBe('detach');
    });

    it('makes an all-brand offer detach-only, not editable', () => {
        expect(
            manageScopeFor(
                { applicationScope: 'whole_order', eligibilityBrandIds: null },
                [FIREAWAY],
                lookup,
            ),
        ).toBe('detach');
    });

    it("marks another brand's offer read-only", () => {
        expect(manageScopeFor(productPromo([4001]), [FIREAWAY], lookup)).toBe(
            'read_only',
        );
    });
});

describe('detachBrands', () => {
    it('removes only the caller brand from a multi-brand offer', () => {
        expect(
            detachBrands(
                productPromo([], [FIREAWAY, WOK]),
                [FIREAWAY],
                [FIREAWAY, WOK, PERI],
                lookup,
            ),
        ).toEqual([WOK]);
    });

    it('materialises an all-brand offer into everyone-but-me', () => {
        expect(
            detachBrands(
                { applicationScope: 'whole_order', eligibilityBrandIds: null },
                [FIREAWAY],
                [FIREAWAY, WOK, PERI],
                lookup,
            ),
        ).toEqual([WOK, PERI].sort((a, b) => a - b));
    });

    it('returns [] when the caller was the last brand (caller must delete instead)', () => {
        expect(
            detachBrands(
                productPromo([3097]),
                [FIREAWAY],
                [FIREAWAY, WOK],
                lookup,
            ),
        ).toEqual([]);
    });
});
