export const DELIVERY_STATUS_OPTIONS = [
  { value: 'accepted', label: 'Accepted' },
  { value: 'picked_up', label: 'Picked Up' },
  { value: 'delivered', label: 'Delivered' },
  { value: 'delivery_failed', label: 'Delivery Failed' },
];

/**
 * What the rider may mark next — the same two steps as the rider mobile app:
 * first Picked Up, and only then Delivered or Delivery Failed. Offering
 * Delivered at the first step let a delivery finish with no pickup on record,
 * which leaves the order without a trip time.
 */
export function getStatusOptions(currentStatus: string | null | undefined) {
  if (currentStatus === 'accepted' || currentStatus === 'assigned' || !currentStatus) {
    return DELIVERY_STATUS_OPTIONS.filter((o) => o.value === 'picked_up');
  }
  if (currentStatus === 'picked_up') {
    return DELIVERY_STATUS_OPTIONS.filter((o) => o.value === 'delivered' || o.value === 'delivery_failed');
  }
  return DELIVERY_STATUS_OPTIONS;
}
