import { MemoryCache } from './core/cache';
import { buildUrl } from './utils/url-builder';
import { generateCacheKey } from './utils/cache-key';
import { createFetchAdapter } from './adapters/fetch';
import { runBeforeRequest, runAfterResponse, runBeforeRetry, runBeforeError } from './hooks';
import { calcBackoff, shouldRetry, DEFAULT_RETRY } from './retry';
import { stop } from './core/types';
import type {
  ApiOptions,
  RequestOptions,
  RequestState,
  NormalizedRequestOptions,
  RequestAdapter,
  Hooks,
  CacheControl,
  EventHubLike,
} from './core/types';
import { ApiError } from './core/types';

const DEFAULT_OPTIONS: NormalizedRequestOptions = {
  baseUrl: '',
  timeout: 30000,
  responseType: 'json',
  retry: false,
  cache: { ttl: 0, mode: 'ttl', tags: [], skip: false },
  onSuccess: [],
  onError: null,
  entities: [],
  invalidates: [],
  schema: null,
};

export class ApiClient {
  #options: ApiOptions;
  #cache: MemoryCache;
  #adapter: RequestAdapter;
  #hooks: Hooks;
  #inFlight = new Map<string, Promise<unknown>>();
  #destroyed = false;
  #eventHub: EventHubLike | undefined;

  constructor(options: ApiOptions = {}) {
    this.#options = { ...options };
    this.#adapter = options.adapter ?? createFetchAdapter();
    this.#hooks = { ...options.hooks };
    this.#eventHub = options.eventHub;

    const maxSize = options.cache === false ? 0 : (options.cache?.maxSize ?? Infinity);
    this.#cache = new MemoryCache(maxSize);
  }

  // === HTTP Methods ===

  get<T = unknown>(url: string, opts?: RequestOptions): Promise<T> {
    return this.#request<T>(url, { ...opts, method: 'GET' });
  }

  post<T = unknown>(url: string, opts?: RequestOptions): Promise<T> {
    return this.#request<T>(url, { ...opts, method: 'POST' });
  }

  put<T = unknown>(url: string, opts?: RequestOptions): Promise<T> {
    return this.#request<T>(url, { ...opts, method: 'PUT' });
  }

  patch<T = unknown>(url: string, opts?: RequestOptions): Promise<T> {
    return this.#request<T>(url, { ...opts, method: 'PATCH' });
  }

  delete<T = unknown>(url: string, opts?: RequestOptions): Promise<T> {
    return this.#request<T>(url, { ...opts, method: 'DELETE' });
  }

  // === Extend ===

