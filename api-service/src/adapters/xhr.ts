import type { RequestAdapter, AdapterRequestConfig, AdapterResponse } from '../core/types';
import { ApiError } from '../core/types';

export function createXhrAdapter(timeout = 30000): RequestAdapter {
  return {
    request(config: AdapterRequestConfig): Promise<AdapterResponse> {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        let reqUrl = config.url;
        let reqBody = config.body;
        const isDeleteWithJsonBody = config.method === 'DELETE' && config.deleteBodyMode === 'json';
        const bodyToQs = reqBody && (config.method === 'GET' || config.method === 'HEAD' || config.method === 'OPTIONS' || (config.method === 'DELETE' && config.deleteBodyMode !== 'json')) && !(reqBody instanceof FormData);
        if (bodyToQs) {
          const sp = new URLSearchParams();
          for (const [k, v] of Object.entries(reqBody as Record<string, unknown>)) {
            if (v != null) sp.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
          }
          const qs = sp.toString();
          if (qs) reqUrl = reqUrl + (reqUrl.includes('?') ? '&' : '?') + qs;
          reqBody = undefined;
        } else if (isDeleteWithJsonBody && reqBody != null) {
          reqBody = JSON.stringify(reqBody);
        }

        xhr.open(config.method, reqUrl, true);

        // Headers
        if (config.headers) {
          for (const [k, v] of Object.entries(config.headers)) {
            xhr.setRequestHeader(k, v);
          }
        }

        const effectiveTimeout = config.timeout ?? timeout;
        if (effectiveTimeout > 0) {
          xhr.timeout = effectiveTimeout;
        }

        if (config.responseType === 'arrayBuffer') {
          xhr.responseType = 'arraybuffer';
        } else if (config.responseType === 'blob') {
          xhr.responseType = 'blob';
        }

        // Progress
        if (config.onUploadProgress) {
          xhr.upload.onprogress = (e) => {
            if (e.lengthComputable) {
              config.onUploadProgress!({ loaded: e.loaded, total: e.total });
            }
          };
        }

        if (config.onDownloadProgress) {
          xhr.onprogress = (e) => {
            if (e.lengthComputable) {
              config.onDownloadProgress!({ loaded: e.loaded, total: e.total });
            }
          };
        }

        // AbortSignal
        let onAbort: (() => void) | undefined;
        if (config.signal) {
          onAbort = (): void => {
            xhr.abort();
            reject(new DOMException('The request was aborted', 'AbortError'));
          };
          if (config.signal.aborted) {
            onAbort();
            return;
          }
          config.signal.addEventListener('abort', onAbort, { once: true });
        }

        const cleanupSignal = (): void => {
          if (onAbort && config.signal) {
            config.signal.removeEventListener('abort', onAbort);
          }
        };

        xhr.onload = () => {
          cleanupSignal();
          try {
            let data: unknown;
            const rt = config.responseType ?? 'json';
            if (rt === 'blob' || rt === 'arrayBuffer') {
              data = xhr.response;
            } else if (rt === 'text') {
              data = xhr.responseText;
            } else {
              try {
                data = JSON.parse(xhr.responseText);
              } catch {
                reject(new ApiError(`Invalid JSON response from ${config.method} ${config.url}`, {
                  code: 'ERR_BAD_RESPONSE',
                  status: xhr.status,
                  data: null,
                  request: { url: config.url, method: config.method },
                  response: { status: xhr.status, headers: {} },
                }));
                return;
              }
            }

          const resHeaders: Record<string, string> = {};
          const headerStr = xhr.getAllResponseHeaders();
          for (const line of headerStr.trim().split(/[\r\n]+/)) {
            const idx = line.indexOf(':');
            if (idx > 0) {
              resHeaders[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
            }
          }

          resolve({
            status: xhr.status,
            data,
            headers: resHeaders,
          });
          } catch (err) {
            reject(err);
          }
        };

        xhr.onerror = () => {
          cleanupSignal();
          reject(new ApiError(`XHR network error for ${config.method} ${config.url}`, {
            code: 'ERR_NETWORK',
            status: 0,
            data: null,
            request: { url: config.url, method: config.method },
          }));
        };

        xhr.ontimeout = () => {
          cleanupSignal();
          reject(new ApiError(`XHR timeout for ${config.method} ${config.url}`, {
            code: 'ERR_TIMEOUT',
            status: 0,
            data: null,
            request: { url: config.url, method: config.method },
          }));
        };

        // Body
        if (reqBody != null && config.method !== 'GET' && config.method !== 'DELETE' && config.method !== 'HEAD' && config.method !== 'OPTIONS') {
          if (reqBody instanceof FormData) {
            xhr.send(reqBody);
          } else {
            xhr.send(typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody));
          }
        } else {
          xhr.send();
        }
      });
    },
  };
}
