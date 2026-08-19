import { ForbiddenException } from '@nestjs/common';

/**
 * A MARKER permission, in the same family as `orders:place:call-center`:
 * holding it does not grant anything, it NARROWS what `orders:create` may
 * produce. A user carrying it may punch delivery orders only — dine-in and
 * takeaway are refused.
 *
 * Built for call-centre agents: they take orders over the phone for delivery,
 * and a dine-in or takeaway punched from a call-centre desk is always a slip
 * (nobody is at the counter to collect it). Assigned by hand per role; the
 * migration deliberately grants it to nobody.
 */
export const DELIVERY_ONLY_PERMISSION = 'orders:create:delivery-only';

/** The only order type a delivery-only user may place. */
export const DELIVERY_ONLY_ORDER_TYPE = 'delivery';

export function isDeliveryOnly(
    actor: { permissions?: string[] | null } | null | undefined,
): boolean {
    return actor?.permissions?.includes(DELIVERY_ONLY_PERMISSION) ?? false;
}

/**
 * Throw if a delivery-only user is trying to place anything else. Called from
 * both quote and createOrder — the POS hides the other order types for such a
 * user, but the server is what actually enforces it.
 *
 * Deliberately not soft on quote (unlike a refused staff discount): an order
 * type the user may not place at all is not a partial state to price around,
 * it is the wrong request. Failing the quote surfaces a stale session
 * immediately instead of at the very end of a phone call.
 */
export function assertOrderTypeAllowed(
    actor: { permissions?: string[] | null } | null | undefined,
    orderType: string,
): void {
    if (!isDeliveryOnly(actor)) return;
    if (orderType === DELIVERY_ONLY_ORDER_TYPE) return;
    throw new ForbiddenException(
        'This account may place delivery orders only.',
    );
}
