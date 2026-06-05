import type { RequestAdapter, AdapterRequestConfig, AdapterResponse } from '../core/types';
import { ApiError } from '../core/types';

export function createXhrAdapter(timeout = 30000): RequestAdapter {
  return {
    request(config: AdapterRequestConfig): Promise<AdapterResponse> {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open(config.method, config.url, true);

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
        if (config.signal) {
          const onAbort = (): void => {
            xhr.abort();
            reject(new DOMException('The request was aborted', 'AbortError'));
          };
          if (config.signal.aborted) {
            onAbort();
            return;
          }
          config.signal.addEventListener('abort', onAbort, { once: true });
        }

        xhr.onload = () => {
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
              throw new ApiError(`Invalid JSON response from ${config.method} ${config.url}`, {
                code: 'ERR_BAD_RESPONSE',
                status: xhr.status,
                data: null,
                request: { url: config.url, method: config.method },
                response: { status: xhr.status, headers: {} },
              });
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
        };

        xhr.onerror = () => {
          reject(new Error(`[@nimble-api/api-service] XHR network error for ${config.method} ${config.url}`));
        };

        xhr.ontimeout = () => {
          reject(new Error(`[@nimble-api/api-service] XHR timeout for ${config.method} ${config.url}`));
        };

        // Body
        if (config.body != null && config.method !== 'GET' && config.method !== 'DELETE') {
          if (config.body instanceof FormData) {
            xhr.send(config.body);
          } else {
            xhr.send(typeof config.body === 'string' ? config.body : JSON.stringify(config.body));
          }
        } else {
          xhr.send();
        }
      });
    },
  };
}
