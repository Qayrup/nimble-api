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
  if (_uniCache !== undefined) return _uniCache ?? undefined;
  const uni = (globalThis as Record<string, unknown>).uni as UniAPI | undefined;
  _uniCache = uni ?? null;
  return uni;
}

export function createUniAppAdapter(): RequestAdapter {
  return {
    request(config: AdapterRequestConfig): Promise<AdapterResponse> {
      const uni = getUni();
      if (!uni) throw new Error('UniApp environment not available');

      const { url, method, headers, body } = config;

      const isUpload = method === 'UPLOAD';
      const requestConfig: Record<string, unknown> = {
        url,
        method: isUpload ? 'POST' : method,
        header: headers,
        data: body,
      };

      if (isUpload) {
        requestConfig.filePath = (body as Record<string, unknown>)?.file;
        requestConfig.name = 'file';

        const task = uni.uploadFile(requestConfig);
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
