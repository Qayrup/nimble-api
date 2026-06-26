import type { ApiClient } from './client';
import type { EndpointSpec, RequestOptions } from './core/types';

type EndpointSpecs = Record<string, EndpointSpec<any, any>>;

type HasSuppression<T> = T extends { debounce: number | { wait: number } } ? true
  : T extends { throttle: number | { wait: number } } ? true
  : T extends { lock: boolean | number } ? true
  : false;

type SuppressReturn<T, Spec> = HasSuppression<Spec> extends true ? T | null : T;

/** Typed API opts — replaces low-level json/form/text with a unified body convenience field */
type TypedApiOpts = { body?: unknown } & Omit<RequestOptions, 'json' | 'form' | 'text'>;

export type TypedApi<T extends EndpointSpecs> = {
  [K in keyof T & string]: (
    ...args: T[K]['_params'] extends Record<string, string | number>
      ? [opts: { params: T[K]['_params'] } & TypedApiOpts]
      : [opts?: TypedApiOpts]
  ) => Promise<SuppressReturn<NonNullable<T[K]['_response']>, T[K]>>
} & {
  /** 清理所有内部 timer、Map 和 lock 计数。多实例场景下，切换实例前调用旧实例的 dispose() 可防止资源泄漏。单例长期持有则无需调用。 */
  dispose(): void;
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
  const locks = new Map<string, number>();
  const debounceStates = new Map<string, DebounceState>();
  // throttle state 在调用之间持久保留——lastTime 是节流窗口的基准，必须跨调用记录。单例场景下可忽略；多实例场景请调用 dispose() 清理。
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
      const rawLock = (reqOpts?.lock as boolean | number | undefined) ?? spec.lock;
      const lockLimit: number = rawLock === true ? 1 : rawLock === false || rawLock == null ? 0 : Number(rawLock);

      // Normalize throttle to { wait, edge }
      const isThrottleObj = typeof rawThrottle === 'object' && rawThrottle !== null;
      const throttleWait = isThrottleObj ? (rawThrottle as { wait: number }).wait
        : (typeof rawThrottle === 'number' ? rawThrottle : 0);
      const throttleEdge: 'leading' | 'trailing' | 'both' =
        isThrottleObj ? (((rawThrottle as { edge?: string }).edge as 'leading' | 'trailing' | 'both' | undefined) ?? 'both')
          : 'both';

      const execute = lockLimit > 0
        ? (opts?: Record<string, unknown>) => {
            const count = locks.get(name) ?? 0;
            if (count >= lockLimit) return Promise.resolve(null);
            locks.set(name, count + 1);
            return rawMethod(opts).finally(() => {
              const c = locks.get(name);
              if (c !== undefined) c <= 1 ? locks.delete(name) : locks.set(name, c - 1);
            });
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
          // Within throttle window — callers below get null, trailing callbacks are fire-and-forget:
          // 补发请求无接收者，失败无意义，故用 void（非 .catch）标记意图。
          if (throttleEdge === 'trailing' || throttleEdge === 'both') {
            st.lastArgs = reqOpts;
            if (st.trailing !== undefined) clearTimeout(st.trailing);
            st.trailing = setTimeout(() => {
              st.trailing = undefined;
              const args = st.lastArgs ?? reqOpts;
              st.lastArgs = undefined;
              st.lastTime = Date.now();
              void execute(args);
            }, throttleWait - elapsed);
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

  // dispose() — 清理内部 timer 和 Map。多实例场景（如每次路由切换创建新实例）下，
  // debounce/throttle timer 会把旧实例的闭包链撑住不放，调用 dispose() 可立即释放。
  // 单例长期持有则无需关心。
  (api as Record<string, unknown>).dispose = () => {
    for (const st of debounceStates.values()) {
      if (st.timer !== undefined) clearTimeout(st.timer);
      st.lastResolve?.(null);
      st.controller?.abort();
    }
    debounceStates.clear();
    for (const st of throttleStates.values()) {
      if (st.trailing !== undefined) clearTimeout(st.trailing);
    }
    throttleStates.clear();
    locks.clear();
  };

  return api;
}
