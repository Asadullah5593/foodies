/**
 * Where an order was taken. Mirrors backend/src/orders/order-sources.ts — these
 * are the only values the app writes to `orders.source`.
 */
export const ORDER_SOURCES = ['pos', 'consumer_app', 'kiosk'] as const;

export type OrderSource = (typeof ORDER_SOURCES)[number];

export const ORDER_SOURCE_LABEL: Record<OrderSource, string> = {
  pos: 'POS',
  consumer_app: 'Consumer app',
  kiosk: 'Kiosk',
};

/** Label for a source; '—' when absent, and raw-but-readable for anything unknown. */
export function orderSourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  return ORDER_SOURCE_LABEL[source as OrderSource] ?? source.replace(/_/g, ' ');
}
