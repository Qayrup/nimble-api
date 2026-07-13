import { describe, it, expect, vi } from 'vitest';
import { SessionSync } from '../session-sync';
import type { TokenSet } from '../types';

function makeToken(expiresAt?: number): TokenSet {
  return {
    accessToken: 'access-abc',
    refreshToken: 'refresh-abc',
    expiresAt: expiresAt ?? Date.now() + 600_000,
    tokenType: 'Bearer',
  };
}

describe('SessionSync', () => {
  it('receives broadcast from a different instance (simulated cross-tab)', async () => {
    const handler = vi.fn();
    // Tab A: listen
    const tabA = new SessionSync('test-cross-tab');
    tabA.onUpdate(handler);

    // Tab B: send
    const tabB = new SessionSync('test-cross-tab');
    const token = makeToken();
    tabB.broadcast(token, 'login');

    // Allow microtasks to process
    await new Promise((r) => setTimeout(r, 20));

    expect(handler).toHaveBeenCalledWith(token, 'login');

    tabA.close();
    tabB.close();
  });

  it('unsubscribed handler is not called', async () => {
    const handler = vi.fn();
    const tabA = new SessionSync('test-unsub');
    const unsub = tabA.onUpdate(handler);
    unsub();

    const tabB = new SessionSync('test-unsub');
    tabB.broadcast(makeToken(), 'login');

    await new Promise((r) => setTimeout(r, 20));

    expect(handler).not.toHaveBeenCalled();

    tabA.close();
    tabB.close();
  });

  it('calls probe handler when receiving token_probe', async () => {
    const probeHandler = vi.fn();
    const tabA = new SessionSync('test-probe');
    tabA.onProbe(probeHandler);

    const tabB = new SessionSync('test-probe');
    tabB.sendProbe();

    await new Promise((r) => setTimeout(r, 20));

    expect(probeHandler).toHaveBeenCalled();

    tabA.close();
    tabB.close();
  });

  it('waitForSync resolves after receiving token_sync', async () => {
    const tabA = new SessionSync('test-wait');
    const tabB = new SessionSync('test-wait');

    const token = makeToken();
    let resolved = false;
    const syncPromise = tabA.waitForSync(300).then(() => { resolved = true; });

    // Tab B broadcasts token after a short delay (simulating probe response)
    await new Promise((r) => setTimeout(r, 10));
    tabB.broadcast(token, 'login');

    await syncPromise;
    expect(resolved).toBe(true);

    tabA.close();
    tabB.close();
  });

  it('waitForSync resolves after timeout if no broadcast', async () => {
    const tab = new SessionSync('test-timeout');

    const start = Date.now();
    await tab.waitForSync(100);
    const elapsed = Date.now() - start;

    // Should have waited approximately the timeout period
    expect(elapsed).toBeGreaterThanOrEqual(80);

    tab.close();
  });

  it('probe handler unsubscription works', async () => {
    const handler = vi.fn();
    const tabA = new SessionSync('test-probe-unsub');
    const unsub = tabA.onProbe(handler);
    unsub();

    const tabB = new SessionSync('test-probe-unsub');
    tabB.sendProbe();

    await new Promise((r) => setTimeout(r, 20));

    expect(handler).not.toHaveBeenCalled();

    tabA.close();
    tabB.close();
  });
});
