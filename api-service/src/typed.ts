import type { ApiClient } from './client';
import type { EndpointSpec, RequestOptions } from './core/types';

type EndpointSpecs = Record<string, EndpointSpec<any, any>>;

type HasSuppression<T> = T extends { lock: true }
  ? true
  : T extends { debounce: number }
    ? true
    : T extends { throttle: number }
      ? true
      : false;

type SuppressReturn<T, Spec> = HasSuppression<Spec> extends true ? T | null : T;

export type TypedApi<T extends EndpointSpecs> = {
  [K in keyof T & string]: (
    ...args: NonNullable<T[K]['_params']> extends Record<string, string | number>
      ? [opts: { params: NonNullable<T[K]['_params']> } & Omit<RequestOptions, 'json' | 'form' | 'text'>]
      : [opts?: Omit<RequestOptions, 'json' | 'form' | 'text'>]
  ) => Promise<SuppressReturn<NonNullable<T[K]['_response']>, T[K]>>
};

interface DebounceState {
  timer?: ReturnType<typeof setTimeout>;
  lastResolve: ((v: unknown) => void) | null;
}

interface ThrottleState {
  lastTime: number;
}

export function createTypedApi<T extends EndpointSpecs>(
  client: ApiClient,
  endpoints: T,
): TypedApi<T> {
  const api = {} as TypedApi<T>;
  const locks = new Map<string, boolean>();
  const debounceStates = new Map<string, DebounceState>();
  const throttleStates = new Map<string, ThrottleState>();

  for (const name of Object.keys(endpoints) as (keyof T & string)[]) {
    const spec = endpoints[name];

    const rawMethod = (reqOpts?: Record<string, unknown>) => {
      const url = spec.url;
      const method = (spec.method ?? 'GET').toUpperCase();

      const requestOpts: RequestOptions = {
        ...reqOpts,
        method,
        params: (reqOpts?.params ?? {}) as Record<string, string | number>,
        cache: spec.cache ?? (reqOpts?.cache as RequestOptions['cache']),
        retry: spec.retry ?? (reqOpts?.retry as RequestOptions['retry']),
        schema: spec.schema ?? (reqOpts?.schema as RequestOptions['schema']),
        onSuccess: spec.onSuccess ?? (reqOpts?.onSuccess as RequestOptions['onSuccess']),
        onError: spec.onError ?? (reqOpts?.onError as RequestOptions['onError']),
        entities: spec.entities ?? (reqOpts?.entities as RequestOptions['entities']),
        invalidates: spec.invalidates ?? (reqOpts?.invalidates as RequestOptions['invalidates']),
        headers: { ...spec.headers, ...(reqOpts?.headers as Record<string, string>) },
        timeout: spec.timeout ?? (reqOpts?.timeout as number),
        responseType: spec.responseType ?? (reqOpts?.responseType as RequestOptions['responseType']),
        validateStatus: spec.validateStatus ?? (reqOpts?.validateStatus as ((status: number) => boolean)),
      };

      if (reqOpts?.body !== undefined) {
        requestOpts.json = reqOpts.body;
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

    api[name] = ((reqOpts?: Record<string, unknown>) => {
      const effectiveDebounce = (reqOpts?.debounce as number | false | undefined) ?? spec.debounce;
      const effectiveThrottle = (reqOpts?.throttle as number | false | undefined) ?? spec.throttle;
      const effectiveLock = (reqOpts?.lock as boolean | undefined) ?? spec.lock;

      const execute = effectiveLock
        ? (opts?: Record<string, unknown>) => {
            if (locks.get(name)) return Promise.resolve(null);
            locks.set(name, true);
            return rawMethod(opts).finally(() => { locks.delete(name); });
          }
        : rawMethod;

      if (effectiveDebounce) {
        const st = debounceStates.get(name) ?? { lastResolve: null };
        debounceStates.set(name, st);
        if (st.timer !== undefined) {
          clearTimeout(st.timer);
          st.lastResolve?.(null);
        }
        return new Promise((resolve, reject) => {
          st.lastResolve = resolve as (v: unknown) => void;
          st.timer = setTimeout(() => {
            st.lastResolve = null;
            st.timer = undefined;
            execute(reqOpts).then(
              resolve as (v: unknown) => void,
              reject as (e: unknown) => void,
            );
          }, effectiveDebounce);
        });
      }

      if (effectiveThrottle) {
        const st = throttleStates.get(name) ?? { lastTime: 0 };
        throttleStates.set(name, st);
        if (Date.now() - st.lastTime < effectiveThrottle) return Promise.resolve(null);
        st.lastTime = Date.now();
        return execute(reqOpts);
      }

      return execute(reqOpts);
    }) as TypedApi<T>[typeof name];
  }

  return api;
}
