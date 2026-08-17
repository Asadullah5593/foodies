import { canSeeAssignment, hasPermission } from './employee-scope';

/**
 * The brand-null rule is the one piece of HR scoping that differs from every
 * other module: brand-locked users see shared branch staff too. It was a
 * deliberate client decision (docs/HRM.md §14.3), so it gets pinned here —
 * a future "consistency" cleanup that removes it would quietly make cleaners
 * and security guards invisible to the only manager who can mark them present.
 */
describe('canSeeAssignment', () => {
    const brandLockedManager = {
        allowedBranchIds: [10],
        allowedBrandIds: [25],
    };

    it('sees their own brand at their own branch', () => {
        expect(
            canSeeAssignment({ branchId: 10, brandId: 25 }, brandLockedManager),
        ).toBe(true);
    });

    it('sees brand-null (shared) staff at their branch', () => {
        expect(
            canSeeAssignment(
                { branchId: 10, brandId: null },
                brandLockedManager,
            ),
        ).toBe(true);
    });

    it('does NOT see another brand at the same branch', () => {
        expect(
            canSeeAssignment({ branchId: 10, brandId: 26 }, brandLockedManager),
        ).toBe(false);
    });

    it('does NOT see their own brand at another branch', () => {
        expect(
            canSeeAssignment({ branchId: 11, brandId: 25 }, brandLockedManager),
        ).toBe(false);
    });

    it('does NOT see shared staff at another branch', () => {
        expect(
            canSeeAssignment(
                { branchId: 11, brandId: null },
                brandLockedManager,
            ),
        ).toBe(false);
    });

    it('unrestricted user (GM/owner) sees everything', () => {
        const gm = { allowedBranchIds: null, allowedBrandIds: null };
        expect(canSeeAssignment({ branchId: 99, brandId: 7 }, gm)).toBe(true);
        expect(canSeeAssignment({ branchId: 99, brandId: null }, gm)).toBe(
            true,
        );
    });

    it('branch-scoped but not brand-locked sees every brand at that branch', () => {
        const branchManager = { allowedBranchIds: [10], allowedBrandIds: null };
        expect(
            canSeeAssignment({ branchId: 10, brandId: 26 }, branchManager),
        ).toBe(true);
        expect(
            canSeeAssignment({ branchId: 12, brandId: 26 }, branchManager),
        ).toBe(false);
    });

    it('empty branch list matches nothing rather than everything', () => {
        const nobody = { allowedBranchIds: [], allowedBrandIds: null };
        expect(canSeeAssignment({ branchId: 10, brandId: null }, nobody)).toBe(
            false,
        );
    });
});

describe('hasPermission', () => {
    it('super admin passes without an explicit grant', () => {
        expect(hasPermission({ id: 1, tenantId: null }, 'salary:view')).toBe(
            true,
        );
    });

    it('tenant user needs the explicit permission', () => {
        const user = {
            id: 2,
            tenantId: 1,
            permissions: ['employees:view'],
        };
        expect(hasPermission(user, 'employees:view')).toBe(true);
        expect(hasPermission(user, 'salary:view')).toBe(false);
    });

    it('missing permission list denies rather than defaults open', () => {
        expect(hasPermission({ id: 3, tenantId: 1 }, 'employees:view')).toBe(
            false,
        );
    });
});
