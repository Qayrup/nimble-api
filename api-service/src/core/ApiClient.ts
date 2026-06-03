import { MemoryCache } from './cache';
import { PluginManager } from '../plugins/manager';
import { buildUrl } from '../utils/url-builder';
import { generateCacheKey } from '../utils/cache-key';
import { createFetchAdapter } from '../adapters/fetch';
import type {
  ApiConfig,
  ApiPlugin,
  EndpointConfig,
  CallOptions,
  RequestContext,
  ResponseContext,
  ErrorContext,
  RequestAdapter,
  ApiClientSettings,
  EntityDefinition,
} from './types';

interface CompiledMethod<T = unknown> {
  (params?: Record<string, string | number>, body?: Record<string, unknown>, opts?: CallOptions): Promise<T>;
  with(this: CompiledMethod<T>, opts: CallOptions): CompiledMethod<T>;
  methodId: symbol;
  apiKey: string;
}

type DebounceState = { timer: ReturnType<typeof setTimeout> | null; lastResolve: ((v: unknown) => void) | null; lastReject: ((e: unknown) => void) | null };
type ThrottleState = { lastCall: number; lastPromise: Promise<unknown> | null };
type LockState = { value: boolean };

export class ApiClient {
  #config: ApiConfig;
  #settings: Required<Omit<ApiClientSettings, 'adapter' | 'plugins' | 'eventHub'>> & {
    adapter: RequestAdapter;
    plugins: ApiPlugin[];
    eventHub: ApiClientSettings['eventHub'];
  };
  #cache = new MemoryCache();
  #pluginManager = new PluginManager();
  #inFlightRequests = new Map<string, Promise<unknown>>();
  #adapter: RequestAdapter;

  // Per-call flow control state
  #debounceMap = new Map<symbol, DebounceState>();
  #throttleMap = new Map<symbol, ThrottleState>();
  #lockMap = new Map<symbol, LockState>();

  // Entity cache: entity name → entity id → entity data
  #entityCache = new Map<string, Map<string, unknown>>();

  #destroyed = false;
  #compiledMethods = new Map<string, CompiledMethod>();

  static readonly #MAX_FLOW_CACHE = 200;

  constructor(config: ApiConfig, settings: ApiClientSettings = {}) {
    this.#config = config;
    this.#adapter = settings.adapter ?? createFetchAdapter();

    this.#settings = {
      adapter: this.#adapter,
      plugins: [...(settings.plugins ?? [])],
      eventHub: settings.eventHub,
      timeout: settings.timeout ?? 30000,
      enableLogging: settings.enableLogging ?? false,
    };

    for (const plugin of this.#settings.plugins) {
      this.#pluginManager.register(plugin);
    }
    this.#pluginManager.setupAll(this);
  }

  // === 代理懒编译 ===

  #getOrCompile(apiKey: string): CompiledMethod {
    if (this.#compiledMethods.has(apiKey)) {
      return this.#compiledMethods.get(apiKey)!;
    }

    const configObj = this.#config[apiKey];
    if (!configObj) throw new Error(`Unknown API key: ${apiKey}`);
    if (!configObj.url) throw new Error(`Invalid URL for API key: ${apiKey}`);
    if (!configObj.onSuccess || configObj.onSuccess.length === 0) {
      throw new Error(`onSuccess required for API key: ${apiKey}`);
    }
    if (!configObj.onError?.default) {
      throw new Error(`onError.default required for API key: ${apiKey}`);
    }

    const method: CompiledMethod = (params, body, opts) =>
      this.#makeRequest(apiKey, configObj, params ?? {}, body ?? {}, opts ?? {});

    method.with = function (this: CompiledMethod, opts: CallOptions): CompiledMethod {
      // eslint-disable-next-line @typescript-eslint/no-this-alias
      const base = this;
      const wrapped: CompiledMethod = (p, b, o) =>
        base(p, b, { ...o, ...opts });
      wrapped.methodId = base.methodId;
      wrapped.apiKey = base.apiKey;
      wrapped.with = method.with;
      return wrapped;
    };

    method.methodId = Symbol(`API_METHOD_${apiKey}`);
    method.apiKey = apiKey;
    this.#compiledMethods.set(apiKey, method);
    return method;
  }

  // === 核心请求 ===

  async #makeRequest<T = unknown>(
    apiKey: string,
    config: EndpointConfig,
    params: Record<string, string | number>,
    body: Record<string, unknown>,
    opts: CallOptions,
  ): Promise<T> {
    this.#checkDestroyed();

    const method = config.method ?? 'GET';
    const url = buildUrl(config.url, params);
    const cacheKey = config.cacheTTL ? generateCacheKey(apiKey, params, body) : '';

    // Cache check
    if (cacheKey && !opts.skipCache) {
      const swr = config.cacheMode === 'swr';
      if (swr) {
        const stale = this.#cache.getStale(cacheKey);
        if (stale && !stale.stale) return stale.data as T;
        if (stale) {
          // Return stale, revalidate in background
          this.#revalidate(apiKey, config, params, body, cacheKey, url, method).catch(() => {});
          return stale.data as T;
        }
      } else {
        const cached = this.#cache.get(cacheKey);
        if (cached !== undefined) return cached as T;
      }
    }

    // In-flight dedup
    if (cacheKey) {
      const inFlight = this.#inFlightRequests.get(cacheKey);
      if (inFlight) return inFlight as Promise<T>;
    }

    const abortController = new AbortController();
    const signal = opts.signal ?? abortController.signal;

    const ctx: RequestContext = {
      apiKey, config, url, method,
      headers: { ...config.headers },
      body, params, opts, signal,
      timeout: this.#settings.timeout,
    };

    const execute = async (ctx: RequestContext): Promise<ResponseContext> => {
      const processed = await this.#pluginManager.runOnRequest(ctx);

      const response = await this.#adapter.request({
        url: processed.url,
        method: processed.method,
        headers: processed.headers,
        body: processed.body,
        signal: processed.signal,
        timeout: processed.timeout,
      });

      return {
        apiKey,
        config,
        status: response.status,
        data: response.data,
        headers: response.headers,
        fromCache: false,
        stale: false,
      };
    };

    let attempt = 0;
    const maxRetries = config.retry?.count ?? 0;

    const attemptRequest = async (): Promise<ResponseContext> => {
      try {
        return await execute(ctx);
      } catch (err) {
        const error = err instanceof Error ? err : new Error(String(err));
        const errorCtx: ErrorContext = { apiKey, config, error, attempt };

        const processed = await this.#pluginManager.runOnError(errorCtx);

        if (attempt < maxRetries && processed !== errorCtx) {
          attempt++;
          const delay = this.#calcBackoff(config, attempt);
          await new Promise(r => setTimeout(r, delay));
          return attemptRequest();
        }
        throw processed.error;
      }
    };

    const promise = attemptRequest().then(async (res) => {
      // Schema validation
      if (config.schema && typeof (config.schema as { safeParse?: unknown }).safeParse === 'function') {
        const result = (config.schema as { safeParse: (d: unknown) => { success: boolean; data: unknown; error: unknown } }).safeParse(res.data);
        if (!result.success) {
          throw new Error(`Schema validation failed: ${JSON.stringify(result.error)}`);
        }
        res.data = result.data;
      }

      const processed = await this.#pluginManager.runOnResponse(res);

      // Update cache
      if (cacheKey && config.cacheTTL) {
        this.#cache.set(cacheKey, processed.data, config.cacheTTL);
      }

      // Update entity cache
      if (config.entities && processed.data) {
        this.#updateEntityCache(config.entities, processed.data);
      }

      // Invalidate entities on mutation
      if (config.invalidates) {
        for (const entityName of config.invalidates) {
          this.#entityCache.delete(entityName);
        }
      }

      this.#dispatchEvents(config, processed.data, true);
      return processed.data as T;
    }).catch(async (err) => {
      this.#dispatchEvents(config, err, false);
      throw err;
    }).finally(() => {
      if (cacheKey) this.#inFlightRequests.delete(cacheKey);
    });

    if (cacheKey) {
      this.#inFlightRequests.set(cacheKey, promise);
    }

    return promise;
  }

  async #revalidate(
    apiKey: string,
    config: EndpointConfig,
    params: Record<string, string | number>,
    body: Record<string, unknown>,
    cacheKey: string,
    url: string,
    method: string,
  ): Promise<void> {
    try {
      const response = await this.#adapter.request({
        url, method,
        headers: { ...config.headers },
        body,
        timeout: this.#settings.timeout,
      });
      this.#cache.set(cacheKey, response.data, config.cacheTTL!);
    } catch {
      // Revalidation failure is silent — stale data continues to serve
    }
  }

  // === Entity Cache ===

  #updateEntityCache(entities: EntityDefinition[], data: unknown): void {
    // Unwrap response envelope: { code, data } → extract inner data
    const payload =
      (data as Record<string, unknown>)?.data && typeof (data as Record<string, unknown>).data === 'object'
        ? (data as Record<string, unknown>).data
        : data;
    const items = Array.isArray(payload) ? payload : [payload];
    for (const entity of entities) {
      const idKey = entity.idKey ?? 'id';
      let entityMap = this.#entityCache.get(entity.name);
      if (!entityMap) {
        entityMap = new Map();
        this.#entityCache.set(entity.name, entityMap);
      }
      for (const item of items) {
        const id = (item as Record<string, unknown>)[idKey];
        if (id != null) {
          entityMap.set(String(id), item);
        }
      }
    }
  }

  getEntity<T = unknown>(entityName: string, id: string): T | undefined {
    return this.#entityCache.get(entityName)?.get(id) as T | undefined;
  }

  // === Events ===

  #eventQueue: Array<{ key: string; payload: unknown }> = [];
  #batchPromise: Promise<void> | null = null;

  #dispatchEvents(config: EndpointConfig, data: unknown, success: boolean): void {
    const hub = this.#settings.eventHub;
    if (!hub) return;

    if (success && config.onSuccess) {
      const keys = Array.isArray(config.onSuccess) ? config.onSuccess : [config.onSuccess];
      for (const key of keys) {
        this.#eventQueue.push({ key, payload: data });
      }
    }

    if (!success && config.onError) {
      const code = (data as { code?: number })?.code;
      const eventKey = (code != null ? config.onError[code] : undefined) ?? config.onError.default;
      if (eventKey) {
        this.#eventQueue.push({ key: eventKey, payload: data });
      }
    }

    if (!this.#batchPromise) {
      this.#batchPromise = Promise.resolve().then(() => {
        this.#flushEvents();
        this.#batchPromise = null;
      });
    }
  }

  #flushEvents(): void {
    const hub = this.#settings.eventHub;
    if (!hub) return;
    const events = this.#eventQueue.splice(0);
    const merged = new Map<string, unknown[]>();
    for (const ev of events) {
      if (!merged.has(ev.key)) merged.set(ev.key, []);
      merged.get(ev.key)!.push(ev.payload);
    }
    for (const [key, payloads] of merged) {
      hub.emit(key, payloads.length === 1 ? payloads[0] : payloads);
    }
  }

  // === Params Backoff ===

  #calcBackoff(config: EndpointConfig, attempt: number): number {
    const retry = config.retry!;
    const base = retry.baseDelay ?? 1000;
    const max = retry.maxDelay ?? 30000;
    const delay = retry.backoff === 'exponential'
      ? base * Math.pow(2, attempt - 1)
      : base;
    return Math.min(delay, max) + Math.random() * 200;
  }

  // === Per-call Flow Control ===

  #evictIfNeeded(map: Map<unknown, unknown>): void {
    if (map.size >= ApiClient.#MAX_FLOW_CACHE) {
      const first = map.keys().next().value as unknown;
      map.delete(first);
    }
  }

  #applyDebounce(method: CompiledMethod, wait: number): CompiledMethod {
    this.#evictIfNeeded(this.#debounceMap);

    const state: DebounceState = { timer: null, lastResolve: null, lastReject: null };
    this.#debounceMap.set(method.methodId, state);

    const wrapped: CompiledMethod = (params, body, opts) => {
      if (state.timer) {
        clearTimeout(state.timer);
        state.lastReject?.(new DOMException('Debounced', 'AbortError'));
        state.lastResolve = null;
        state.lastReject = null;
      }
      return new Promise((resolve, reject) => {
        state.lastResolve = resolve;
        state.lastReject = reject;
        state.timer = setTimeout(() => {
          state.timer = null;
          method(params, body, opts).then(resolve, reject);
        }, wait);
      });
    };
    wrapped.methodId = method.methodId;
    wrapped.apiKey = method.apiKey;
    wrapped.with = method.with;
    return wrapped;
  }

  #applyThrottle(method: CompiledMethod, wait: number): CompiledMethod {
    this.#evictIfNeeded(this.#throttleMap);

    const state: ThrottleState = { lastCall: 0, lastPromise: null };
    this.#throttleMap.set(method.methodId, state);

    const wrapped: CompiledMethod = (params, body, opts) => {
      const now = Date.now();
      if (now - state.lastCall >= wait) {
        state.lastCall = now;
        state.lastPromise = method(params, body, opts);
        return state.lastPromise;
      }
      return state.lastPromise ?? Promise.resolve(undefined);
    };
    wrapped.methodId = method.methodId;
    wrapped.apiKey = method.apiKey;
    wrapped.with = method.with;
    return wrapped;
  }

  #applyLock(method: CompiledMethod, lockThrow: boolean): CompiledMethod {
    this.#evictIfNeeded(this.#lockMap);

    let state = this.#lockMap.get(method.methodId);
    if (!state) {
      state = { value: false };
      this.#lockMap.set(method.methodId, state);
    }

    const wrapped: CompiledMethod = (params, body, opts) => {
      if (state!.value) {
        if (lockThrow) throw new Error('Request is locked');
        return Promise.resolve(null);
      }
      state!.value = true;
      return method(params, body, opts).finally(() => {
        state!.value = false;
      });
    };
    wrapped.methodId = method.methodId;
    wrapped.apiKey = method.apiKey;
    wrapped.with = method.with;
    return wrapped;
  }

  // === Public API ===

  getApiMethod<T = unknown>(apiKey: string): CompiledMethod<T> {
    this.#checkDestroyed();
    return this.#getOrCompile(apiKey) as CompiledMethod<T>;
  }

  compileAll(): void {
    for (const key of Object.keys(this.#config)) {
      this.#getOrCompile(key);
    }
  }

  getCache(): MemoryCache {
    return this.#cache;
  }

  getPluginManager(): PluginManager {
    return this.#pluginManager;
  }

  destroy(): void {
    this.#destroyed = true;
    this.#pluginManager.teardownAll();
    this.#cache.clear();
    this.#inFlightRequests.clear();
    this.#entityCache.clear();
    this.#eventQueue.length = 0;
    this.#batchPromise = null;

    for (const state of this.#debounceMap.values()) {
      if (state.timer) clearTimeout(state.timer);
    }
    this.#debounceMap.clear();
    this.#throttleMap.clear();
    this.#lockMap.clear();
    this.#compiledMethods.clear();
  }

  #checkDestroyed(): void {
    if (this.#destroyed) throw new Error('[@nimble-api/api-service] Client is destroyed');
  }
}

// === Proxy Handler ===

export const apiProxyHandler: ProxyHandler<ApiClient> = {
  get(target, prop, _receiver) {
    if (typeof prop === 'string') {
      if (prop in target) {
        const val = Reflect.get(target, prop);
        if (typeof val === 'function') {
          return val.bind(target);
        }
        return val;
      }
      if (prop.endsWith('API')) {
        const apiKey = prop.slice(0, -3);
        const method = target.getApiMethod(apiKey);
        (target as unknown as Record<string, unknown>)[prop] = method;
        return method;
      }
    }
    const val = Reflect.get(target, prop);
    if (typeof val === 'function') {
      return val.bind(target);
    }
    return val;
  },
};
