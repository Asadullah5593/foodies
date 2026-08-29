import { ForbiddenException } from '@nestjs/common';

/**
 * Branch scope for staff-placed orders.
 *
 * RoleAccessGuard puts the caller's `allowedBranchIds` on the request user:
 * `null` = every branch (holders of all-branches:access — owner, GM, call
 * centre), an array = exactly the branches in their branch_users rows.
 * Consumer, kiosk and gateway callers never carry the field and are left
 * unrestricted here — they have their own gates.
 *
 * The POS paths used to recompute this as "every branch in the tenant", which
 * is how a cashier assigned to one branch could switch to, load the menu of,
 * and sell at another. The guard's value is the only one that should exist.
 */
export type BranchScopedActor =
    | {
          allowedBranchIds?: number[] | null;
      }
    | null
    | undefined;

/** True when the actor is limited to a list of branches. */
export function isBranchRestricted(
    actor: BranchScopedActor,
): actor is { allowedBranchIds: number[] } {
    return Array.isArray(actor?.allowedBranchIds);
}

/**
 * Keep only the branches the actor may use. Unrestricted actors get the list
 * back untouched.
 */
export function scopeBranchIds(
    actor: BranchScopedActor,
    branchIds: number[],
): number[] {
    if (!isBranchRestricted(actor)) return branchIds;
    const allowed = new Set(actor.allowedBranchIds);
    return branchIds.filter((id) => allowed.has(id));
}

/**
 * Refuse any branch outside the actor's assignment. Thrown, not softened:
 * selling at a branch you are not assigned to is the wrong request, and a
 * quote priced against it would only defer the refusal to the end of the
 * transaction.
 */
export function assertBranchesAllowed(
    actor: BranchScopedActor,
    branchIds: Iterable<number>,
): void {
    if (!isBranchRestricted(actor)) return;
    const allowed = new Set(actor.allowedBranchIds);
    for (const id of branchIds) {
        if (!allowed.has(Number(id))) {
            throw new ForbiddenException(
                'You are not assigned to this branch.',
            );
        }
    }
}
