import type { ApiClient } from './client';
import type { EndpointSpec, RequestOptions } from './core/types';

type EndpointSpecs = Record<string, EndpointSpec<any, any>>;

type HasSuppression<T> = T extends { debounce: number | { wait: number } } ? true
  : T extends { throttle: number | { wait: number } } ? true
  : T extends { lock: boolean } ? true
  : false;

type SuppressReturn<T, Spec> = HasSuppression<Spec> extends true ? T | null : T;

export type TypedApi<T extends EndpointSpecs> = {
  [K in keyof T & string]: (
    ...args: NonNullable<T[K]['_params']> extends Record<string, string | number>
      ? [opts: { params: NonNullable<T[K]['_params']> } & Omit<RequestOptions, 'json' | 'form' | 'text'>]
      : [opts?: Omit<RequestOptions, 'json' | 'form' | 'text'>]
  ) => Promise<SuppressReturn<NonNullable<T[K]['_response']>, T[K]>>
};

function mergeSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if ('any' in AbortSignal) return AbortSignal.any([a, b]);
  const ctrl = new AbortController();
  const fire = () => ctrl.abort();
  a.addEventListener('abort', fire, { once: true });
  b.addEventListener('abort', fire, { once: true });
  if (a.aborted || b.aborted) ctrl.abort();
  return ctrl.signal;
}

interface DebounceState {
  timer?: ReturnType<typeof setTimeout>;
  lastResolve: ((v: unknown) => void) | null;
  controller?: AbortController;
}

interface ThrottleState {
  lastTime: number;
  trailing?: ReturnType<typeof setTimeout>;
  /** Last args for trailing-edge execution */
  lastArgs?: Record<string, unknown>;
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
        if (reqOpts.body instanceof FormData) {
          requestOpts.form = reqOpts.body as FormData;
        } else if (typeof reqOpts.body === 'string') {
          requestOpts.text = reqOpts.body;
        } else {
          requestOpts.json = reqOpts.body;
        }
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
      const rawDebounce = (reqOpts?.debounce as number | false | { wait: number; abort?: boolean } | undefined) ?? spec.debounce;
      const isDebounceObj = typeof rawDebounce === 'object' && rawDebounce !== null;
      const effectiveDebounce = isDebounceObj ? (rawDebounce as { wait: number }).wait
        : (typeof rawDebounce === 'number' ? rawDebounce : 0);
      const debounceAbort = isDebounceObj ? ((rawDebounce as { abort?: boolean }).abort ?? false) : false;
      const rawThrottle = (reqOpts?.throttle as number | false | { wait: number; edge?: string } | undefined) ?? spec.throttle;
      const effectiveLock = (reqOpts?.lock as boolean | undefined) ?? spec.lock;

      // Normalize throttle to { wait, edge }
      const isThrottleObj = typeof rawThrottle === 'object' && rawThrottle !== null;
      const throttleWait = isThrottleObj ? (rawThrottle as { wait: number }).wait
        : (typeof rawThrottle === 'number' ? rawThrottle : 0);
      const throttleEdge: 'leading' | 'trailing' | 'both' =
        isThrottleObj ? (((rawThrottle as { edge?: string }).edge as 'leading' | 'trailing' | 'both' | undefined) ?? 'both')
          : 'both';

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
          // Abort in-flight HTTP request if configured
          if (debounceAbort) st.controller?.abort();
        }
        return new Promise((resolve, reject) => {
          st.lastResolve = resolve as (v: unknown) => void;
          st.timer = setTimeout(() => {
            st.lastResolve = null;
            st.timer = undefined;

            let controller: AbortController | undefined;
            let mergedSignal: AbortSignal | undefined;
            if (debounceAbort) {
              controller = new AbortController();
              st.controller = controller;
              const userSignal = reqOpts?.signal as AbortSignal | undefined;
              if (userSignal) {
                mergedSignal = mergeSignals(controller.signal, userSignal);
              } else {
                mergedSignal = controller.signal;
              }
            }

            execute(mergedSignal ? { ...reqOpts, signal: mergedSignal } : reqOpts).then(
              resolve as (v: unknown) => void,
              reject as (e: unknown) => void,
            ).finally(() => {
              debounceStates.delete(name);
              if (controller) st.controller = undefined;
            });
          }, effectiveDebounce);
        });
      }

      if (throttleWait > 0) {
        const st = throttleStates.get(name) ?? { lastTime: 0 };
        throttleStates.set(name, st);
        const now = Date.now();
        const elapsed = now - st.lastTime;

        if (elapsed < throttleWait) {
          // Within throttle window
          if (throttleEdge === 'trailing' || throttleEdge === 'both') {
            st.lastArgs = reqOpts;
            if (throttleEdge === 'trailing') {
              // Reset timer on each call — trailing fires with latest args
              if (st.trailing !== undefined) clearTimeout(st.trailing);
              st.trailing = setTimeout(() => {
                st.trailing = undefined;
                const args = st.lastArgs ?? reqOpts;
                st.lastArgs = undefined;
                st.lastTime = Date.now();
                execute(args);
              }, throttleWait - elapsed);
            } else if (throttleEdge === 'both' && st.trailing === undefined) {
              st.trailing = setTimeout(() => {
                st.trailing = undefined;
                const args = st.lastArgs ?? reqOpts;
                st.lastArgs = undefined;
                st.lastTime = Date.now();
                execute(args);
              }, throttleWait - elapsed);
            }
          }
          return Promise.resolve(null);
        }

        // Outside throttle window — clear trailing timer
        if (st.trailing !== undefined) {
          clearTimeout(st.trailing);
          st.trailing = undefined;
        }
        st.lastTime = now;
        return execute(reqOpts);
      }

      return execute(reqOpts);
    }) as TypedApi<T>[typeof name];
  }

  return api;
}
