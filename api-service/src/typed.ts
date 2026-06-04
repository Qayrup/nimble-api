import type { ApiClient } from './client';
import type { EndpointSpec, RequestOptions } from './core/types';

type EndpointSpecs = Record<string, EndpointSpec<any, any>>;

type LockedReturn<T, Spec> = Spec extends { lock: true } ? T | null : T;

export type TypedApi<T extends EndpointSpecs> = {
  [K in keyof T & string]: (
    ...args: NonNullable<T[K]['_params']> extends Record<string, string | number>
      ? [opts: { params: NonNullable<T[K]['_params']> } & Omit<RequestOptions, 'json' | 'form' | 'text'>]
      : [opts?: Omit<RequestOptions, 'json' | 'form' | 'text'>]
  ) => Promise<LockedReturn<NonNullable<T[K]['_response']>, T[K]>>
};

export function createTypedApi<T extends EndpointSpecs>(
  client: ApiClient,
  endpoints: T,
): TypedApi<T> {
  const api = {} as TypedApi<T>;
  const locks = new Map<string, boolean>();

  for (const name of Object.keys(endpoints) as (keyof T & string)[]) {
    const spec = endpoints[name];

    const rawMethod = (opts?: Record<string, unknown>) => {
      const url = spec.url;
      const method = (spec.method ?? 'GET').toUpperCase();

      const requestOpts: RequestOptions = {
        ...opts,
        method,
        params: (opts?.params ?? {}) as Record<string, string | number>,
        cache: spec.cache ?? (opts?.cache as RequestOptions['cache']),
        retry: spec.retry ?? (opts?.retry as RequestOptions['retry']),
        schema: spec.schema ?? (opts?.schema as RequestOptions['schema']),
        onSuccess: spec.onSuccess ?? (opts?.onSuccess as RequestOptions['onSuccess']),
        onError: spec.onError ?? (opts?.onError as RequestOptions['onError']),
        entities: spec.entities ?? (opts?.entities as RequestOptions['entities']),
        invalidates: spec.invalidates ?? (opts?.invalidates as RequestOptions['invalidates']),
        headers: { ...spec.headers, ...(opts?.headers as Record<string, string>) },
        timeout: spec.timeout ?? (opts?.timeout as number),
        responseType: spec.responseType ?? (opts?.responseType as RequestOptions['responseType']),
      };

      if ((opts as Record<string, unknown>)?.body !== undefined) {
        requestOpts.json = (opts as Record<string, unknown>).body;
      }

      switch (method) {
        case 'GET': return client.get(url, requestOpts);
        case 'POST': return client.post(url, requestOpts);
        case 'PUT': return client.put(url, requestOpts);
        case 'PATCH': return client.patch(url, requestOpts);
        case 'DELETE': return client.delete(url, requestOpts);
        case 'HEAD': return client.head(url, requestOpts);
        case 'OPTIONS': return client.options(url, requestOpts);
        default: throw new Error(`[@nimble-api/api-service] Unsupported HTTP method: ${method}`);
      }
    };

    if (spec.lock) {
      api[name] = (async (opts?: Record<string, unknown>) => {
        if (locks.get(name)) return null;
        locks.set(name, true);
        try {
          return await rawMethod(opts);
        } finally {
          locks.delete(name);
        }
      }) as TypedApi<T>[typeof name];
    } else {
      api[name] = rawMethod as TypedApi<T>[typeof name];
    }
  }

  return api;
}
