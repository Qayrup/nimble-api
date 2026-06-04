import type { ApiClient } from './client';
import type { EndpointSpec, RequestOptions } from './core/types';

type EndpointSpecs = Record<string, EndpointSpec<any, any>>;

export type TypedApi<T extends EndpointSpecs> = {
  [K in keyof T & string]: (
    ...args: NonNullable<T[K]['_params']> extends Record<string, string | number>
      ? [opts: { params: NonNullable<T[K]['_params']> } & Omit<RequestOptions, 'json' | 'form' | 'text'>]
      : [opts?: Omit<RequestOptions, 'json' | 'form' | 'text'>]
  ) => Promise<NonNullable<T[K]['_response']>>
};

export function createTypedApi<T extends EndpointSpecs>(
  client: ApiClient,
  endpoints: T,
): TypedApi<T> {
  const api = {} as TypedApi<T>;

  for (const name of Object.keys(endpoints) as (keyof T & string)[]) {
    const spec = endpoints[name];

    api[name] = ((opts?: Record<string, unknown>) => {
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
    }) as TypedApi<T>[typeof name];
  }

  return api;
}
