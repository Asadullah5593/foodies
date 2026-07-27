/**
 * Where a customer record was first created. `customers.source` is a plain
 * varchar defaulting to 'pos' (see customer.entity.ts); these are the only
 * values the app writes. Deliberately mirrors `orders.source` values so the
 * two modules read the same way in the admin UI.
 *
 * - pos          staff created them (POS "add customer", admin Customers page)
 *                or a POS/counter order auto-created them
 * - consumer_app they registered in the mobile app (or an app order created them)
 * - consumer_web they registered on the public website
 * - kiosk        created by a self-service kiosk order
 *
 * Keep in sync with the frontend copy in frontend/src/utils/customerSources.ts.
 */
export const CUSTOMER_SOURCES: string[] = [
    'pos',
    'consumer_app',
    'consumer_web',
    'kiosk',
];

export type CustomerSource = 'pos' | 'consumer_app' | 'consumer_web' | 'kiosk';

/** Narrow an arbitrary string (e.g. an order's source) to a customer source. */
export function toCustomerSource(
    raw: string | null | undefined,
    fallback: CustomerSource = 'pos',
): CustomerSource {
    const v = (raw ?? '').trim();
    return CUSTOMER_SOURCES.includes(v) ? (v as CustomerSource) : fallback;
}
