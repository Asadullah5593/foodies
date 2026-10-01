/**
 * Order figures shown beside a customer in the admin (Customers table and the
 * customer detail page): how many orders they completed, how many were
 * cancelled, what they spent, and when they last ordered.
 *
 * Rules, agreed with the client and pinned in customer-order-stats.spec.ts:
 *  - Only FINISHED orders count. An order still in progress (placed, accepted,
 *    preparing, ready) is in neither column until it completes or is cancelled.
 *  - Spent is the total of COMPLETED orders only. A cancelled order's amount
 *    was never collected.
 *  - Last (and first) order is the most recent (earliest) COMPLETED order, so a
 *    cancelled order never makes a lapsed customer look active.
 *
 * The figures are computed over the orders the VIEWER may read in the Orders
 * module — never more — so "12 completed" here opens a list of 12 there.
 */

/** Which orders the viewer may read. Mirrors OrdersService.findAllAdmin. */
export type CustomerOrderScope = {
    /** null = super admin, no tenant filter. */
    tenantId: number | null;
    /** null/empty = every branch (owner/GM). */
    allowedBranchIds?: number[] | null;
    /** null = not brand-locked. */
    allowedBrandIds?: number[] | null;
    /** Positive = role limited to the last N days of orders. */
    orderHistoryDays?: number | null;
    /** orders:view:own-* markers; null = every channel. */
    restrictedSources?: string[] | null;
};

export type CustomerOrderStats = {
    completed_count: number;
    cancelled_count: number;
    /** Completed orders only. null when the viewer may not see money totals. */
    spent: number | null;
    /** Most recent COMPLETED order (ISO), or null if they never completed one. */
    last_order_at: string | null;
};

export const EMPTY_ORDER_STATS: CustomerOrderStats = {
    completed_count: 0,
    cancelled_count: 0,
    spent: 0,
    last_order_at: null,
};

/** The SELECT list every stats query shares, so the rules live in one place. */
export const ORDER_STATS_SELECT = `
    COUNT(*) FILTER (WHERE o.status = 'completed')::int AS completed_count,
    COUNT(*) FILTER (WHERE o.status = 'cancelled')::int AS cancelled_count,
    COALESCE(SUM(o.total_amount) FILTER (WHERE o.status = 'completed'), 0) AS spent,
    MAX(o.placed_at) FILTER (WHERE o.status = 'completed') AS last_order_at,
    MIN(o.placed_at) FILTER (WHERE o.status = 'completed') AS first_order_at`;

/** Only finished orders are ever counted; in-progress ones are in no column. */
export const FINISHED_ORDERS_SQL = `o.status IN ('completed', 'cancelled')`;

/**
 * The viewer's order scope as ` AND …` SQL, numbered from `firstParam`.
 * Returns an empty string for an unrestricted viewer.
 */
export function orderScopeSql(
    scope: CustomerOrderScope,
    firstParam: number,
): { sql: string; params: unknown[] } {
    const parts: string[] = [];
    const params: unknown[] = [];
    const bind = (value: unknown): string => {
        params.push(value);
        return `$${firstParam + params.length - 1}`;
    };
    if (scope.tenantId != null)
        parts.push(`o.tenant_id = ${bind(scope.tenantId)}`);
    if (
        Array.isArray(scope.allowedBranchIds) &&
        scope.allowedBranchIds.length > 0
    )
        parts.push(`o.branch_id = ANY(${bind(scope.allowedBranchIds)}::int[])`);
    // Brand-locked users only ever see their own brand's orders.
    if (scope.allowedBrandIds != null)
        parts.push(`o.brand_id = ANY(${bind(scope.allowedBrandIds)}::int[])`);
    const days = scope.orderHistoryDays;
    if (days != null && Number.isFinite(days) && days > 0)
        parts.push(
            `date(o.placed_at) >= (CURRENT_DATE - CAST(${bind(Math.floor(days))} AS int) + 1)`,
        );
    if (scope.restrictedSources?.length)
        parts.push(`o.source = ANY(${bind(scope.restrictedSources)}::text[])`);
    return { sql: parts.map((p) => ` AND ${p}`).join(''), params };
}

type RawStats = {
    completed_count: number | string | null;
    cancelled_count: number | string | null;
    spent: number | string | null;
    last_order_at: Date | string | null;
    first_order_at?: Date | string | null;
};

export function toIso(value: Date | string | null | undefined): string | null {
    if (value == null) return null;
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

/** Raw aggregate row → API shape. `hideTotals` blanks the money figure. */
export function mapOrderStats(
    row: RawStats | undefined,
    hideTotals: boolean,
): CustomerOrderStats {
    if (!row) return { ...EMPTY_ORDER_STATS, spent: hideTotals ? null : 0 };
    return {
        completed_count: Number(row.completed_count) || 0,
        cancelled_count: Number(row.cancelled_count) || 0,
        spent: hideTotals ? null : Number(row.spent) || 0,
        last_order_at: toIso(row.last_order_at),
    };
}
