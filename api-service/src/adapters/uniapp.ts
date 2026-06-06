import type { RequestAdapter, AdapterRequestConfig, AdapterResponse } from '../core/types';

type UniRequestFn = (config: Record<string, unknown>) => {
  then?: (...args: unknown[]) => unknown;
  abort?: () => void;
};
type UniUploadFn = (config: Record<string, unknown>) => {
  then?: (...args: unknown[]) => unknown;
  abort?: () => void;
};

type UniAPI = { request: UniRequestFn; uploadFile: UniUploadFn };

let _uniCache: UniAPI | undefined | null;

function getUni(): UniAPI | undefined {
  if (_uniCache) return _uniCache;
  const uni = (globalThis as Record<string, unknown>).uni as UniAPI | undefined;
  if (uni) _uniCache = uni;
  return uni;
}

export function createUniAppAdapter(): RequestAdapter {
  return {
    request(config: AdapterRequestConfig): Promise<AdapterResponse> {
      const uni = getUni();
      if (!uni) throw new Error('UniApp environment not available');

      let { url, method, headers, body, timeout, signal, responseType, onUploadProgress } = config;

      if (body && (method === 'GET' || method === 'DELETE') && !(body instanceof FormData)) {
        const sp = new URLSearchParams();
        for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
          if (v != null) sp.append(k, typeof v === 'object' ? JSON.stringify(v) : String(v));
        }
        const qs = sp.toString();
        if (qs) url = url + (url.includes('?') ? '&' : '?') + qs;
        body = undefined;
      }

      const isUpload = method === 'UPLOAD';
      const requestConfig: Record<string, unknown> = {
        url,
        method: isUpload ? 'POST' : method,
        header: headers,
        data: body,
        timeout,
      };

      if (responseType === 'text') {
        requestConfig.responseType = 'text';
      } else if (responseType === 'arrayBuffer') {
        requestConfig.dataType = 'arraybuffer';
      } else if (responseType === 'blob') {
        requestConfig.responseType = 'blob';
      }

      if (isUpload) {
        requestConfig.filePath = (body as Record<string, unknown>)?.file;
        requestConfig.name = 'file';

        const task = uni.uploadFile(requestConfig);
        let onAbortUpload: (() => void) | undefined;
        if (signal) {
          if (signal.aborted) { task.abort?.(); return Promise.reject(new DOMException('Aborted', 'AbortError')); }
          onAbortUpload = () => task.abort?.();
          signal.addEventListener('abort', onAbortUpload, { once: true });
        }
        if (onUploadProgress && typeof (task as Record<string, unknown>).onProgressUpdate === 'function') {
          (task as Record<string, Function>).onProgressUpdate((res: { totalBytesSent?: number; totalBytesExpectedToSend?: number }) => {
            onUploadProgress({ loaded: res.totalBytesSent ?? 0, total: res.totalBytesExpectedToSend ?? 0 });
          });
        }
        return new Promise((resolve, reject) => {
          const done = (): void => {
            if (onAbortUpload && signal) signal.removeEventListener('abort', onAbortUpload);
          };
          if (typeof task.then === 'function') {
            Promise.resolve(task as unknown as Promise<Record<string, unknown>>)
              .then((res) => {
                done();
                resolve({
                  status: (res.statusCode as number) ?? 200,
                  data: typeof res.data === 'string'
                    ? (() => { try { return JSON.parse(res.data); } catch { throw new Error(`Invalid JSON response from upload (status ${res.statusCode})`); } })()
                    : res.data,
                  headers: {},
                });
              })
              .catch((err: Error) => { done(); reject(err); });
          } else {
            reject(new Error('UniApp uploadFile returned a non-promise task; callback-based API not supported'));
          }
        });
      }

      const task = uni.request(requestConfig);
      let onAbortReq: (() => void) | undefined;
      if (signal) {
        if (signal.aborted) { task.abort?.(); return Promise.reject(new DOMException('Aborted', 'AbortError')); }
        onAbortReq = () => task.abort?.();
        signal.addEventListener('abort', onAbortReq, { once: true });
      }
      return new Promise((resolve, reject) => {
        const done = (): void => {
          if (onAbortReq && signal) signal.removeEventListener('abort', onAbortReq);
        };
        if (typeof task.then === 'function') {
          Promise.resolve(task as unknown as Promise<Record<string, unknown>>)
            .then((res) => {
              done();
              resolve({
                status: (res.statusCode as number) ?? 200,
                data: res.data,
                headers: (res.header as Record<string, string>) || {},
              });
            })
            .catch((err: Error) => { done(); reject(err); });
        } else {
          reject(new Error('UniApp request returned a non-promise task; callback-based API not supported'));
        }
      });
    },
  };
}
