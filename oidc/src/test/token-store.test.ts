import { describe, it, expect, beforeEach, vi } from 'vitest';
import { TokenStore } from '../token-store';
import type { TokenSet } from '../types';

function makeToken(expiresAt?: number): TokenSet {
  return {
    accessToken: 'access-xyz',
    refreshToken: 'refresh-xyz',
    expiresAt: expiresAt ?? Date.now() + 600_000,
    tokenType: 'Bearer',
  };
}

describe('TokenStore', () => {
  let store: TokenStore;

  beforeEach(() => {
    store = new TokenStore();
    vi.restoreAllMocks();
  });

  it('stores and retrieves token', () => {
    const token = makeToken();
    store.setToken(token);
    expect(store.getToken()).toEqual(token);
  });

  it('returns null when no token', () => {
    expect(store.getToken()).toBeNull();
  });

  it('clear() removes token', () => {
    store.setToken(makeToken());
    store.clear();
    expect(store.getToken()).toBeNull();
  });

  it('isExpired() returns true for expired token', () => {
    store.setToken(makeToken(Date.now() - 1000));
    expect(store.isExpired(0)).toBe(true);
  });

  it('isExpired() returns false for fresh token', () => {
    store.setToken(makeToken(Date.now() + 600_000));
    expect(store.isExpired(0)).toBe(false);
  });

  it('isExpired() applies skew', () => {
    // expires in 30s, skew is 60s → treats as expired
    store.setToken(makeToken(Date.now() + 30_000));
    expect(store.isExpired(60_000)).toBe(true);
  });
});
