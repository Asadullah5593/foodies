import { describe, it, expect, vi } from 'vitest';
import { isRetryablePaymentError, recordTenders, KeyedTender } from './recordTenders';

const tender = (orderId: number, method: KeyedTender['method'] = 'card'): KeyedTender => ({
  orderId,
  method,
  amount: 100,
  idempotencyKey: `pos:grp:${orderId}:${method}`,
});
const networkError = () => Object.assign(new Error('Network Error'), { response: undefined });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

describe('isRetryablePaymentError', () => {
  it('retries what may not have landed, never what the server refused', () => {
    expect(isRetryablePaymentError(networkError())).toBe(true);
    expect(isRetryablePaymentError(httpError(502))).toBe(true);
    expect(isRetryablePaymentError(httpError(408))).toBe(true);
    expect(isRetryablePaymentError(httpError(400))).toBe(false);
    expect(isRetryablePaymentError(httpError(404))).toBe(false);
  });
});

describe('recordTenders', () => {
  it('saves every tender when the connection holds', async () => {
    const pay = vi.fn().mockResolvedValue({});
    const out = await recordTenders([tender(1, 'cash'), tender(1, 'card')], pay, [0, 0]);
    expect(out.failed).toEqual([]);
    expect(pay).toHaveBeenCalledTimes(2);
  });

  it('recovers from a dropped request by resending it under the same key', async () => {
    const pay = vi.fn().mockRejectedValueOnce(networkError()).mockResolvedValue({});
    const out = await recordTenders([tender(38184)], pay, [0, 0]);
    expect(out.failed).toEqual([]);
    expect(pay).toHaveBeenCalledTimes(2);
    expect(pay.mock.calls[0][0].idempotencyKey).toBe(pay.mock.calls[1][0].idempotencyKey);
  });

  it('gives back the unsaved tender and everything after it once retries run out', async () => {
    const pay = vi.fn().mockResolvedValueOnce({}).mockRejectedValue(networkError());
    const out = await recordTenders([tender(1), tender(2), tender(3)], pay, [0, 0]);
    expect(out.failed.map((t) => t.orderId)).toEqual([2, 3]);
    // 1 success + 3 attempts at tender 2; tender 3 is not tried on a dead line.
    expect(pay).toHaveBeenCalledTimes(4);
  });

  it('does not retry a tender the server refused', async () => {
    const pay = vi.fn().mockRejectedValue(httpError(400));
    const out = await recordTenders([tender(1)], pay, [0, 0]);
    expect(out.failed).toHaveLength(1);
    expect(pay).toHaveBeenCalledTimes(1);
  });
});
