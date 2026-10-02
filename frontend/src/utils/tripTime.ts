/**
 * Delivery trip time: the rider's "picked up" tap → "delivered" tap, recorded
 * by the server (orders.picked_up_at / delivered_at). Shown in Rider Supervisor
 * and on the admin Order Detail page.
 */

/** "23 min", "1 h 05 min", "<1 min"; "—" when the trip was not recorded. */
export function formatTripDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds < 60) return '<1 min';
  const totalMinutes = Math.round(seconds / 60);
  if (totalMinutes < 60) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours} h ${String(minutes).padStart(2, '0')} min`;
}

/** Clock time of a recorded tap, e.g. "12:41 PM". */
export function formatTripClock(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/**
 * The line under a trip time: both taps as "12:41 PM → 1:04 PM", or whichever
 * one exists so far. Null when the rider has tapped neither.
 */
export function tripTapsLabel(
  pickedUpAt: string | null | undefined,
  deliveredAt: string | null | undefined,
): string | null {
  if (pickedUpAt && deliveredAt) return `${formatTripClock(pickedUpAt)} → ${formatTripClock(deliveredAt)}`;
  if (pickedUpAt) return `Picked up ${formatTripClock(pickedUpAt)}`;
  if (deliveredAt) return `Delivered ${formatTripClock(deliveredAt)}`;
  return null;
}
