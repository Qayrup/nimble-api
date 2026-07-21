import type { CookieJar } from './types';

interface CookieEntry {
  value: string;
  domain?: string;
  hostOnly?: boolean;
  path?: string;
  expires?: Date;
  maxAge?: number;
  secure?: boolean;
}

function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) return true;
  if (requestPath.startsWith(cookiePath)) {
    if (cookiePath.endsWith('/')) return true;
    return requestPath.charAt(cookiePath.length) === '/';
  }
  return false;
}

export class SimpleCookieJar implements CookieJar {
  #store = new Map<string, CookieEntry[]>();

  getCookieString(url: string): string {
    const now = Date.now();
    const { hostname, pathname, protocol } = new URL(url);
    const result: string[] = [];

    for (const [, entries] of this.#store) {
      for (const entry of entries) {
        if (entry.expires && entry.expires.getTime() <= now) continue;
        if (entry.secure && protocol !== 'https:') continue;
        if (entry.domain) {
          if (entry.hostOnly) {
            if (hostname !== entry.domain) continue;
          } else {
            const d = entry.domain.replace(/^\./, '');
            if (hostname !== d && !hostname.endsWith('.' + d)) continue;
          }
        }
        if (entry.path && !pathMatches(pathname, entry.path)) continue;
        result.push(entry.value);
      }
    }

    return result.join('; ');
  }

  setCookieFromHeaders(url: string, headers: Record<string, string>): void {
    const setCookie = headers['set-cookie'];
    if (!setCookie) return;

    const cookies = Array.isArray(setCookie) ? setCookie : [setCookie];
    const { hostname, pathname } = new URL(url);

    for (const raw of cookies) {
      const entry = this.#parseSetCookie(raw);
      if (!entry) continue;

      if (!entry.domain) {
        entry.domain = hostname;
        entry.hostOnly = true;
      }
      const domain = entry.domain;
      const path = entry.path ?? (pathname.replace(/\/[^/]*$/, '') || '/');
      const key = `${domain}|${path}`;

      // Remove expired immediately
      if (entry.expires && entry.expires.getTime() <= Date.now()) continue;

      let list = this.#store.get(key) ?? [];
      // Replace existing cookie with same name in same domain+path
      const name = raw.split('=')[0];
      list = list.filter(e => !e.value.startsWith(`${name}=`));
      list.push(entry);
      this.#store.set(key, list);
    }
  }

  clear(): void {
    this.#store.clear();
  }

  #parseSetCookie(raw: string): CookieEntry | null {
    const parts = raw.split(';').map(s => s.trim());
    const [nameValue] = parts;
    if (!nameValue || !nameValue.includes('=')) return null;

    const entry: CookieEntry = { value: nameValue };

    for (let i = 1; i < parts.length; i++) {
      const part = parts[i];
      const [attr, ...valParts] = part.split('=');
      const attrLower = attr.toLowerCase();
      const val = valParts.join('=');

      if (attrLower === 'domain') entry.domain = val.replace(/^\./, '');
      else if (attrLower === 'path') entry.path = val || '/';
      else if (attrLower === 'expires') entry.expires = new Date(val);
      else if (attrLower === 'max-age') entry.maxAge = parseInt(val, 10);
      else if (attrLower === 'secure') entry.secure = true;
    }

    // Convert maxAge to expires
    if (entry.maxAge != null && !entry.expires) {
      if (entry.maxAge <= 0) return null; // immediately expired
      entry.expires = new Date(Date.now() + entry.maxAge * 1000);
    }

    return entry;
  }
}
