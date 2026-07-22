import type { OidcConfig, TokenSet, OidcMetadata } from './types';
import { TokenStore } from './token-store';
import { SessionSync } from './session-sync';
import { generatePkcePair } from './pkce';
import { OidcStateError, OidcTokenError, OidcUnavailableError } from './errors';

function randomState(): string {
  const arr = new Uint8Array(32);
  crypto.getRandomValues(arr);
  return Array.from(arr, (b) => b.toString(16).padStart(2, '0')).join('');
}

function hasLocation(): boolean {
  try {
    return typeof location !== 'undefined' && typeof location.href === 'string';
  } catch {
    return false;
  }
}

function hasSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== 'undefined';
  } catch {
    return false;
  }
}

const SESSION_PREFIX = 'oidc:';

export class OidcClient {
  #config: OidcConfig;
  #store = new TokenStore();
  #sync: SessionSync;
  #metadata: OidcMetadata | null = null;
  #refreshTimer: ReturnType<typeof setTimeout> | undefined;
  #refreshPromise: Promise<TokenSet | null> | null = null;
  #tokenChangeListeners = new Set<(evt: { token: TokenSet | null; source: string }) => void>();

  constructor(config: OidcConfig) {
    this.#config = { scopes: ['openid', 'profile', 'offline_access'], ...config };
    this.#sync = new SessionSync(config.clientId);

    // Sync from other tabs
    this.#sync.onUpdate((token, source) => {
      if (token) this.#store.setToken(token);
      else this.#store.clear();
      this.#scheduleAutoRefresh();
      this.#emitTokenChanged(token, source);
    });

    this.#sync.onProbe(() => {
      const token = this.#store.getToken();
      if (token) {
        this.#sync.broadcast(token, 'login');
      }
    });
  }

  // === Lifecycle ===

  async login(): Promise<void> {
    this.#config.onBeforeLogin?.();

    const metadata = await this.#getMetadata();
    const pkce = await generatePkcePair();
    const state = randomState();

    if (hasSessionStorage()) {
      sessionStorage.setItem(`${SESSION_PREFIX}pkce:verifier`, pkce.codeVerifier);
      sessionStorage.setItem(`${SESSION_PREFIX}state`, state);
    }

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.#config.clientId,
      redirect_uri: this.#config.redirectUri,
      code_challenge: pkce.codeChallenge,
      code_challenge_method: 'S256',
      state,
      scope: (this.#config.scopes ?? ['openid', 'profile', 'offline_access']).join(' '),
    });

    if (!hasLocation()) {
      throw new OidcUnavailableError('window.location');
    }
    location.href = `${metadata.authorization_endpoint}?${params.toString()}`;
  }

  async handleCallback(urlParams: URLSearchParams): Promise<void> {
    const expectedState = hasSessionStorage()
      ? sessionStorage.getItem(`${SESSION_PREFIX}state`)
      : null;
    const codeVerifier = hasSessionStorage()
      ? sessionStorage.getItem(`${SESSION_PREFIX}pkce:verifier`)
      : null;

    if (expectedState !== null && urlParams.get('state') !== expectedState) {
      throw new OidcStateError();
    }

    const code = urlParams.get('code');
    if (!code) {
      const err = urlParams.get('error');
      throw new OidcTokenError(err ?? 'No authorization code returned');
    }

    const metadata = await this.#getMetadata();
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: this.#config.redirectUri,
      client_id: this.#config.clientId,
    });
    if (codeVerifier) body.set('code_verifier', codeVerifier);

    const token = await this.#exchangeToken(metadata.token_endpoint, body);
    this.#store.setToken(token);
    this.#sync.broadcast(token, 'login');
    this.#scheduleAutoRefresh();
    this.#emitTokenChanged(token, 'login');

    // Cleanup sessionStorage
    if (hasSessionStorage()) {
      sessionStorage.removeItem(`${SESSION_PREFIX}pkce:verifier`);
      sessionStorage.removeItem(`${SESSION_PREFIX}state`);
    }
  }

  async silentRefresh(): Promise<TokenSet | null> {
    if (this.#refreshPromise) return this.#refreshPromise;

    const token = this.#store.getToken();
    if (!token?.refreshToken) return null;

    this.#refreshPromise = this.#doSilentRefresh(token);
    try {
      return await this.#refreshPromise;
    } finally {
      this.#refreshPromise = null;
    }
  }

  async #doSilentRefresh(token: TokenSet): Promise<TokenSet | null> {
    try {
      const metadata = await this.#getMetadata();
      const body = new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: token.refreshToken!,
        client_id: this.#config.clientId,
      });

      const newToken = await this.#exchangeToken(metadata.token_endpoint, body);
      if (!newToken.refreshToken) {
        newToken.refreshToken = token.refreshToken;
      }
      this.#store.setToken(newToken);
      this.#sync.broadcast(newToken, 'silent-refresh');
      this.#scheduleAutoRefresh();
      this.#emitTokenChanged(newToken, 'silent-refresh');
      return newToken;
    } catch (err) {
      if (err instanceof OidcTokenError && err.code === 'invalid_grant') {
        this.#store.clear();
        this.#sync.broadcast(null, 'expired');
        this.#emitTokenChanged(null, 'expired');
      }
      throw err;
    }
  }

  async logout(): Promise<void> {
    const token = this.#store.getToken();

    // Revoke refresh_token if possible
    if (token?.refreshToken) {
      try {
        const metadata = await this.#getMetadata();
        if (metadata.revocation_endpoint) {
          await fetch(metadata.revocation_endpoint, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({
              token: token.refreshToken,
              token_type_hint: 'refresh_token',
              client_id: this.#config.clientId,
            }),
          });
        }
      } catch { /* best-effort revocation */ }
    }

    this.#store.clear();
    this.#sync.broadcast(null, 'logout');
    this.#emitTokenChanged(null, 'logout');
    this.#clearAutoRefresh();

    if (hasLocation()) {
      const metadata = await this.#getMetadata().catch(() => null);
      const logoutUrl = metadata?.end_session_endpoint
        ? `${metadata.end_session_endpoint}?post_logout_redirect_uri=${encodeURIComponent(this.#config.postLogoutRedirectUri)}`
        : this.#config.postLogoutRedirectUri;
      location.href = logoutUrl;
    }
  }

  dispose(): void {
    this.#clearAutoRefresh();
    this.#sync.dispose();
    this.#tokenChangeListeners.clear();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  // === Queries ===

  getAccessToken(): string | null {
    const token = this.#store.getToken();
    if (!token || this.#store.isExpired()) return null;
    return token.accessToken;
  }

  isAuthenticated(): boolean {
    const token = this.#store.getToken();
    return token !== null && !this.#store.isExpired();
  }

  async waitForInitialSync(): Promise<void> {
    await this.#sync.waitForSync(300);
  }

  // === Events ===

  onTokenChanged(cb: (evt: { token: TokenSet | null; source: string }) => void): () => void {
    this.#tokenChangeListeners.add(cb);
    return () => { this.#tokenChangeListeners.delete(cb); };
  }

  // === Internal ===

  async #exchangeToken(endpoint: string, body: URLSearchParams): Promise<TokenSet> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    });

    if (!res.ok) {
      let errorCode: string | undefined;
      try {
        const err = await res.json() as Record<string, unknown>;
        errorCode = err.error as string | undefined;
      } catch { /* ignore parse errors */ }
      throw new OidcTokenError(
        `Token endpoint returned ${res.status}`,
        errorCode,
      );
    }

    const text = await res.text();
    if (!text) {
      throw new OidcTokenError(`Token endpoint returned empty body (HTTP ${res.status})`);
    }
    let data: Record<string, unknown>;
    try {
      data = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new OidcTokenError(`Invalid JSON response from token endpoint (HTTP ${res.status})`);
    }
    return {
      accessToken: data.access_token as string,
      refreshToken: data.refresh_token as string | undefined,
      expiresAt: Date.now() + ((data.expires_in as number) ?? 3600) * 1000,
      idToken: data.id_token as string | undefined,
      tokenType: (data.token_type as string) ?? 'Bearer',
      scope: data.scope as string | undefined,
    };
  }

  async #getMetadata(): Promise<OidcMetadata> {
    if (this.#metadata) return this.#metadata;

    const res = await fetch(
      `${this.#config.authority}/.well-known/openid-configuration`,
    );
    if (!res.ok) {
      throw new OidcTokenError(
        `Failed to fetch OIDC discovery document: ${res.status}`,
      );
    }

    const text = await res.text();
    if (!text) {
      throw new OidcTokenError(`OIDC discovery document returned empty body (HTTP ${res.status})`);
    }
    let parsed: OidcMetadata;
    try {
      parsed = JSON.parse(text) as OidcMetadata;
    } catch {
      throw new OidcTokenError(`Invalid JSON in OIDC discovery document (HTTP ${res.status})`);
    }
    this.#metadata = parsed;
    return this.#metadata;
  }

  #scheduleAutoRefresh(): void {
    this.#clearAutoRefresh();
    const token = this.#store.getToken();
    if (!token) return;

    const refreshIn = token.expiresAt - Date.now() - 60_000; // 1 min before expiry
    if (refreshIn <= 0) return;

    this.#refreshTimer = setTimeout(() => {
      this.silentRefresh().catch(() => { /* background refresh failures are silent */ });
    }, refreshIn);
  }

  #clearAutoRefresh(): void {
    if (this.#refreshTimer !== undefined) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = undefined;
    }
  }

  #emitTokenChanged(token: TokenSet | null, source: string): void {
    for (const cb of this.#tokenChangeListeners) {
      try { cb({ token, source }); } catch { /* listener errors are silent */ }
    }
  }
}
