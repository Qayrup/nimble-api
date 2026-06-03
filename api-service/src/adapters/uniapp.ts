import type { RequestAdapter, AdapterRequestConfig, AdapterResponse } from '../core/types';

type UniRequestFn = (config: Record<string, unknown>) => {
  then?: (...args: unknown[]) => unknown;
  abort?: () => void;
};
type UniUploadFn = (config: Record<string, unknown>) => {
  then?: (...args: unknown[]) => unknown;
  abort?: () => void;
};

function getUni(): { request: UniRequestFn; uploadFile: UniUploadFn } | undefined {
  const cache = (getUni as { _cache?: ReturnType<typeof getUni> })._cache;
  if (cache !== undefined) return cache;
  const uni = (globalThis as Record<string, unknown>).uni as
    | { request: UniRequestFn; uploadFile: UniUploadFn }
    | undefined;
  (getUni as { _cache?: ReturnType<typeof getUni> })._cache = uni;
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
        header: { 'Content-Type': 'application/json', ...headers },
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
                  status: (res.statusCode as number) || 200,
                  data: (res.data as string) ? JSON.parse(res.data as string) : res,
                  headers: {},
                });
              })
              .catch((err: Error) => reject(err));
          }
        });
      }

      if (method === 'GET' || method === 'DELETE') {
        requestConfig.data = body;
      } else {
        requestConfig.data = body;
      }

      const task = uni.request(requestConfig);
      return new Promise((resolve, reject) => {
        if (typeof task.then === 'function') {
          Promise.resolve(task as unknown as Promise<Record<string, unknown>>)
            .then((res) => {
              resolve({
                status: (res.statusCode as number) || 200,
                data: res.data,
                headers: res.header as Record<string, string> || {},
              });
            })
            .catch((err: Error) => reject(err));
        }
      });
    },
  };
}
