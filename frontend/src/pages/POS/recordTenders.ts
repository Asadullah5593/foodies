import type { AllocatedTender } from './allocateTenders';

export interface KeyedTender extends AllocatedTender {
  /** Same key on every attempt, so the server records the tender once. */
  idempotencyKey: string;
}

/**
 * A dropped connection, a timeout or a server error — the request may or may
 * not have landed, and sending it again under the same key is safe. A 4xx is
 * the server refusing the tender; repeating it cannot change the answer.
 */
export function isRetryablePaymentError(error: unknown): boolean {
  const status = (error as { response?: { status?: number } })?.response?.status;
  return status == null || status >= 500 || status === 408 || status === 429;
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Records a checkout's tenders after the order exists, retrying transient
 * failures. The order and its payment are two separate requests, so a network
 * blip between them used to leave a real order with no payment. Every tender
 * carries an idempotency key: a retry of a request that did land returns the
 * payment already recorded instead of adding a second one.
 *
 * Stops at the first tender that still fails and returns it with the rest, so
 * the cashier can retry exactly what is missing. Empty `failed` = all saved.
 */
export async function recordTenders(
  tenders: KeyedTender[],
  pay: (tender: KeyedTender) => Promise<unknown>,
  retryDelaysMs: number[] = [700, 2000],
): Promise<{ failed: KeyedTender[]; error: unknown }> {
  for (let i = 0; i < tenders.length; i++) {
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= retryDelaysMs.length; attempt++) {
      if (attempt > 0) await wait(retryDelaysMs[attempt - 1]);
      try {
        await pay(tenders[i]);
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        if (!isRetryablePaymentError(error)) break;
      }
    }
    if (lastError) return { failed: tenders.slice(i), error: lastError };
  }
  return { failed: [], error: null };
}
