import { ForbiddenException } from '@nestjs/common';

/**
 * `orders:update-status:no-cancel` — status changes without the power to
 * cancel.
 *
 * Unlike the pure markers in this family (`orders:place:call-center`,
 * `orders:create:delivery-only`) this permission does two jobs at once:
 *
 * 1. It **grants**. Holding it alone is enough to move an order through
 *    placed → accepted → preparing → ready → completed, in any direction —
 *    the admin status route accepts it in place of `orders:update-status`.
 * 2. It **restricts**, and the restriction wins. If an account somehow holds
 *    `orders:update-status` as well (a second role, an umbrella), cancel is
 *    still refused. A narrowing that a stray grant can undo is not a
 *    narrowing, and roles get edited.
 *
 * Every user-facing cancel funnels through PUT /admin/orders/:id/status — the
 * status dropdown, the order detail screen, and the "Reject" button on the
 * notification toast that floats over every screen all call it. So one gate on
 * that route covers all three. The kitchen route cannot cancel (it whitelists
 * accepted/preparing/ready/completed) and the rider route sets delivery status,
 * not order status.
 *
 * System-initiated cancellations — payment expiry, failed placement — call the
 * service directly and are unaffected: this gate lives at the controller, not
 * inside updateStatus().
 */
export const NO_CANCEL_PERMISSION = 'orders:update-status:no-cancel';

/** The one status a no-cancel account may not set. */
export const CANCELLED_STATUS = 'cancelled';

export function isNoCancel(
    actor: { permissions?: string[] | null } | null | undefined,
): boolean {
    return actor?.permissions?.includes(NO_CANCEL_PERMISSION) ?? false;
}

/**
 * Throw if a no-cancel account is trying to cancel. The admin UI hides the
 * option for such a user, but this is what actually enforces it.
 */
export function assertStatusChangeAllowed(
    actor: { permissions?: string[] | null } | null | undefined,
    status: string,
): void {
    if (!isNoCancel(actor)) return;
    if (
        String(status ?? '')
            .trim()
            .toLowerCase() !== CANCELLED_STATUS
    )
        return;
    throw new ForbiddenException('This account may not cancel orders.');
}
