import type { RequestAdapter, AdapterRequestConfig, AdapterResponse } from '../core/types';
import { ApiError } from '../core/types';

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

      let abortHandler: (() => void) | undefined;
      if (config.signal) {
        if (config.signal.aborted) {
          controller.abort();
        } else {
          abortHandler = () => controller.abort();
          config.signal.addEventListener('abort', abortHandler, { once: true });
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
      const isFormData = body instanceof FormData;
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: hasBody ? (isFormData ? (body as FormData) : JSON.stringify(body)) : undefined,
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
          try {
            data = await res.json();
          } catch {
            throw new ApiError(`Invalid JSON response from ${url}`, {
              code: 'ERR_BAD_RESPONSE',
              status: res.status,
              data: null,
              request: { url, method: config.method },
              response: { status: res.status, headers: {} },
            });
          }
        }

        const resHeaders: Record<string, string> = {};
        res.headers.forEach((val, key) => {
          resHeaders[key.toLowerCase()] = val;
        });

        return { status: res.status, data, headers: resHeaders };
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (abortHandler && config.signal) {
          config.signal.removeEventListener('abort', abortHandler);
        }
      }
    },
  };
}
