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

      const { url, method, headers, body, timeout, signal, responseType, onUploadProgress } = config;

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
      }

      if (isUpload) {
        requestConfig.filePath = (body as Record<string, unknown>)?.file;
        requestConfig.name = 'file';

        const task = uni.uploadFile(requestConfig);
        if (signal) {
          if (signal.aborted) { task.abort?.(); return Promise.reject(new DOMException('Aborted', 'AbortError')); }
          signal.addEventListener('abort', () => task.abort?.(), { once: true });
        }
        if (onUploadProgress && typeof (task as Record<string, unknown>).onProgressUpdate === 'function') {
          (task as Record<string, Function>).onProgressUpdate((res: { totalBytesSent?: number; totalBytesExpectedToSend?: number }) => {
            onUploadProgress({ loaded: res.totalBytesSent ?? 0, total: res.totalBytesExpectedToSend ?? 0 });
          });
        }
        return new Promise((resolve, reject) => {
          if (typeof task.then === 'function') {
            Promise.resolve(task as unknown as Promise<Record<string, unknown>>)
              .then((res) => {
                resolve({
                  status: (res.statusCode as number) ?? 200,
                  data: typeof res.data === 'string'
                    ? (() => { try { return JSON.parse(res.data); } catch { throw new Error(`Invalid JSON response from upload (status ${res.statusCode})`); } })()
                    : res.data,
                  headers: {},
                });
              })
              .catch((err: Error) => reject(err));
          } else {
            reject(new Error('UniApp uploadFile returned a non-promise task; callback-based API not supported'));
          }
        });
      }

      const task = uni.request(requestConfig);
      if (signal) {
        if (signal.aborted) { task.abort?.(); return Promise.reject(new DOMException('Aborted', 'AbortError')); }
        signal.addEventListener('abort', () => task.abort?.(), { once: true });
      }
      return new Promise((resolve, reject) => {
        if (typeof task.then === 'function') {
          Promise.resolve(task as unknown as Promise<Record<string, unknown>>)
            .then((res) => {
              resolve({
                status: (res.statusCode as number) ?? 200,
                data: res.data,
                headers: (res.header as Record<string, string>) || {},
              });
            })
            .catch((err: Error) => reject(err));
        } else {
          reject(new Error('UniApp request returned a non-promise task; callback-based API not supported'));
        }
      });
    },
  };
}
