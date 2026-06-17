import { ForbiddenException } from '@nestjs/common';

/**
 * Resolve the brand set a rider query/assignment may target, mirroring the
 * discounts eligibility pattern:
 *  - owner/GM (allowedBrandIds == null): may target any brand (returns
 *    [requestedBrandId] when one is given, else null = no brand filter);
 *  - brand-locked admin: clamped to their own brands and may NOT escape — an
 *    out-of-scope requestedBrandId throws; with none requested, defaults to
 *    their full brand set.
 */
export function resolveRiderBrandScope(
    requestedBrandId: number | null | undefined,
    allowedBrandIds: number[] | null | undefined,
): number[] | null {
    if (allowedBrandIds == null) {
        return requestedBrandId != null ? [Number(requestedBrandId)] : null;
    }
    if (requestedBrandId != null) {
        if (!allowedBrandIds.includes(Number(requestedBrandId))) {
            throw new ForbiddenException(
                'You do not have access to this brand',
            );
        }
        return [Number(requestedBrandId)];
    }
    return [...allowedBrandIds];
}
