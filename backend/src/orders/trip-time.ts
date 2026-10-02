/**
 * Delivery trip time: from the rider marking the order picked up to marking it
 * delivered (orders.picked_up_at → orders.delivered_at).
 *
 * Null unless both moments were recorded, and null when they are out of order
 * (a client that sent "delivered" before "picked up"): a missing figure is
 * honest, a negative or invented one is not.
 */
export function tripDurationSeconds(
    pickedUpAt: Date | null | undefined,
    deliveredAt: Date | null | undefined,
): number | null {
    if (!pickedUpAt || !deliveredAt) return null;
    const ms = deliveredAt.getTime() - pickedUpAt.getTime();
    if (!Number.isFinite(ms) || ms < 0) return null;
    return Math.round(ms / 1000);
}

/** The three trip fields every admin payload exposes, in one shape. */
export function tripTimeFields(order: {
    pickedUpAt?: Date | null;
    deliveredAt?: Date | null;
}): {
    picked_up_at: string | null;
    delivered_at: string | null;
    trip_duration_seconds: number | null;
} {
    return {
        picked_up_at: order.pickedUpAt?.toISOString() ?? null,
        delivered_at: order.deliveredAt?.toISOString() ?? null,
        trip_duration_seconds: tripDurationSeconds(
            order.pickedUpAt,
            order.deliveredAt,
        ),
    };
}
