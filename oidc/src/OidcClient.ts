import type { OidcConfig, TokenSet, OidcMetadata, ImportTokenOptions } from './types';
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

function backoffDelay(attempt: number, base: number, max: number): number {
  const delay = Math.min(base * Math.pow(2, attempt - 1), max);
  return delay + Math.random() * 200;
}

export class OidcClient {
  #config: OidcConfig;
  #store = new TokenStore();
  #sync: SessionSync;
  #metadata: OidcMetadata | null = null;
  #metadataFetchedAt = 0;
  #refreshTimer: ReturnType<typeof setTimeout> | undefined;
  #refreshPromise: Promise<TokenSet | null> | null = null;
  #refreshFailCount = 0;
  #tokenChangeListeners = new Set<(evt: { token: TokenSet | null; source: string }) => void>();

  // 模式适配 — 惰性绑定，运行时零分支
  #canRefresh: (token: TokenSet | null) => boolean;
  #buildRefreshBody: (token: TokenSet) => URLSearchParams;
  #buildRevokeBody: (token: TokenSet) => URLSearchParams;
  #stripRefreshToken: (token: TokenSet) => TokenSet;
  #shouldAttemptRevoke: (token: TokenSet | null) => boolean;
  #protocolCredentials: RequestCredentials | undefined;

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

    // 根据 refreshTokenMode 惰性绑定模式方法
    const mode = this.#config.refreshTokenMode ?? 'body';
    if (mode === 'cookie') {
      this.#protocolCredentials = 'include';
      this.#canRefresh = (t) => t !== null;
      this.#buildRefreshBody = () => new URLSearchParams({
        grant_type: 'refresh_token',
        client_id: this.#config.clientId,
      });
      this.#buildRevokeBody = () => new URLSearchParams({
        token_type_hint: 'refresh_token',
        client_id: this.#config.clientId,
      });
      this.#stripRefreshToken = (t) => ({ ...t, refreshToken: undefined });
      this.#shouldAttemptRevoke = (t) => t !== null;
    } else {
      this.#protocolCredentials = undefined;
      this.#canRefresh = (t) => !!t?.refreshToken;
      this.#buildRefreshBody = (t) => new URLSearchParams({
        grant_type: 'refresh_token',
        refresh_token: t.refreshToken!,
        client_id: this.#config.clientId,
      });
      this.#buildRevokeBody = (t) => new URLSearchParams({
        token: t.refreshToken!,
        token_type_hint: 'refresh_token',
        client_id: this.#config.clientId,
      });
      this.#stripRefreshToken = (t) => t;
      this.#shouldAttemptRevoke = (t) => !!t?.refreshToken;
    }
  }

  // === Lifecycle ===

  async login(): Promise<void> {
    this.#config.onBeforeLogin?.();

    const metadata = await this.#getMetadata();
    const pkce = await generatePkcePair();
    const state = randomState();

    if (!hasSessionStorage()) {
      throw new OidcUnavailableError('sessionStorage');
    }
    sessionStorage.setItem(`${SESSION_PREFIX}pkce:verifier`, pkce.codeVerifier);
    sessionStorage.setItem(`${SESSION_PREFIX}state`, state);

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
    if (!hasSessionStorage()) {
      throw new OidcUnavailableError('sessionStorage');
    }

    const expectedState = sessionStorage.getItem(`${SESSION_PREFIX}state`);
    if (urlParams.get('state') !== expectedState) {
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
    const codeVerifier = sessionStorage.getItem(`${SESSION_PREFIX}pkce:verifier`)!;
    body.set('code_verifier', codeVerifier);

    const raw = await this.#exchangeToken(metadata.token_endpoint, body);
    const token = this.#stripRefreshToken(raw);
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
    if (!this.#canRefresh(token)) return null;

    this.#refreshPromise = this.#doSilentRefresh(token!);
    try {
      return await this.#refreshPromise;
    } finally {
      this.#refreshPromise = null;
    }
  }

  async #doSilentRefresh(token: TokenSet): Promise<TokenSet | null> {
    try {
      const metadata = await this.#getMetadata();
      const body = this.#buildRefreshBody(token);

      const newToken = await this.#exchangeToken(metadata.token_endpoint, body);
      if (!newToken.refreshToken) {
        newToken.refreshToken = token.refreshToken;
      }
      const stored = this.#stripRefreshToken(newToken);
      this.#store.setToken(stored);
      this.#sync.broadcast(stored, 'silent-refresh');
      this.#refreshFailCount = 0;
      this.#scheduleAutoRefresh();
      this.#emitTokenChanged(stored, 'silent-refresh');
      return stored;
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

    if (this.#shouldAttemptRevoke(token)) {
      try {
        const metadata = await this.#getMetadata();
        if (metadata.revocation_endpoint) {
          await fetch(metadata.revocation_endpoint, {
            method: 'POST',
            credentials: this.#protocolCredentials,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: this.#buildRevokeBody(token!),
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

  /** 从外部 access token 导入会话（如模拟登录），并触发 onTokenChanged */
  importToken(accessToken: string, options?: ImportTokenOptions): void {
    const token: TokenSet = {
      accessToken,
      refreshToken: options?.refreshToken,
      expiresAt: options?.expiresIn ? Date.now() + options.expiresIn * 1000 : Date.now() + 3600_000,
      tokenType: 'Bearer',
    };
    this.#store.setToken(token);
    this.#sync.broadcast(token, (options?.source ?? 'login') as 'login' | 'silent-refresh' | 'logout' | 'expired');
    this.#scheduleAutoRefresh();
    this.#emitTokenChanged(token, options?.source ?? 'login');
  }

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
      credentials: this.#protocolCredentials,
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
    if (this.#metadata && Date.now() - this.#metadataFetchedAt < 30 * 60_000) {
      return this.#metadata;
    }

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
    this.#metadataFetchedAt = Date.now();
    return this.#metadata;
  }

  #scheduleAutoRefresh(): void {
    this.#clearAutoRefresh();
    const token = this.#store.getToken();
    if (!token) return;

    let refreshIn = token.expiresAt - Date.now() - 60_000; // 1 min before expiry
    if (refreshIn <= 0) refreshIn = 5_000; // expired or about to → refresh soon

    this.#refreshTimer = setTimeout(() => {
      this.#onAutoRefreshTick();
    }, refreshIn);
  }

  #clearAutoRefresh(): void {
    if (this.#refreshTimer !== undefined) {
      clearTimeout(this.#refreshTimer);
      this.#refreshTimer = undefined;
    }
  }

  async #onAutoRefreshTick(): Promise<void> {
    try {
      await this.silentRefresh();
    } catch (err) {
      if (err instanceof OidcTokenError && err.code === 'invalid_grant') {
        return;
      }
      this.#refreshFailCount++;
      if (this.#refreshFailCount >= 3) {
        this.#emitTokenChanged(this.#store.getToken(), 'refresh-stale');
      }
      const delay = backoffDelay(this.#refreshFailCount, 30_000, 120_000);
      this.#refreshTimer = setTimeout(() => this.#onAutoRefreshTick(), delay);
    }
  }

  #emitTokenChanged(token: TokenSet | null, source: string): void {
    for (const cb of this.#tokenChangeListeners) {
      try { cb({ token, source }); } catch { /* listener errors are silent */ }
    }
  }
}
