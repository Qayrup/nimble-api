import type { ProxyConfig, ProxyMode } from './types';

export function resolveProxy(targetUrl: string, option: ProxyMode | ProxyConfig | false): ProxyConfig | null {
  if (option === false) return null;

  if (typeof option === 'object' && 'host' in option) {
    return option;
  }

  // 'env' mode (default) — read HTTP_PROXY / HTTPS_PROXY / NO_PROXY
  const { hostname } = new URL(targetUrl);
  const isHttps = targetUrl.startsWith('https:');

  const proxyEnv = isHttps
    ? process.env.HTTPS_PROXY || process.env.https_proxy || process.env.HTTP_PROXY || process.env.http_proxy
    : process.env.HTTP_PROXY || process.env.http_proxy;

  if (!proxyEnv) return null;

  const noProxy = process.env.NO_PROXY || process.env.no_proxy;
  if (noProxy && noProxy !== '*') {
    if (matchesNoProxy(hostname, noProxy)) return null;
  }
  if (noProxy === '*') return null;

  try {
    const url = new URL(proxyEnv);
    return {
      host: url.hostname,
      port: parseInt(url.port, 10) || (url.protocol === 'https:' ? 443 : 80),
      protocol: url.protocol === 'https:' ? 'https' : 'http',
      auth: url.username
        ? { username: decodeURIComponent(url.username), password: decodeURIComponent(url.password) }
        : undefined,
    };
  } catch {
    return null;
  }
}

export function matchesNoProxy(hostname: string, noProxy: string): boolean {
  const rules = noProxy.split(',').map(s => s.trim()).filter(Boolean);
  return rules.some(rule => {
    if (rule === '*') return true;
    if (rule.startsWith('.')) return hostname.endsWith(rule) || hostname === rule.slice(1);
    if (rule.startsWith('*.')) {
      const suffix = rule.slice(1); // .example.com
      return hostname.endsWith(suffix) || hostname === suffix.slice(1);
    }
    return hostname === rule;
  });
}
