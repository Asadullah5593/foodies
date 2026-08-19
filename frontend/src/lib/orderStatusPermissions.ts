/** Narrowing permission: may work the status flow but never cancel. */
export const NO_CANCEL_PERMISSION = 'orders:update-status:no-cancel';

/** Narrowing permission: hides the Orders page "Page value" money total. */
export const NO_TOTALS_PERMISSION = 'orders:view:no-totals';

/** Either of these lets a user change an order's status. */
export const STATUS_CHANGE_PERMISSIONS = [
  'orders:update-status',
  NO_CANCEL_PERMISSION,
];

export const CANCELLED_STATUS = 'cancelled';

/**
 * Drop cancel from a list of statuses for a no-cancel account.
 *
 * Every admin cancel surface — the Orders dropdown, the order detail select,
 * the Reject button on the notification toast — funnels into the same
 * PUT /admin/orders/:id/status, which refuses it server-side. This keeps the UI
 * from offering an action that would only come back as a 403.
 */
export function selectableStatuses(
  statuses: string[],
  noCancel: boolean,
): string[] {
  if (!noCancel) return statuses;
  return statuses.filter((s) => s !== CANCELLED_STATUS);
}
