import type { RequestAdapter, AdapterRequestConfig, AdapterResponse } from '../core/types';

export function createFetchAdapter(timeout = 30000): RequestAdapter {
  return {
    async request(config: AdapterRequestConfig): Promise<AdapterResponse> {
      let { url } = config;
      const { method, headers, body } = config;

      const controller = new AbortController();
      const signal = config.signal ?? controller.signal;
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      if (timeout > 0) {
        timeoutId = setTimeout(() => controller.abort(), timeout);
      }

      // GET/DELETE: attach body as query string
      if (body && (method === 'GET' || method === 'DELETE')) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
          sp.append(k, String(v));
        }
        const qs = sp.toString();
        url = url + (url.includes('?') ? '&' : '?') + qs;
      }

      try {
        const res = await fetch(url, {
          method,
          headers: { 'Content-Type': 'application/json', ...headers },
          body: method !== 'GET' && method !== 'DELETE' ? JSON.stringify(body) : undefined,
          signal,
        });

        const data = await res.json();
        const resHeaders: Record<string, string> = {};
        res.headers.forEach((val, key) => {
          resHeaders[key] = val;
        });

        return { status: res.status, data, headers: resHeaders };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
      }
    },
  };
}
