/**
 * Repeated Customers report — the pure parts (row shaping and order), kept out
 * of ReportsService so they can be tested without a database.
 *
 * A repeated customer ordered on two or more DIFFERENT days in the window.
 * Several orders on one day are one visit, so `days` counts distinct calendar
 * days on the branch clock, not orders.
 */

/** The statuses an order can be in — the ones the report can be narrowed to. */
export const REPEATED_CUSTOMER_STATUSES = [
    'placed',
    'accepted',
    'preparing',
    'ready',
    'completed',
    'cancelled',
] as const;

export type RepeatedCustomerStatus =
    (typeof REPEATED_CUSTOMER_STATUSES)[number];

/**
 * The status filter, or null for every status. An unknown value means no
 * filter, never "match nothing" — the same rule as the discount filter.
 */
export function repeatedCustomersStatus(
    value: string | null | undefined,
): RepeatedCustomerStatus | null {
    const v = (value ?? '').trim().toLowerCase();
    return (REPEATED_CUSTOMER_STATUSES as readonly string[]).includes(v)
        ? (v as RepeatedCustomerStatus)
        : null;
}

/** One row as the grouped query returns it (Postgres numbers come back as strings). */
export interface RepeatedCustomerRaw {
    customer_id: number | string;
    /** The customer record's name. */
    record_name: string | null;
    /** The name typed on their latest order in the window, if any. */
    order_name: string | null;
    phone: string | null;
    days: number | string;
    spend: number | string | null;
}

export interface RepeatedCustomerRow {
    customer_id: number;
    /** Record name, else the latest typed order name; null when neither exists (the page shows the phone). */
    name: string | null;
    phone: string | null;
    /** Distinct days with at least one order (of the picked status, if any) in the window. */
    days: number;
    /** Total of those orders, cancelled ones left out. */
    spend: number;
}

const cleaned = (s: string | null | undefined): string | null => {
    const t = (s ?? '').trim();
    return t.length > 0 ? t : null;
};

export function mapRepeatedCustomerRow(
    r: RepeatedCustomerRaw,
): RepeatedCustomerRow {
    return {
        customer_id: Number(r.customer_id),
        name: cleaned(r.record_name) ?? cleaned(r.order_name),
        phone: cleaned(r.phone),
        days: Number(r.days),
        spend: Math.round(Number(r.spend ?? 0) * 100) / 100,
    };
}

/** Most days first; ties by spend, then name, then id so the order is stable. */
export function compareRepeatedCustomers(
    a: RepeatedCustomerRow,
    b: RepeatedCustomerRow,
): number {
    if (b.days !== a.days) return b.days - a.days;
    if (b.spend !== a.spend) return b.spend - a.spend;
    const an = (a.name ?? a.phone ?? '').toLowerCase();
    const bn = (b.name ?? b.phone ?? '').toLowerCase();
    if (an !== bn) return an < bn ? -1 : 1;
    return a.customer_id - b.customer_id;
}
