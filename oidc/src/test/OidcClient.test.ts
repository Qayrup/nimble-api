import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OidcClient } from '../OidcClient';
import type { OidcConfig } from '../types';

function makeConfig(overrides?: Partial<OidcConfig>): OidcConfig {
  return {
    authority: 'https://auth.example.com',
    clientId: 'test-client',
    redirectUri: 'https://app.example.com/callback',
    postLogoutRedirectUri: 'https://app.example.com',
    ...overrides,
  };
}

describe('OidcClient', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  describe('getAccessToken() / isAuthenticated()', () => {
    it('returns null and false when no token', () => {
      const client = new OidcClient(makeConfig());
      expect(client.getAccessToken()).toBeNull();
      expect(client.isAuthenticated()).toBe(false);
    });
  });

  describe('dispose()', () => {
    it('cleans up without error', () => {
      const client = new OidcClient(makeConfig());
      client.dispose();
      // After dispose, queries still work (no crash)
      expect(client.isAuthenticated()).toBe(false);
    });
  });

  describe('onTokenChanged()', () => {
    it('returns unsubscribe function', () => {
      const client = new OidcClient(makeConfig());
      const handler = vi.fn();
      const unsub = client.onTokenChanged(handler);
      unsub();
      // Handler was never called, and unsubscribe works
      expect(handler).not.toHaveBeenCalled();
    });
  });
});
