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
    vi.stubGlobal('location', { href: 'https://app.example.com/' });

    const client = new OidcClient(makeConfig({ refreshTokenMode: 'cookie' }));
    client.importToken('initial-access-token', { expiresIn: 900 });

    await client.silentRefresh();
    await client.logout();

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ credentials: 'include' });
    expect(fetchMock.mock.calls[2]?.[1]).toMatchObject({ credentials: 'include' });
    expect(String((globalThis as { location?: { href?: string } }).location?.href ?? ''))
      .toContain('client_id=test-client');
    client.dispose();
  });

  it('coalesces concurrent login redirects until the page unloads', async () => {
    const values = new Map<string, string>();
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      issuer: 'https://auth.example.com',
      authorization_endpoint: 'https://auth.example.com/authorize',
      token_endpoint: 'https://auth.example.com/token',
      userinfo_endpoint: 'https://auth.example.com/userinfo',
      revocation_endpoint: 'https://auth.example.com/revoke',
    }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('location', { href: 'https://app.example.com' });
    vi.stubGlobal('sessionStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });

    const client = new OidcClient(makeConfig());
    const first = client.login();
    const second = client.login();
    await Promise.all([first, second]);

    expect(first).toBe(second);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(location.href).toMatch(/^https:\/\/auth\.example\.com\/authorize\?/);
    expect(values.has('oidc:state')).toBe(true);
    expect(values.has('oidc:pkce:verifier')).toBe(true);
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
