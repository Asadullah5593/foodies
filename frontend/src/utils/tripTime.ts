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
