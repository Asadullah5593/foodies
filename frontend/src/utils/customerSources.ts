/**
 * Where a customer record was first created. Mirrors
 * backend/src/customers/customer-sources.ts — these are the only values the
 * app writes to `customers.source`.
 */
export const CUSTOMER_SOURCES = ['pos', 'consumer_app', 'consumer_web', 'kiosk'] as const;

export type CustomerSource = (typeof CUSTOMER_SOURCES)[number];

export const CUSTOMER_SOURCE_LABEL: Record<CustomerSource, string> = {
  pos: 'POS',
  consumer_app: 'Mobile app',
  consumer_web: 'Website',
  kiosk: 'Kiosk',
};

/** Badge colours, matching the Orders module's source badges. */
export const CUSTOMER_SOURCE_BADGE: Record<string, string> = {
  pos: 'bg-indigo-50 text-indigo-700 dark:bg-indigo-900/40 dark:text-indigo-200',
  consumer_app: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-200',
  consumer_web: 'bg-teal-50 text-teal-700 dark:bg-teal-900/40 dark:text-teal-200',
  kiosk: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-100',
};

/** Label for a source; '—' when absent, raw-but-readable for anything unknown. */
export function customerSourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  return CUSTOMER_SOURCE_LABEL[source as CustomerSource] ?? source.replace(/_/g, ' ');
}
