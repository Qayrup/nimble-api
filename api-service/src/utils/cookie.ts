const MAX_CACHED_PATTERNS = 32;
const patternCache = new Map<string, RegExp>();

function getPattern(name: string): RegExp {
  let re = patternCache.get(name);
  if (!re) {
    re = new RegExp(`(?:^|;\\s*)${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*=\\s*([^;]*)`);
    if (patternCache.size >= MAX_CACHED_PATTERNS) {
      const oldest = patternCache.keys().next().value;
      if (oldest !== undefined) patternCache.delete(oldest);
    }
    patternCache.set(name, re);
  }
  return re;
}

export function readCookie(name: string): string | null {
  if (typeof document === 'undefined') return null;
  const match = document.cookie.match(getPattern(name));
  return match ? decodeURIComponent(match[1]) : null;
}
