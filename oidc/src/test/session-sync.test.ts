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
});
