import { ForbiddenException } from '@nestjs/common';
import { resolveRiderBrandScope } from './rider-brand-scope.util';

describe('resolveRiderBrandScope', () => {
    describe('owner / GM (allowedBrandIds == null)', () => {
        it('returns null (no filter) when no brand requested', () => {
            expect(resolveRiderBrandScope(undefined, null)).toBeNull();
            expect(resolveRiderBrandScope(null, null)).toBeNull();
        });

        it('targets exactly the requested brand', () => {
            expect(resolveRiderBrandScope(7, null)).toEqual([7]);
        });
    });

    describe('brand-locked admin', () => {
        it('defaults to the full allowed set when no brand requested', () => {
            expect(resolveRiderBrandScope(undefined, [3, 5])).toEqual([3, 5]);
        });

        it('narrows to a requested brand within scope', () => {
            expect(resolveRiderBrandScope(5, [3, 5])).toEqual([5]);
        });

        it('rejects a brand outside the allowed set (scope escape)', () => {
            expect(() => resolveRiderBrandScope(9, [3, 5])).toThrow(
                ForbiddenException,
            );
        });

        it('rejects any requested brand when the allowed set is empty', () => {
            expect(() => resolveRiderBrandScope(3, [])).toThrow(
                ForbiddenException,
            );
        });
    });
});
