import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { flushBeacon, recordBeacon } from './activityBeacon';

const fetchMock = vi.fn();

beforeEach(() => {
  vi.useFakeTimers();
  fetchMock.mockReset().mockResolvedValue({ ok: true });
  vi.stubGlobal('fetch', fetchMock);
  localStorage.clear();
  sessionStorage.clear();
  localStorage.setItem('auth_token', 'tok-123');
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const sentBodies = () =>
  fetchMock.mock.calls.map(
    (c) => JSON.parse((c[1] as { body: string }).body) as { events: unknown[] }
  );

describe('activity beacon', () => {
  it('batches events instead of one request per action', async () => {
    recordBeacon({ action: 'client.print', subject: 'invoice' });
    recordBeacon({ action: 'client.print', subject: 'kot' });
    recordBeacon({ action: 'client.export', subject: 'inventory-ledger' });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(sentBodies()[0].events).toHaveLength(3);
  });

  it('sends the auth header, because a print must be attributable', async () => {
    recordBeacon({ action: 'client.print', subject: 'invoice' });
    await vi.advanceTimersByTimeAsync(2000);
    const init = fetchMock.mock.calls[0][1] as {
      headers: Record<string, string>;
      keepalive: boolean;
    };
    expect(init.headers.Authorization).toBe('Bearer tok-123');
    // keepalive rather than sendBeacon: sendBeacon cannot set Authorization,
    // and an unattributable print row is worthless.
    expect(init.keepalive).toBe(true);
  });

  it('never sends identity from the client', async () => {
    recordBeacon({ action: 'client.print', subject: 'invoice', label: 'Inv 9' });
    await vi.advanceTimersByTimeAsync(2000);
    const body = JSON.stringify(sentBodies()[0]);
    expect(body).not.toMatch(/user_id|actor|tenant_id|role/i);
  });

  it('says nothing at all when nobody is logged in', async () => {
    localStorage.removeItem('auth_token');
    recordBeacon({ action: 'client.print', subject: 'invoice' });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a network failure rather than surfacing it at the till', async () => {
    fetchMock.mockRejectedValue(new Error('offline'));
    recordBeacon({ action: 'client.print', subject: 'invoice' });
    await expect(vi.advanceTimersByTimeAsync(2000)).resolves.not.toThrow();
  });

  it('bounds the queue so a loop cannot grow it without limit', async () => {
    for (let i = 0; i < 500; i++) {
      recordBeacon({ action: 'client.print', subject: 'invoice' });
    }
    await vi.advanceTimersByTimeAsync(2000);
    expect(sentBodies()[0].events.length).toBeLessThanOrEqual(50);
  });

  it('carries the trigger, so an automatic print is not read as a human one', async () => {
    recordBeacon({ action: 'client.print', subject: 'invoice', trigger: 'auto' });
    recordBeacon({ action: 'client.print', subject: 'order', trigger: 'user' });
    await vi.advanceTimersByTimeAsync(2000);
    const events = sentBodies()[0].events as Array<{ trigger: string }>;
    expect(events[0].trigger).toBe('auto');
    expect(events[1].trigger).toBe('user');
  });

  it('flushes on demand without waiting for the timer', async () => {
    recordBeacon({ action: 'client.export', subject: 'product-sales' });
    await flushBeacon();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
