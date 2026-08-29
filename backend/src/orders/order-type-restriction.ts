import { ForbiddenException } from '@nestjs/common';

/**
 * MARKER permissions, in the same family as `orders:place:call-center`:
 * holding one grants nothing, it NARROWS what `orders:create` may produce.
 *
 *   orders:create:delivery-only   → delivery
 *   orders:create:takeaway-only   → takeaway (and its stored alias, pickup)
 *   orders:create:dine-in-only    → dine-in
 *
 * Held together they ADD UP: delivery-only + takeaway-only = "takeaway and
 * delivery, no dine-in". Held alone each means exactly what its name says,
 * which keeps every existing delivery-only account behaving as before. Held
 * by nobody, every type the branch offers is allowed.
 *
 * Built for call-centre desks (delivery only) and for counters that never
 * seat anyone. Assigned by hand per role; the migrations grant them to no one.
 */
export const DELIVERY_ONLY_PERMISSION = 'orders:create:delivery-only';
export const TAKEAWAY_ONLY_PERMISSION = 'orders:create:takeaway-only';
export const DINE_IN_ONLY_PERMISSION = 'orders:create:dine-in-only';

/** The only order type a delivery-only user may place. */
export const DELIVERY_ONLY_ORDER_TYPE = 'delivery';

/** Marker → the order types it admits. `pickup` is how the consumer channels store takeaway. */
const MARKER_ORDER_TYPES: ReadonlyArray<readonly [string, readonly string[]]> =
    [
        [DELIVERY_ONLY_PERMISSION, ['delivery']],
        [TAKEAWAY_ONLY_PERMISSION, ['takeaway', 'pickup']],
        [DINE_IN_ONLY_PERMISSION, ['dine_in']],
    ];

type Actor = { permissions?: string[] | null } | null | undefined;

/** True when the delivery marker is held (kept for callers that ask only that). */
export function isDeliveryOnly(actor: Actor): boolean {
    return actor?.permissions?.includes(DELIVERY_ONLY_PERMISSION) ?? false;
}

/**
 * The order types this actor may place, or null when unrestricted — the union
 * of every marker held. Anonymous callers (kiosk, consumer) carry no actor and
 * are never restricted: the markers are a till concept.
 */
export function allowedOrderTypes(actor: Actor): Set<string> | null {
    const perms = actor?.permissions ?? null;
    if (!perms?.length) return null;
    const allowed = new Set<string>();
    for (const [marker, types] of MARKER_ORDER_TYPES) {
        if (perms.includes(marker)) for (const t of types) allowed.add(t);
    }
    return allowed.size ? allowed : null;
}

/** Human labels for the refusal, in the order the POS shows them. */
const LABELS: Record<string, string> = {
    dine_in: 'dine-in',
    takeaway: 'takeaway',
    delivery: 'delivery',
};

/**
 * Throw if the actor may not place this order type. Called from both quote
 * and createOrder — the POS hides the other types for such a user, but the
 * server is what actually enforces it.
 *
 * Deliberately not soft on quote (unlike a refused staff discount): an order
 * type the user may not place at all is not a partial state to price around,
 * it is the wrong request. Failing the quote surfaces a stale session
 * immediately instead of at the very end of a phone call.
 */
export function assertOrderTypeAllowed(actor: Actor, orderType: string): void {
    const allowed = allowedOrderTypes(actor);
    if (!allowed || allowed.has(orderType)) return;
    const names = ['dine_in', 'takeaway', 'delivery']
        .filter((t) => allowed.has(t))
        .map((t) => LABELS[t]);
    throw new ForbiddenException(
        `This account may place ${names.join(' and ')} orders only.`,
    );
}
