import { BadRequestException, ConflictException } from '@nestjs/common';

/**
 * Manual menu ordering.
 *
 * `sort_order` is set by hand in the admin panel (menu items within a
 * brand+category, categories within a brand) so the mobile app can render a
 * deliberate menu order instead of insertion order.
 *
 * Zero is the column default and means UNSET: rows that nobody has numbered
 * yet. Unset rows sort LAST — an unnumbered item floating above the ones you
 * deliberately placed is worse than one sitting at the bottom — and they are
 * exempt from the uniqueness check, because every unnumbered row shares 0 and
 * they would otherwise all collide with each other.
 */
export const SORT_ORDER_UNSET = 0;

/** Anything at/above this is unreachable by hand; used to push unset rows last. */
const UNSET_RANK = 999999;

/**
 * Sort key that pushes unset (0) rows to the end.
 *
 * Deliberately in-memory rather than a SQL CASE: a dotted CASE inside
 * TypeORM's orderBy() has misfired in this codebase before, and every list
 * that needs this loads its full result set anyway.
 */
export function sortRank(sortOrder: number | null | undefined): number {
    const n = Number(sortOrder ?? SORT_ORDER_UNSET);
    if (!Number.isFinite(n) || n === SORT_ORDER_UNSET) return UNSET_RANK;
    return n;
}

/**
 * Validates a hand-entered sort order. Returns the coerced value.
 * `undefined` in, `undefined` out — "field omitted, leave unchanged".
 */
export function normalizeSortOrder(input: unknown): number | undefined {
    if (input === undefined) return undefined;
    if (input === null || input === '') return SORT_ORDER_UNSET;
    const n = Number(input);
    if (!Number.isFinite(n) || !Number.isInteger(n)) {
        throw new BadRequestException('sort_order must be a whole number');
    }
    if (n < 0) {
        throw new BadRequestException('sort_order cannot be negative');
    }
    if (n >= UNSET_RANK) {
        throw new BadRequestException(`sort_order must be below ${UNSET_RANK}`);
    }
    return n;
}

/** A row competing for a sort slot. `id` lets us exempt the row being edited. */
export interface SortOrderPeer {
    id: number;
    sortOrder: number | null;
}

/**
 * The taken numbers and the next free one, for the admin panel's
 * "1-5 taken · suggested 6" hint.
 */
export function summarizeSortOrders(peers: SortOrderPeer[]): {
    taken: number[];
    suggested: number;
} {
    const taken = [
        ...new Set(
            peers
                .map((p) => Number(p.sortOrder ?? SORT_ORDER_UNSET))
                .filter((n) => Number.isFinite(n) && n !== SORT_ORDER_UNSET),
        ),
    ].sort((a, b) => a - b);

    // "up to 5 are taken, use 6" — one past the highest, so the suggestion
    // appends to the end of the list rather than wedging into a gap.
    const suggested = taken.length ? taken[taken.length - 1] + 1 : 1;
    return { taken, suggested };
}

/**
 * Throws 409 if `desired` is already used by a different row in the same scope.
 * Unset (0) never collides — see the module comment.
 */
export function assertSortOrderAvailable(
    desired: number | undefined,
    peers: SortOrderPeer[],
    opts: { excludeId?: number; label: string },
): void {
    if (desired === undefined || desired === SORT_ORDER_UNSET) return;
    const clash = peers.find(
        (p) =>
            p.id !== opts.excludeId &&
            Number(p.sortOrder ?? SORT_ORDER_UNSET) === desired,
    );
    if (!clash) return;
    const { suggested } = summarizeSortOrders(peers);
    throw new ConflictException(
        `Sort order ${desired} is already used by another ${opts.label}. Next available: ${suggested}.`,
    );
}
