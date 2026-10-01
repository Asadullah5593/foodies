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

/**
 * Pill colours for where a customer registered: slate for the counter, green
 * for the mobile app — the same pair the loyalty tags use for POS and APP —
 * with the website and the kiosk given colours of their own.
 */
export const CUSTOMER_SOURCE_BADGE: Record<string, string> = {
  pos: 'bg-[#F1F2F5] text-[#5A6473] dark:bg-slate-700 dark:text-slate-300',
  consumer_app: 'bg-[#EAF7EE] text-[#16A34A] dark:bg-emerald-900/40 dark:text-emerald-300',
  consumer_web: 'bg-[#EAF2FE] text-[#2563EB] dark:bg-blue-900/40 dark:text-blue-300',
  kiosk: 'bg-[#F3EEFE] text-[#7C3AED] dark:bg-violet-900/40 dark:text-violet-300',
};

/** The matching outline, where the pill is drawn with a border (the profile). */
export const CUSTOMER_SOURCE_BORDER: Record<string, string> = {
  pos: 'border-[#E2E5EA] dark:border-slate-600',
  consumer_app: 'border-[#CDEBD6] dark:border-emerald-800',
  consumer_web: 'border-[#CFE0FB] dark:border-blue-800',
  kiosk: 'border-[#E0D3FB] dark:border-violet-800',
};

/** Label for a source; '—' when absent, raw-but-readable for anything unknown. */
export function customerSourceLabel(source: string | null | undefined): string {
  if (!source) return '—';
  return CUSTOMER_SOURCE_LABEL[source as CustomerSource] ?? source.replace(/_/g, ' ');
}
