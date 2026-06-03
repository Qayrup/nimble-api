import type { ApiClient } from './client';
import type { ApiDefinition, EndpointSpec, TypedApi, RequestOptions } from './core/types';

export function createTypedApi<T extends ApiDefinition>(
  client: ApiClient,
  endpoints: { [K in keyof T]: EndpointSpec },
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

      // Remove json/form/text from opts and use body if provided
      if ((opts as Record<string, unknown>)?.body !== undefined) {
        requestOpts.json = (opts as Record<string, unknown>).body;
      }

      // Route to correct HTTP method
      switch (method) {
        case 'GET': return client.get(url, requestOpts);
        case 'POST': return client.post(url, requestOpts);
        case 'PUT': return client.put(url, requestOpts);
        case 'PATCH': return client.patch(url, requestOpts);
        case 'DELETE': return client.delete(url, requestOpts);
        default: return client.get(url, requestOpts);
      }
    }) as TypedApi<T>[typeof name];
  }

  return api;
}
