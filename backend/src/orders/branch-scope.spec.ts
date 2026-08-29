import { ForbiddenException } from '@nestjs/common';
import {
    assertBranchesAllowed,
    isBranchRestricted,
    scopeBranchIds,
} from './branch-scope';

/**
 * The POS branch gate. `allowedBranchIds` comes from RoleAccessGuard: null
 * for all-branches:access holders, an array for everyone assigned through
 * branch_users. Callers that never carry the field (consumer, kiosk, gateway)
 * must stay unrestricted — they have gates of their own.
 */
describe('branch-scope', () => {
    it('treats null (all-branches:access) and a missing field as unrestricted', () => {
        expect(isBranchRestricted({ allowedBranchIds: null })).toBe(false);
        expect(isBranchRestricted({})).toBe(false);
        expect(isBranchRestricted(null)).toBe(false);
        expect(isBranchRestricted(undefined)).toBe(false);
        expect(() => assertBranchesAllowed(null, [1, 2, 3])).not.toThrow();
        expect(() =>
            assertBranchesAllowed({ allowedBranchIds: null }, [99]),
        ).not.toThrow();
        expect(scopeBranchIds(undefined, [1, 2])).toEqual([1, 2]);
    });

    it('lets an assigned branch through', () => {
        expect(() =>
            assertBranchesAllowed({ allowedBranchIds: [10, 11] }, [10]),
        ).not.toThrow();
    });

    it('refuses a branch outside the assignment — the Johar Town → Pine Avenue case', () => {
        expect(() =>
            assertBranchesAllowed({ allowedBranchIds: [23] }, [23, 24]),
        ).toThrow(ForbiddenException);
    });

    it('refuses everything for an account assigned to no branch at all', () => {
        expect(() =>
            assertBranchesAllowed({ allowedBranchIds: [] }, [23]),
        ).toThrow(ForbiddenException);
    });

    it('accepts ids that arrive as strings (query params)', () => {
        expect(() =>
            assertBranchesAllowed({ allowedBranchIds: [23] }, [
                '23' as unknown as number,
            ]),
        ).not.toThrow();
    });

    it('scopes the open-shift branch list to the assignment', () => {
        expect(
            scopeBranchIds({ allowedBranchIds: [23] }, [23, 24, 25]),
        ).toEqual([23]);
        expect(scopeBranchIds({ allowedBranchIds: [] }, [23, 24])).toEqual([]);
    });
});
