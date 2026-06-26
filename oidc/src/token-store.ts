import type { TokenSet } from './types';

const STORAGE_KEY = 'oidc:token';

function hasSessionStorage(): boolean {
  try {
    return typeof sessionStorage !== 'undefined';
  } catch {
    return false;
  }
}

export class TokenStore {
  #memory: TokenSet | null = null;

  getToken(): TokenSet | null {
    // L1: memory first
    if (this.#memory) return this.#memory;

    // L2: sessionStorage fallback — restores AccessToken after page refresh.
    // RefreshToken stays in memory only (XSS can't read sessionStorage from injected scripts
    // but can read memory if the attacker gets code execution; sessionStorage is a slight
    // extra barrier for AccessToken which is short-lived anyway).
    if (hasSessionStorage()) {
      try {
        const raw = sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as TokenSet;
          if (parsed.expiresAt && typeof parsed.accessToken === 'string') {
            this.#memory = { ...parsed, refreshToken: undefined };
            return this.#memory;
          }
        }
      } catch {
        sessionStorage.removeItem(STORAGE_KEY);
      }
    }

    return null;
  }

  setToken(token: TokenSet): void {
    this.#memory = token;

    // Persist to sessionStorage — but strip RefreshToken (keep in memory only)
    if (hasSessionStorage()) {
      try {
        const safe: TokenSet = { ...token, refreshToken: undefined };
        sessionStorage.setItem(STORAGE_KEY, JSON.stringify(safe));
      } catch { /* quota exceeded or unavailable, memory-only mode */ }
    }
  }

  clear(): void {
    this.#memory = null;
    if (hasSessionStorage()) {
      try {
        sessionStorage.removeItem(STORAGE_KEY);
      } catch { /* ignore */ }
    }
  }

  isExpired(skewMs = 60_000): boolean {
    const token = this.#memory ?? this.getToken();
    if (!token) return true;
    return Date.now() >= token.expiresAt - skewMs;
  }
}
