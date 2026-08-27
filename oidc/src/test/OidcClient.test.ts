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
    vi.unstubAllGlobals();
  });

  it('includes browser credentials for Cookie refresh and revocation requests', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        issuer: 'https://auth.example.com',
        authorization_endpoint: 'https://auth.example.com/authorize',
        token_endpoint: 'https://auth.example.com/token',
        userinfo_endpoint: 'https://auth.example.com/userinfo',
        revocation_endpoint: 'https://auth.example.com/revoke',
        end_session_endpoint: 'https://auth.example.com/logout',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        access_token: 'refreshed-access-token',
        expires_in: 900,
        token_type: 'Bearer',
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    const client = new OidcClient(makeConfig({ refreshTokenMode: 'cookie' }));
    client.importToken('initial-access-token', { expiresIn: 900 });

    await client.silentRefresh();
    await client.logout();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include' });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ credentials: 'include' });
    client.dispose();
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
