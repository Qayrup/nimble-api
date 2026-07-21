export const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export function isRedirect(status: number): boolean {
  return REDIRECT_STATUSES.has(status);
}

export function buildRedirectUrl(location: string, baseUrl: string): string | null {
  if (!location) return null;

  // Absolute URL
  if (location.startsWith('http://') || location.startsWith('https://')) {
    return location;
  }

  // Protocol-relative
  if (location.startsWith('//')) {
    const proto = baseUrl.startsWith('https:') ? 'https:' : 'http:';
    return proto + location;
  }

  // Origin-relative
  const parsed = new URL(baseUrl);
  if (location.startsWith('/')) {
    return `${parsed.protocol}//${parsed.host}${location}`;
  }

  // Path-relative — resolve against the directory of the original URL
  const basePath = parsed.pathname.replace(/\/[^/]*$/, '/');
  const resolved = resolveRelative(`${basePath}${location}`);
  return `${parsed.protocol}//${parsed.host}${resolved}`;
}

function resolveRelative(path: string): string {
  const parts = path.split('/');
  const result: string[] = [];
  for (const part of parts) {
    if (part === '..') result.pop();
    else if (part !== '.' && part !== '') result.push(part);
  }
  return '/' + result.join('/');
}

export function methodAfterRedirect(originalMethod: string, status: number): string {
  // 303: always GET
  if (status === 303) return 'GET';
  // 301/302: POST → GET (fetch spec), other methods preserved
  if ((status === 301 || status === 302) && originalMethod === 'POST') return 'GET';
  // 307/308: preserve original method
  return originalMethod;
}

export function shouldKeepBody(originalMethod: string, status: number): boolean {
  if (status === 303) return false;
  if ((status === 301 || status === 302) && originalMethod === 'POST') return false;
  // 307/308 + preserved methods: keep body
  return true;
}
