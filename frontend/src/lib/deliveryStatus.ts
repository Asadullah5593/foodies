/**
 * One source of truth for `orders.delivery_status` presentation.
 *
 * The map used to be copy-pasted into Admin Orders, the Rider dashboard and the
 * Rider order page, which is how the Admin order-detail page ended up showing
 * no delivery state at all.
 */

/** Canonical labels. The Orders table uses the short form to fit its column. */
export const DELIVERY_STATUS_LABELS: Record<string, string> = {
  assigned: 'Assigned',
  accepted: 'Accepted',
  picked_up: 'Picked Up',
  delivered: 'Delivered',
  delivery_failed: 'Delivery Failed',
};

const SHORT_LABELS: Record<string, string> = {
  delivery_failed: 'Failed',
};

/**
 * Human label for a delivery status. `short` trims the longest label for dense
 * table cells. Unknown values pass through so a new backend status is visible
 * rather than silently blank.
 */
export function deliveryStatusLabel(
  status: string | null | undefined,
  opts?: { short?: boolean; fallback?: string },
): string {
  if (!status) return opts?.fallback ?? 'No rider';
  if (opts?.short && SHORT_LABELS[status]) return SHORT_LABELS[status];
  return DELIVERY_STATUS_LABELS[status] ?? status;
}

/** Tailwind classes for a status pill. */
export function deliveryStatusTone(status: string | null | undefined): string {
  switch (status) {
    case 'delivered':
      return 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300';
    case 'delivery_failed':
      return 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300';
    case 'picked_up':
      return 'bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300';
    case 'accepted':
    case 'assigned':
      return 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300';
    default:
      return 'bg-gray-100 text-gray-700 dark:bg-slate-700 dark:text-slate-300';
  }
}

export function isDeliveryFailed(status: string | null | undefined): boolean {
  return status === 'delivery_failed';
}
