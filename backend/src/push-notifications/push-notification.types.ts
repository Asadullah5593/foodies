export type OrderPushType =
    | 'kitchen_accepted'
    | 'rider_assigned'
    | 'picked_up'
    | 'delivered'
    | 'cancelled';

/** Rider app deep-link screens (Flutter contract). */
export type RiderPushScreen = 'rider_order_detail' | 'rider_orders';
