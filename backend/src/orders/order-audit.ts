import { ActivityContext } from '../activity-log/activity-context';

/** The few fields of an order the activity log needs. */
export interface AuditableOrder {
    id: number;
    tenantId?: number | null;
    branchId?: number | null;
    brandId?: number | null;
    /** Daily call-out number (`013`). Repeats every day, per branch and brand. */
    orderNumber?: string | null;
    /** Permanent tracking reference (`FDS-A7K2M9QX`). */
    orderId?: string | null;
}

/**
 * How the log names an order: the number staff say out loud, then the
 * reference that never repeats — `013 · FDS-A7K2M9QX`. The first is what
 * people search for; the second tells two 013s apart.
 */
export function orderLabel(order: AuditableOrder): string {
    const parts = [order.orderNumber, order.orderId].filter(
        (p): p is string => typeof p === 'string' && p.trim() !== '',
    );
    return parts.length ? parts.join(' · ') : `#${order.id}`;
}

const words = (value: string | null | undefined): string =>
    (value ?? 'none').replace(/_/g, ' ');

const SOURCES: Record<string, string> = {
    pos: 'the POS',
    call_centre: 'the call centre',
    kiosk: 'a kiosk',
    consumer_app: 'the customer app',
    consumer_web: 'the website',
};

/** "Placed as a delivery order from the POS" */
export function placedSummary(orderType: string, source: string): string {
    const type = words(orderType);
    const from = SOURCES[source] ?? words(source);
    return `Placed as ${/^[aeiou]/.test(type) ? 'an' : 'a'} ${type} order from ${from}`;
}

/**
 * Adds one line to an order's history.
 *
 * Call it after the write has succeeded. Never throws and does nothing outside
 * a request, so a cron job, a seed or a spec can run the same code untouched.
 */
export function auditOrder(
    order: AuditableOrder,
    summary: string,
    change?: {
        before?: Record<string, unknown> | null;
        after?: Record<string, unknown> | null;
    },
): void {
    try {
        if (!ActivityContext.isActive()) return;
        ActivityContext.recordEvent({
            entityType: 'order',
            entityId: order.id,
            entityLabel: orderLabel(order),
            summary,
            before: change?.before ?? null,
            after: change?.after ?? null,
            tenantId: order.tenantId ?? undefined,
            branchId: order.branchId ?? undefined,
            brandId: order.brandId ?? undefined,
        });
    } catch {
        // The order has already been changed; its audit line must not undo that.
    }
}

/** "Status changed from preparing to ready" */
export function auditOrderStatus(
    order: AuditableOrder,
    previous: string | null | undefined,
    next: string,
    field: 'status' | 'delivery_status' = 'status',
    extra?: Record<string, unknown>,
): void {
    const what = field === 'status' ? 'Status' : 'Delivery status';
    auditOrder(
        order,
        `${what} changed from ${words(previous)} to ${words(next)}`,
        {
            before: { [field]: previous ?? null },
            after: { [field]: next, ...(extra ?? {}) },
        },
    );
}
