/**
 * Reports the handful of user actions the server never sees: a print dialog, a
 * CSV download, a sensitive screen being opened.
 *
 * Three rules govern this file:
 *
 * 1. **It can never break the UI.** Every path is wrapped; a failure is
 *    swallowed. Nothing here is awaited by a component.
 * 2. **It is not a metrics pipeline.** Five instrumentation points, a closed set
 *    of action names, and the server validates both — the point is a usable
 *    audit trail, not telemetry.
 * 3. **The client says WHAT; the server says WHO.** No identity is ever sent
 *    from here; the JWT already carries it.
 */

export type BeaconAction = 'client.print' | 'client.export' | 'client.page-view';

export interface BeaconEvent {
  action: BeaconAction;
  /** Must match the server's closed subject list. */
  subject: string;
  /**
   * Whether a human did this. Defaults to 'user'; pass 'auto' for anything the
   * app initiates on its own (see CustomerInvoiceModal's auto-print).
   */
  trigger?: 'user' | 'auto';
  entity_id?: number;
  label?: string;
  branch_id?: number;
  brand_id?: number;
}

const ENDPOINT = '/admin/activity-logs/events';
const FLUSH_DELAY_MS = 1500;
const MAX_QUEUE = 50;

let queue: BeaconEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

const apiBase = (): string =>
  (import.meta.env.VITE_API_URL as string) || 'http://127.0.0.1:3001/api';

/** Session id: one per tab session. Device id: stable across sessions. */
const readOrCreate = (key: string, storage: Storage): string => {
  try {
    const existing = storage.getItem(key);
    if (existing) return existing;
    const minted =
      typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    storage.setItem(key, minted);
    return minted;
  } catch {
    // Private mode / storage disabled — correlation is a nice-to-have.
    return '';
  }
};

export const sessionId = (): string =>
  typeof sessionStorage === 'undefined'
    ? ''
    : readOrCreate('activity_session_id', sessionStorage);

export const deviceId = (): string =>
  typeof localStorage === 'undefined'
    ? ''
    : readOrCreate('activity_device_id', localStorage);

async function send(events: BeaconEvent[]): Promise<void> {
  if (!events.length) return;
  try {
    const token = localStorage.getItem('auth_token');
    // Only logged-in staff can attribute an event; anonymous prints are not a
    // thing worth guessing about.
    if (!token) return;
    await fetch(`${apiBase()}${ENDPOINT}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
        'X-Session-Id': sessionId(),
        'X-Device-Id': deviceId(),
      },
      body: JSON.stringify({ events }),
      // keepalive, not sendBeacon: sendBeacon cannot set an Authorization
      // header, and this request must be attributable. keepalive survives the
      // page being closed straight after a print or a download.
      keepalive: true,
    });
  } catch {
    // An audit beacon must never surface an error to the person using the till.
  }
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void flushBeacon();
  }, FLUSH_DELAY_MS);
}

/** Queue an event. Returns immediately; never throws. */
export function recordBeacon(event: BeaconEvent): void {
  try {
    if (queue.length >= MAX_QUEUE) return;
    queue.push(event);
    scheduleFlush();
  } catch {
    /* never break a caller */
  }
}

/** Send whatever is queued now (also called on page hide). */
export async function flushBeacon(): Promise<void> {
  const batch = queue;
  queue = [];
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await send(batch);
}

// A print or an export is often the last thing someone does before closing the
// tab, which is exactly the event you do not want to lose.
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void flushBeacon();
  });
}
