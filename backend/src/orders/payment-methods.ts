/**
 * Tender types the admin orders list can filter by.
 *
 * `payments.payment_method` is free-text, so the filter is whitelisted — an
 * unknown value must not reach the query. The catch is what "not reaching the
 * query" means: an unrecognised method is dropped, and dropping a filter
 * returns EVERY order rather than none, which reads as "the filter is broken"
 * instead of "no matches". So this list has to stay in step with the options
 * the Orders page actually offers — `cod` was missing from it for exactly that
 * reason, and COD looked like it did nothing.
 */
export const ORDER_PAYMENT_METHOD_FILTERS: string[] = [
    'cash',
    'card',
    'online_transfer',
    // Cash collected on delivery / at the counter for a consumer-app order.
    // Recorded as a tender on completion, so it filters like any other.
    'cod',
];

export function isOrderPaymentMethodFilter(value: unknown): value is string {
    return (
        typeof value === 'string' &&
        ORDER_PAYMENT_METHOD_FILTERS.includes(value)
    );
}
