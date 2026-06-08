import { MemoryCache } from './core/cache';
import { buildUrl } from './utils/url-builder';
import { generateCacheKey, stableNormalize } from './utils/cache-key';
import { createFetchAdapter } from './adapters/fetch';
import { runBeforeRequest, runAfterResponse, runBeforeRetry, runBeforeError, runInitHooks } from './hooks';
import { calcBackoff, shouldRetry, DEFAULT_RETRY } from './retry';
import { stop, NetworkError } from './core/types';
import { readCookie } from './utils/cookie';
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

function mergeRetry(
  perRequest: RequestOptions['retry'],
  clientLevel: ApiOptions['retry'],
): Required<NormalizedRequestOptions>['retry'] {
  if (perRequest === false) return false;
  if (perRequest != null) {
    return { ...DEFAULT_RETRY, ...(clientLevel !== false ? clientLevel : {}), ...perRequest };
  }
  if (clientLevel === false) return false;
  return { ...DEFAULT_RETRY, ...(clientLevel ?? {}) };
}

const DEFAULT_OPTIONS: NormalizedRequestOptions = {
  baseUrl: '',
  timeout: 30000,
  responseType: 'json',
  retry: { ...DEFAULT_RETRY },
  cache: { ttl: 0, mode: 'ttl', tags: [], skip: false },
  onSuccess: [],
  onError: null,
  entities: [],
  invalidates: [],
  schema: null,
  validateStatus: (status: number) => status >= 200 && status < 300,
  onUploadProgress: null,
  onDownloadProgress: null,
  uploadFieldName: null,
  totalTimeout: null,
  maxContentLength: null,
  dedup: true,
};

export class ApiClient {
  #options: ApiOptions;
  #cache: MemoryCache | undefined;
  #adapter: RequestAdapter;
  #hooks: Hooks;
  #inFlight = new Map<string, Promise<unknown>>();
  #destroyed = false;
  #eventHub: EventHubLike | undefined;
  #disposeController = new AbortController();

