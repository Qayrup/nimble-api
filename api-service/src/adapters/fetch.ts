import type { RequestAdapter, AdapterRequestConfig, AdapterResponse } from '../core/types';

export function createFetchAdapter(timeout = 30000): RequestAdapter {
  return {
    async request(config: AdapterRequestConfig): Promise<AdapterResponse> {
      let { url } = config;
      const { method, headers, body } = config;

      const controller = new AbortController();
      let timeoutId: ReturnType<typeof setTimeout> | undefined;

      const effectiveTimeout = config.timeout ?? timeout;
      if (effectiveTimeout > 0) {
        timeoutId = setTimeout(() => controller.abort(), effectiveTimeout);
      }

      if (config.signal) {
        if (config.signal.aborted) {
          controller.abort();
        } else {
          config.signal.addEventListener('abort', () => controller.abort(), { once: true });
        }
      }

      // GET/DELETE: attach body as query string
      if (body && (method === 'GET' || method === 'DELETE')) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
          if (v != null) {
            sp.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
          }
        }
        const qs = sp.toString();
        if (qs) url = url + (url.includes('?') ? '&' : '?') + qs;
      }

      const hasBody = method !== 'GET' && method !== 'DELETE' && body != null;
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: hasBody ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        let data: unknown;
        const responseType = config.responseType ?? 'json';
        if (responseType === 'blob') {
          data = await res.blob();
        } else if (responseType === 'arrayBuffer') {
          data = await res.arrayBuffer();
        } else if (responseType === 'text') {
          data = await res.text();
        } else {
          const contentType = res.headers.get('content-type');
          if (contentType?.includes('application/json')) {
            try {
              data = await res.json();
            } catch {
              throw new Error(`Invalid JSON response from ${url} (status ${res.status})`);
            }
          } else {
            data = await res.text();
          }
        }

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
