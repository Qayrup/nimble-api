import type { RequestAdapter, AdapterRequestConfig, AdapterResponse } from '../core/types';
import { ApiError } from '../core/types';
import { bodyToQueryString } from '../utils/body-to-qs';

export function createFetchAdapter(timeout = 30000): RequestAdapter {
  return {
    async request(config: AdapterRequestConfig): Promise<AdapterResponse> {
      let { url } = config;
      const { method, headers } = config;
      let { body } = config;

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

      // GET/HEAD/OPTIONS: attach body as query string always
      // DELETE: convert to query string only when deleteBodyMode is 'query' (default); 'json' sends as body
      const isDeleteWithJsonBody = method === 'DELETE' && config.deleteBodyMode === 'json';
      const bodyToQs = body && (method === 'GET' || method === 'HEAD' || method === 'OPTIONS' || (method === 'DELETE' && config.deleteBodyMode !== 'json')) && !(body instanceof FormData);
      if (bodyToQs) {
        const qs = bodyToQueryString(body);
        if (qs) url = url + (url.includes('?') ? '&' : '?') + qs;
        body = undefined;
      }

      const hasBody = (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS' && body != null) ||
        (isDeleteWithJsonBody && body != null);
      const isFormData = body instanceof FormData;
      try {
        const res = await fetch(url, {
          method,
          headers,
          body: hasBody
            ? (isFormData ? (body as FormData) : typeof body === 'string' ? body : JSON.stringify(body))
            : undefined,
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
          const text = await res.text();
          // 204 No Content / 304 Not Modified 按 HTTP 规范不得有响应体
          if (!text || res.status === 204 || res.status === 304) {
            data = null;
          } else {
            try {
              data = JSON.parse(text);
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