  constructor(options: ApiOptions = {}) {
    this.#options = { ...options };
    this.#adapter = options.adapter ?? createFetchAdapter();
    this.#hooks = { ...options.hooks };
    this.#eventHub = options.eventHub;

    if (options.cache !== false) {
      this.#cache = new MemoryCache(options.cache?.maxSize ?? Infinity);
    }
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

  head<T = unknown>(url: string, opts?: RequestOptions): Promise<T> {
    return this.#request<T>(url, { ...opts, method: 'HEAD' });
  }

  options<T = unknown>(url: string, opts?: RequestOptions): Promise<T> {
    return this.#request<T>(url, { ...opts, method: 'OPTIONS' });
  }

  // === Extend ===

  extend(options: ApiOptions): ApiClient {
    this.#checkDestroyed();
    const merged: ApiOptions = {
      ...this.#options,
      ...options,
      headers: { ...this.#options.headers, ...options.headers },
      hooks: {
        init: [...(this.#options.hooks?.init ?? []), ...(options.hooks?.init ?? [])],
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
      invalidate: (opts: { tags?: string[]; key?: string; keyPrefix?: string }) => {
        if (!this.#cache) return;
        if (opts.tags) this.#cache.invalidateByTags(opts.tags);
        if (opts.key) this.#cache.invalidateByKey(opts.key);
        if (opts.keyPrefix) this.#cache.invalidateByKeyPrefix(opts.keyPrefix);
      },
      clear: () => this.#cache?.clear(),
    };
  }

  // === Lifecycle ===

  dispose(): void {
    this.#disposeController.abort();
    this.#destroyed = true;
    this.#cache?.clear();
    this.#inFlight.clear();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  // === Core Request Logic ===

  async #request<T = unknown>(rawUrl: string, opts: RequestOptions): Promise<T> {
    this.#checkDestroyed();

    // Run init hooks (mutate options before normalization)
    opts = await runInitHooks(this.#hooks, opts);

    const normalized = this.#normalizeOptions(opts);
    const method = (opts.method ?? 'GET').toUpperCase();
    const url = this.#buildFullUrl(rawUrl, opts);
    const body = this.#extractBody(opts);

    // Build initial request state
    const headers: Record<string, string> = {
      ...this.#options.headers,
      ...opts.headers,
    };
    if (body != null && !(body instanceof FormData) && method !== 'GET' && method !== 'DELETE' && method !== 'HEAD' && method !== 'OPTIONS') {
      headers['Content-Type'] = 'application/json';
    }

    // CSRF
    if (this.#options.xsrf !== false) {
      const xsrfCookie = this.#options.xsrfCookieName ?? 'XSRF-TOKEN';
      const xsrfHeader = this.#options.xsrfHeaderName ?? 'X-XSRF-TOKEN';
      const xsrfToken = readCookie(xsrfCookie);
      const hasXsrf = Object.keys(headers).some(k => k.toLowerCase() === xsrfHeader.toLowerCase());
      if (xsrfToken && !hasXsrf) {
        headers[xsrfHeader] = xsrfToken;
      }
    }

    const cacheKey = normalized.cache.ttl > 0
      ? generateCacheKey(rawUrl, opts.params ?? {}, body ?? {})
      : '';

    // Merge per-request signal with client-level dispose signal
    let mergedSignal: AbortSignal | undefined;
    const disposeSig = this.#disposeController.signal;
    if (opts.signal && disposeSig) {
      const m = new AbortController();
      if (opts.signal.aborted || disposeSig.aborted) { m.abort(); }
      else {
        opts.signal.addEventListener('abort', () => m.abort(), { once: true });
        disposeSig.addEventListener('abort', () => m.abort(), { once: true });
      }
      mergedSignal = m.signal;
    } else {
      mergedSignal = opts.signal ?? disposeSig;
    }

    const state: RequestState = {
      request: {
        url,
        method,
        headers,
        body,
        signal: mergedSignal,
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
    const startTime = Date.now();

    const attempt = async (): Promise<T> => {
      try {
        return await this.#executeOnce<T>(state, cacheKey);
      } catch (err) {
        const error = err instanceof ApiError ? err : new NetworkError(
          err instanceof Error ? err.message : String(err),
          { request: state.request, cause: err },
        );

        state.error = error;
        state.retryCount++;

        // Run beforeError hooks
        const errorState = await runBeforeError(this.#hooks, state);

        // Check totalTimeout
        const totalTimeout = state.options.totalTimeout;
        if (totalTimeout != null && Date.now() - startTime > totalTimeout) {
          errorState.error = new ApiError('Total timeout exceeded', {
            code: 'ERR_TIMEOUT',
            status: error.status,
            data: error.data,
            request: state.request,
            response: error.response,
          });
          this.#dispatchEvents(errorState);
          throw errorState.error;
        }

        // Check retry
        if (
          retry !== false &&
          state.retryCount <= (retry.limit ?? DEFAULT_RETRY.limit) &&
          shouldRetry(retry, error.status ?? error.response?.status, state.request.method)
        ) {
          // Run beforeRetry hooks
          const retryResult = await runBeforeRetry(this.#hooks, errorState);
          if (retryResult === stop) throw errorState.error;

          const delay = calcBackoff(retry, state.retryCount);
          await new Promise(r => setTimeout(r, delay));
          state.response = undefined;
          return attempt();
        }

        this.#dispatchEvents(errorState);
        throw errorState.error;
      }
    };

    return attempt();
  }

  async #executeOnce<T>(state: RequestState, cacheKey: string): Promise<T> {
    // 1. beforeRequest hooks
    state = await runBeforeRequest(this.#hooks, state);

    // If beforeRequest hook already set a response, short-circuit
    const shortCircuitResponse = state.response;
    if (shortCircuitResponse) {
      state = await runAfterResponse(this.#hooks, state);
      this.#dispatchEvents(state);
      return shortCircuitResponse.data as T;
    }

    const url = state.request.url;
    const method = state.request.method;
    // Skip dedup for non-serializable bodies (FormData, Blob, File) or when opted out
    const skipDedup = !state.options.dedup || state.request.body instanceof FormData || state.request.body instanceof Blob;
    const bodyHash = !skipDedup && state.request.body ? JSON.stringify(stableNormalize(state.request.body)) : '';
    const dedupKey = skipDedup ? '' : `${method}:${url}:${bodyHash}`;

    // 2. In-flight dedup
    if (dedupKey) {
      const inFlight = this.#inFlight.get(dedupKey);
      if (inFlight) return inFlight as Promise<T>;
    }

    // 3. Cache check
    const cacheMode = state.options.cache.mode;
    const cacheTags = state.options.cache.tags;

    if (cacheKey && this.#cache && !state.options.cache.skip) {
      if (cacheMode === 'swr') {
        const stale = this.#cache.getStale(cacheKey);
        if (stale && !stale.stale) {
          state.cache = { key: cacheKey, hit: true, stale: false };
          return stale.data as T;
        }
        if (stale) {
          state.cache = { key: cacheKey, hit: true, stale: true };
          // Return stale, revalidate in background — failures are silent
          this.#doFetch(state, cacheKey, cacheTags).catch((err: unknown) => {
            if (err instanceof ApiError) {
              if (this.#options.onSwrError) this.#options.onSwrError(err, cacheKey);
            } else {
              console.warn('[@nimble-api/api-service] SWR background revalidation failed', err);
            }
          });
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

    const promise = this.#doFetch<T>(state, cacheKey, cacheTags);

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
      onUploadProgress: state.options.onUploadProgress ?? undefined,
      onDownloadProgress: state.options.onDownloadProgress ?? undefined,
      uploadFieldName: state.options.uploadFieldName ?? undefined,
    });

    state.response = {
      status: response.status,
      data: response.data,
      headers: response.headers,
    };

    // 5. maxContentLength check
    if (state.options.maxContentLength != null) {
      const lenHeader = response.headers['content-length'];
      if (lenHeader) {
        const len = parseInt(lenHeader, 10);
        if (len > state.options.maxContentLength) {
          throw new ApiError(`Response too large: ${len} > ${state.options.maxContentLength}`, {
            code: 'ERR_MAX_SIZE',
            status: response.status,
            data: null,
            request: state.request,
            response: { status: response.status, headers: response.headers },
          });
        }
      }
    }

    // 6. Error status check (before schema — 500s shouldn't waste CPU on validation)
    if (!state.options.validateStatus(response.status)) {
      throw new ApiError(`Request failed with status ${response.status}`, {
        code: response.status >= 400 && response.status < 500 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE',
        status: response.status,
        data: response.data,
        request: state.request,
        response: { status: response.status, headers: response.headers },
      });
    }

    // 7. Schema validation (only on successful status)
    if (state.options.schema) {
      const schema = state.options.schema;
      if (typeof schema.parse === 'function') {
        state.response.data = schema.parse(state.response.data);
      } else if (typeof schema.safeParse === 'function') {
        const result = schema.safeParse(state.response.data);
        if (!result.success) {
          throw new ApiError('Schema validation failed', {
            code: 'ERR_VALIDATION',
            status: response.status,
            data: result.error,
            request: state.request,
            response: { status: response.status, headers: response.headers },
          });
        }
        state.response.data = result.data;
      }
    }

    // 8. afterResponse hooks
    state = await runAfterResponse(this.#hooks, state);

    // 9. Cache store
    if (cacheKey && this.#cache) {
      const cacheOpts = state.options.cache;
      this.#cache.set(cacheKey, state.response!.data, cacheOpts.ttl, cacheTags, cacheOpts.gcTime);
    }

    // 10. Entity cache tags from response
    if (state.options.entities.length > 0 && state.response?.data) {
      this.#extractEntities(state.options.entities, state.response.data);
    }

    // 11. Invalidate tags
    if (state.options.invalidates.length > 0 && this.#cache) {
      this.#cache.invalidateByTags(state.options.invalidates);
    }

    // 12. Dispatch events
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
      retry: mergeRetry(opts.retry, this.#options.retry),
      cache: {
        ttl: reqCache?.ttl ?? clientCache?.ttl ?? DEFAULT_OPTIONS.cache.ttl,
        mode: reqCache?.mode ?? clientCache?.mode ?? DEFAULT_OPTIONS.cache.mode,
        tags: reqCache?.tags ?? [],
        skip: reqCache?.skip ?? false,
        gcTime: reqCache?.gcTime ?? clientCache?.gcTime,
      },
      onSuccess: opts.onSuccess
        ? (Array.isArray(opts.onSuccess) ? opts.onSuccess : [opts.onSuccess])
        : [],
      onError: opts.onError ?? null,
      entities: opts.entities ?? [],
      invalidates: opts.invalidates ?? [],
      schema: opts.schema ?? null,
      validateStatus: opts.validateStatus ?? this.#options.validateStatus ?? DEFAULT_OPTIONS.validateStatus,
      onUploadProgress: opts.onUploadProgress ?? null,
      onDownloadProgress: opts.onDownloadProgress ?? null,
      uploadFieldName: opts.uploadFieldName ?? null,
      totalTimeout: opts.totalTimeout ?? this.#options.totalTimeout ?? DEFAULT_OPTIONS.totalTimeout,
      maxContentLength: opts.maxContentLength ?? this.#options.maxContentLength ?? DEFAULT_OPTIONS.maxContentLength,
      dedup: opts.dedup ?? DEFAULT_OPTIONS.dedup,
    };
  }

  #buildFullUrl(rawUrl: string, opts: RequestOptions): string {
    let url = rawUrl;
    const baseUrl = this.#options.baseUrl ?? '';
    if (opts.params) {
      url = buildUrl(url, opts.params);
    }
    if (opts.searchParams) {
      const serializer = opts.paramsSerializer ?? this.#options.paramsSerializer;
      if (serializer) {
        const qs = serializer(opts.searchParams as Record<string, unknown>);
        if (qs) url = url + (url.includes('?') ? '&' : '?') + qs;
        return baseUrl ? baseUrl + url : url;
      }
      const sp = new URLSearchParams();
      for (const [k, v] of Object.entries(opts.searchParams)) {
        if (v == null) continue;
        if (Array.isArray(v)) {
          for (const item of v) {
            sp.append(k, String(item));
          }
        } else {
          sp.append(k, String(v));
        }
      }
      const qs = sp.toString();
      if (qs) url = url + (url.includes('?') ? '&' : '?') + qs;
    }
    return baseUrl ? baseUrl + url : url;
  }

  #extractBody(opts: RequestOptions): unknown {
    if (opts.json !== undefined) return opts.json;
    if (opts.form !== undefined) return opts.form;
    if (opts.text !== undefined) return opts.text;
    return undefined;
  }

  #extractEntities(entities: Array<{ name: string; idKey?: string; envelopeKey?: string }>, data: unknown): void {
    const envelope = data as Record<string, unknown>;
    const envKey = entities[0]?.envelopeKey ?? 'data';
    const payload = envelope?.[envKey] != null && typeof envelope[envKey] === 'object'
      ? envelope[envKey]
      : data;
    const items = Array.isArray(payload) ? payload : [payload];
    for (const entity of entities) {
      const idKey = entity.idKey ?? 'id';
      for (const item of items) {
        const id = (item as Record<string, unknown>)[idKey];
        if (id != null && this.#cache) {
          const entityKey = `@entity:${entity.name}:${String(id)}`;
          this.#cache.set(entityKey, item, Infinity, [entity.name], 86400000);
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
    if (!state.error && status != null && state.options.validateStatus(status) && state.options.onSuccess.length > 0) {
      for (const key of state.options.onSuccess) {
        try { hub.emit(key, data); } catch (err: unknown) {
          if (this.#options.onEventError) this.#options.onEventError(key, err);
          else console.warn(`[@nimble-api/api-service] Event handler threw for "${key}"`, err);
        }
      }
    }

    // onError
    if (state.options.onError && state.error) {
      const code = typeof state.error.data === 'object' && state.error.data !== null
        ? (state.error.data as Record<string, unknown>).code
        : undefined;
      const eventKey = (code != null ? state.options.onError[code as number] : undefined) ?? state.options.onError.default;
      if (eventKey) {
        try { hub.emit(eventKey, state.error.data); } catch (err: unknown) {
          if (this.#options.onEventError) this.#options.onEventError(eventKey, err);
          else console.warn(`[@nimble-api/api-service] Event handler threw for "${eventKey}"`, err);
        }
      }
    }
  }

  #checkDestroyed(): void {
    if (this.#destroyed) throw new Error('[@nimble-api/api-service] Client is destroyed');
  }
}
