/**
 * Where an order was taken. `orders.source` is a plain varchar defaulting to
 * 'pos' (see order.entity.ts), so these are the only values the app ever
 * writes — anything else means someone wrote to the column directly.
 *
 * Keep in sync with the frontend copy in frontend/src/utils/orderSources.ts.
 */
export const ORDER_SOURCES: string[] = [
    'pos',
    'call_centre',
    'consumer_app',
    'consumer_web',
    'kiosk',
];