  extend(options: ApiOptions): ApiClient {
    const merged: ApiOptions = {
      ...this.#options,
      ...options,
      headers: { ...this.#options.headers, ...options.headers },
      hooks: {
        beforeRequest: [...(this.#options.hooks?.beforeRequest ?? []), ...(options.hooks?.beforeRequest ?? [])],
        afterResponse: [...(this.#options.hooks?.afterResponse ?? []), ...(options.hooks?.afterResponse ?? [])],
        beforeRetry: [...(this.#options.hooks?.beforeRetry ?? []), ...(options.hooks?.beforeRetry ?? [])],
        beforeError: [...(this.#options.hooks?.beforeError ?? []), ...(options.hooks?.beforeError ?? [])],
      },
    };

    const child = new ApiClient(merged);
    child.#cache = this.#cache; // Share cache with parent
    return child;
  }

  // === Cache Control ===

  get cache(): CacheControl {
    this.#checkDestroyed();
    return {
      invalidate: (opts: { tags?: string[]; key?: string }) => {
        if (opts.tags) this.#cache.invalidateByTags(opts.tags);
        if (opts.key) this.#cache.invalidateByKey(opts.key);
      },
      clear: () => this.#cache.clear(),
    };
  }

  // === Lifecycle ===

  dispose(): void {
    this.#destroyed = true;
    this.#cache.clear();
    this.#inFlight.clear();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  // === Core Request Logic ===

  async #request<T = unknown>(rawUrl: string, opts: RequestOptions): Promise<T> {
    this.#checkDestroyed();

    const normalized = this.#normalizeOptions(opts);
    const method = (opts.method ?? 'GET').toUpperCase();
    const url = this.#buildFullUrl(rawUrl, opts);
    const body = this.#extractBody(opts);

    // Build initial request state
    const headers: Record<string, string> = {
      ...this.#options.headers,
      ...opts.headers,
    };
    if (body != null && method !== 'GET' && method !== 'DELETE') {
      headers['Content-Type'] = 'application/json';
    }

    const cacheKey = normalized.cache.ttl > 0
      ? generateCacheKey(rawUrl, opts.params ?? {}, body ?? {})
      : '';

    const state: RequestState = {
      request: {
        url,
        method,
        headers,
        body,
        signal: opts.signal,
      },
      error: undefined,
      retryCount: 0,
      options: normalized,
      meta: {},
    };

    return this.#executeWithRetry<T>(state, cacheKey);
  }

  async #executeWithRetry<T>(state: RequestState, cacheKey: string): Promise<T> {
    const retry = state.options.retry;
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;

    async function attempt(): Promise<T> {
      try {
        return await self.#executeOnce<T>(state, cacheKey);
      } catch (err) {
        const error = err instanceof ApiError ? err : new ApiError(
          err instanceof Error ? err.message : String(err),
          {
            status: 0,
            data: null,
            request: state.request,
          },
        );

        state.error = error;
        state.retryCount++;

        // Run beforeError hooks
        const errorState = await runBeforeError(self.#hooks, state);

        // Check retry
        if (
          retry !== false &&
          state.retryCount <= (retry.limit ?? DEFAULT_RETRY.limit) &&
          shouldRetry(retry, error.status ?? error.response?.status, state.request.method)
        ) {
          // Run beforeRetry hooks
          const retryResult = await runBeforeRetry(self.#hooks, errorState);
          if (retryResult === stop) throw errorState.error;

          const delay = calcBackoff(retry, state.retryCount);
          await new Promise(r => setTimeout(r, delay));
          return attempt();
        }

        self.#dispatchEvents(errorState);
        throw errorState.error;
      }
    }

    return attempt();
  }

  async #executeOnce<T>(state: RequestState, cacheKey: string): Promise<T> {
    // 1. beforeRequest hooks
    state = await runBeforeRequest(this.#hooks, state);

    const url = state.request.url;
    const method = state.request.method;
    const bodyHash = state.request.body ? JSON.stringify(state.request.body) : '';
    const dedupKey = `${method}:${url}:${bodyHash}`;

    // 2. In-flight dedup
    if (dedupKey) {
      const inFlight = this.#inFlight.get(dedupKey);
      if (inFlight) return inFlight as Promise<T>;
    }

    // 3. Cache check
    const cacheTTL = state.options.cache.ttl;
    const cacheMode = state.options.cache.mode;
    const cacheTags = state.options.cache.tags;

    if (cacheKey && !state.options.cache.skip) {
      if (cacheMode === 'swr') {
        const stale = this.#cache.getStale(cacheKey);
        if (stale && !stale.stale) {
          state.cache = { key: cacheKey, hit: true, stale: false };
          return stale.data as T;
        }
        if (stale) {
          state.cache = { key: cacheKey, hit: true, stale: true };
          // Return stale, revalidate in background
          this.#doFetch(state, cacheKey, cacheTags, method).catch(() => {});
          return stale.data as T;
        }
      } else if (cacheMode === 'ttl') {
        const cached = this.#cache.get(cacheKey);
        if (cached !== undefined) {
          state.cache = { key: cacheKey, hit: true, stale: false };
          return cached as T;
        }
      }
    }

    const promise = this.#doFetch<T>(state, cacheKey, cacheTags, method);

    if (dedupKey) {
      this.#inFlight.set(dedupKey, promise);
    }

    try {
      return await promise;
    } finally {
      if (dedupKey) {
        this.#inFlight.delete(dedupKey);
      }
    }
  }

  async #doFetch<T>(
    state: RequestState,
    cacheKey: string,
    cacheTags: string[],
    method: string,
  ): Promise<T> {
    // 4. Actually fetch
    const response = await this.#adapter.request({
      url: state.request.url,
      method: state.request.method,
      headers: state.request.headers,
      body: state.request.body,
      signal: state.request.signal,
      timeout: state.options.timeout,
      responseType: state.options.responseType,
    });

    state.response = {
      status: response.status,
      data: response.data,
      headers: response.headers,
    };

    // 5. Schema validation
    if (state.options.schema) {
      const schema = state.options.schema;
      if (typeof schema.parse === 'function') {
        state.response.data = schema.parse(state.response.data);
      } else if (typeof schema.safeParse === 'function') {
        const result = schema.safeParse(state.response.data);
        if (!result.success) {
          throw new ApiError('Schema validation failed', {
            status: response.status,
            data: result.error,
            request: state.request,
            response: { status: response.status, headers: response.headers },
          });
        }
        state.response.data = result.data;
      }
    }

    // 6. Error status check
    if (response.status < 200 || response.status >= 300) {
      throw new ApiError(`Request failed with status ${response.status}`, {
        status: response.status,
        data: response.data,
        request: state.request,
        response: { status: response.status, headers: response.headers },
      });
    }

    // 7. afterResponse hooks
    state = await runAfterResponse(this.#hooks, state);

    // 8. Cache store
    if (cacheKey) {
      this.#cache.set(cacheKey, state.response!.data, state.options.cache.ttl, cacheTags);
    }

    // 9. Entity cache tags from response
    if (state.options.entities.length > 0 && state.response?.data) {
      this.#extractEntities(state.options.entities, state.response.data);
    }

    // 10. Invalidate tags
    if (state.options.invalidates.length > 0) {
      this.#cache.invalidateByTags(state.options.invalidates);
    }

    // 11. Dispatch events
    this.#dispatchEvents(state);

    return state.response!.data as T;
  }

  // === Helpers ===

  #normalizeOptions(opts: RequestOptions): NormalizedRequestOptions {
    const clientCache = this.#options.cache === false ? { ttl: 0, mode: 'ttl' as const } : this.#options.cache;
    const reqCache = opts.cache;

    return {
      baseUrl: this.#options.baseUrl ?? DEFAULT_OPTIONS.baseUrl,
      timeout: opts.timeout ?? this.#options.timeout ?? DEFAULT_OPTIONS.timeout,
      responseType: opts.responseType ?? DEFAULT_OPTIONS.responseType,
      retry: opts.retry === false ? false : { ...DEFAULT_RETRY, ...this.#options.retry, ...opts.retry },
      cache: {
        ttl: reqCache?.ttl ?? clientCache?.ttl ?? DEFAULT_OPTIONS.cache.ttl,
        mode: reqCache?.mode ?? clientCache?.mode ?? DEFAULT_OPTIONS.cache.mode,
        tags: reqCache?.tags ?? [],
        skip: reqCache?.skip ?? false,
      },
      onSuccess: opts.onSuccess
        ? (Array.isArray(opts.onSuccess) ? opts.onSuccess : [opts.onSuccess])
        : [],
      onError: opts.onError ?? null,
      entities: opts.entities ?? [],
      invalidates: opts.invalidates ?? [],
      schema: opts.schema ?? null,
    };
  }

  #buildFullUrl(rawUrl: string, opts: RequestOptions): string {
    let url = rawUrl;
    if (opts.params) {
      url = buildUrl(url, opts.params);
    }
    if (opts.searchParams) {
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.searchParams)) {
        sp.append(k, String(v));
      }
      const qs = sp.toString();
      if (qs) url = url + (url.includes('?') ? '&' : '?') + qs;
    }
    const baseUrl = this.#options.baseUrl ?? '';
    return baseUrl ? baseUrl + url : url;
  }

  #extractBody(opts: RequestOptions): unknown {
    if (opts.json !== undefined) return opts.json;
    if (opts.form !== undefined) return opts.form;
    if (opts.text !== undefined) return opts.text;
    return undefined;
  }

  #extractEntities(entities: Array<{ name: string; idKey?: string }>, data: unknown): void {
    const payload =
      (data as Record<string, unknown>)?.data && typeof (data as Record<string, unknown>).data === 'object'
        ? (data as Record<string, unknown>).data
        : data;
    const items = Array.isArray(payload) ? payload : [payload];
    for (const entity of entities) {
      const idKey = entity.idKey ?? 'id';
      for (const item of items) {
        const id = (item as Record<string, unknown>)[idKey];
        if (id != null) {
          // Store entity in cache with entity tag
          const entityKey = `@entity:${entity.name}:${String(id)}`;
          this.#cache.set(entityKey, item, Infinity, [entity.name]);
        }
      }
    }
  }

  #dispatchEvents(state: RequestState): void {
    const hub = this.#eventHub;
    if (!hub) return;

    const data = state.response?.data;
    const status = state.response?.status;

    // onSuccess — only fire on actual success, not when error is set
    if (!state.error && status != null && status >= 200 && status < 300 && state.options.onSuccess.length > 0) {
      for (const key of state.options.onSuccess) {
        try { hub.emit(key, data); } catch { /* event errors are non-critical */ }
      }
    }

    // onError
    if (state.options.onError && state.error) {
      const code = (state.error.data as { code?: number })?.code;
      const eventKey = (code != null ? state.options.onError[code] : undefined) ?? state.options.onError.default;
      if (eventKey) {
        try { hub.emit(eventKey, state.error.data); } catch { /* event errors are non-critical */ }
      }
    }
  }

  #checkDestroyed(): void {
    if (this.#destroyed) throw new Error('[@nimble-api/api-service] Client is destroyed');
  }
}
