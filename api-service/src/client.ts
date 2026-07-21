import { MemoryCache } from './core/cache';
import { buildUrl } from './utils/url-builder';
import { generateCacheKey, stableNormalize } from './utils/cache-key';
import { bodyToQueryString } from './utils/body-to-qs';
import { createFetchAdapter } from './adapters/fetch';
import { runBeforeRequest, runAfterResponse, runBeforeRetry, runBeforeError, runInitHooks } from './hooks';
import { calcBackoff, shouldRetry, DEFAULT_RETRY } from './retry';
import { stop, NetworkError } from './core/types';
import { readCookie } from './utils/cookie';
import type { BusinessResult } from './core/types';
import type {
  ApiOptions,
  RequestOptions,
  RequestState,
  NormalizedRequestOptions,
  RequestAdapter,
  Hooks,
  CacheControl,
  EventHubLike,
  TransformResponseFn,
  ResponseParser,
} from './core/types';
import { ApiError } from './core/types';

/**
 * 默认业务解析器 — 识别 {code, msg, result} 统一格式。
 *   code = 0 / '0' / undefined / null  → 成功，解包 result（若存在）
 *   code = 非0                          → 失败，提取 code + msg
 *   非对象                              → 成功，原样返回
 */
export function defaultParser(response: {
  status: number;
  data: unknown;
}): BusinessResult {
  const d = response.data as Record<string, unknown> | null;
  if (!d || typeof d !== 'object') {
    return { ok: true, data: response.data };
  }

  const code = d['code'];
  const isSuccess =
    code === 0 || code === '0' || code === undefined || code === null;

  if (!isSuccess) {
    return {
      ok: false,
      businessCode: code !== undefined ? String(code) : undefined,
      businessMessage:
        (d['msg'] as string) || (d['message'] as string) || '未知错误',
    };
  }

  if ('result' in d) return { ok: true, data: d['result'] };
  return { ok: true, data: response.data };
}

/**
 * 预设结果包装器 — 成功时将解包数据包装为结构化 ApiResult。
 *
 * @example
 * // 无参数 — 内部使用 defaultParser
 * createApiClient({ parser: createResultParser() })
 *
 * @example
 * // 传入自定义 innerParser
 * createApiClient({ parser: createResultParser(myAbpParser) })
 *
 * @param innerParser 可选的内部解析器，不传则使用 defaultParser
 */
export function createResultParser(innerParser?: ResponseParser): ResponseParser {
  return async (resp) => {
    const parsed = innerParser
      ? await innerParser(resp)
      : defaultParser(resp);

    // 失败透传 — 框架后续抛 ERR_BUSINESS
    if (!parsed.ok) return parsed;

    // 从响应体提取元信息
    let businessCode: string | number = 0;
    let businessMessage = 'ok';
    const d = resp.data as Record<string, unknown> | null;
    if (d && typeof d === 'object') {
      const code = d['code'];
      if (code !== undefined && code !== null) {
        businessCode = code as string | number;
      }
      businessMessage =
        (d['msg'] as string) || (d['message'] as string) || businessMessage;
    }

    return {
      ok: true,
      data: {
        ok: true as const,
        httpStatus: resp.status,
        businessCode,
        businessMessage,
        data: parsed.data,
      },
    };
  };
}

function calcBodySize(body: unknown): number {
  if (typeof body === 'string') return new TextEncoder().encode(body).byteLength;
  if (body instanceof Uint8Array) return body.byteLength;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (body instanceof FormData) {
    let size = 0;
    body.forEach((value) => {
      if (typeof value === 'string') {
        size += new TextEncoder().encode(value).byteLength;
      } else if (value instanceof Blob) {
        size += value.size;
      }
    });
    return size;
  }
  return 0;
}

function joinUrl(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
}

const BODY_AS_QS_METHODS = new Set(['GET', 'HEAD', 'DELETE', 'OPTIONS']);

function abortError(): Error {
  return new DOMException('The request was aborted', 'AbortError');
}

function interruptibleSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(timer);
      reject(abortError());
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

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
  maxBodyLength: null,
  deleteBodyMode: 'query' as const,
  dedup: true,
  transformResponse: null,
  parser: null,
  autoErrorEvents: true,
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
  #dispatchEvents: (state: RequestState) => void;

  constructor(options: ApiOptions = {}) {
    this.#options = { ...options };
    this.#adapter = options.adapter ?? createFetchAdapter();
    this.#hooks = { ...options.hooks };
    this.#eventHub = options.eventHub;

    if (options.cache !== false) {
      this.#cache = new MemoryCache(options.cache?.maxSize ?? Infinity);
    }

    // 惰性绑定 — 构造时决定 dispatch 版本，热路径零分支
    const autoEvents = options.autoErrorEvents !== false;
    const hub = options.eventHub;
    if (hub && autoEvents) {
      this.#dispatchEvents = (s) => { this.#dispatchVanilla(s); this.#emitAutoError(s, hub); };
    } else {
      this.#dispatchEvents = this.#dispatchVanilla;
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
    let url = this.#buildFullUrl(rawUrl, opts);
    let body = this.#extractBody(opts);

    if (body != null && typeof body === 'object' && !Array.isArray(body) &&
        !(body instanceof FormData) &&
        BODY_AS_QS_METHODS.has(method) &&
        normalized.deleteBodyMode === 'query') {
      const qs = bodyToQueryString(body);
      if (qs) url = url + (url.includes('?') ? '&' : '?') + qs;
      body = undefined;
    }

    // Build initial request state
    const headers: Record<string, string> = {
      ...this.#options.headers,
      ...opts.headers,
    };
    if (body != null && !(body instanceof FormData)) {
      const hasContentType = Object.keys(headers).some(k => k.toLowerCase() === 'content-type');
      if (!hasContentType) {
        headers['Content-Type'] = typeof body === 'string' ? 'text/plain;charset=UTF-8' : 'application/json';
      }
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

    // cacheKey = '' when ttl <= 0 — acts as sentinel: all downstream if(cacheKey) checks skip caching
    const cacheKey = normalized.cache.ttl > 0 && !normalized.cache.skip
      ? generateCacheKey(rawUrl, opts.params ?? {}, body ?? {}, opts.searchParams ?? {}, method)
      : '';

    // Merge per-request signal with client-level dispose signal
    let mergedSignal: AbortSignal | undefined;
    let cleanupMergedSignal: (() => void) | undefined;
    const disposeSig = this.#disposeController.signal;
    if (opts.signal && disposeSig) {
      const m = new AbortController();
      if (opts.signal.aborted || disposeSig.aborted) { m.abort(); }
      else {
        const onOptsAbort = (): void => m.abort();
        const onDisposeAbort = (): void => m.abort();
        opts.signal.addEventListener('abort', onOptsAbort, { once: true });
        disposeSig.addEventListener('abort', onDisposeAbort, { once: true });
        cleanupMergedSignal = () => {
          opts.signal!.removeEventListener('abort', onOptsAbort);
          disposeSig.removeEventListener('abort', onDisposeAbort);
        };
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

    // Skip dedup for non-serializable bodies (FormData, Blob, File) or when opted out.
    // dedup 共享语义：后加入者复用首个发起者的完整请求（含重试），其自身 options/signal/hooks 不生效。
    const skipDedup = !normalized.dedup || body instanceof FormData || body instanceof Blob;
    const bodyHash = !skipDedup && body ? JSON.stringify(stableNormalize(body)) : '';
    const dedupKey = skipDedup ? '' : `${method}:${url}:${bodyHash}`;

    if (dedupKey) {
      const existing = this.#inFlight.get(dedupKey);
      if (existing) {
        cleanupMergedSignal?.();
        return existing as Promise<T>;
      }
    }

    const promise = this.#executeWithRetry<T>(state, cacheKey);

    if (dedupKey) this.#inFlight.set(dedupKey, promise);
    if (dedupKey || cleanupMergedSignal) {
      const onSettle = (): void => {
        if (dedupKey) this.#inFlight.delete(dedupKey);
        cleanupMergedSignal?.();
      };
      void promise.then(onSettle, onSettle);
    }

    return promise;
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

        // Business errors should never be retried
        if (error.code === 'ERR_BUSINESS') {
          this.#dispatchEvents(errorState);
          throw errorState.error;
        }

        // Check retry — skip if signal already aborted (e.g. dispose() called mid-request)
        if (
          retry !== false &&
          !state.request.signal?.aborted &&
          state.retryCount <= (retry.limit ?? DEFAULT_RETRY.limit) &&
          shouldRetry(retry, error.status ?? error.response?.status, state.request.method)
        ) {
          // Run beforeRetry hooks
          const retryResult = await runBeforeRetry(this.#hooks, errorState);
          if (retryResult === stop) throw errorState.error;

          const delay = calcBackoff(retry, state.retryCount);
          await interruptibleSleep(delay, state.request.signal);
          if (state.request.signal?.aborted) throw abortError();
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

    // 2. Cache check
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
          // Return stale, revalidate in background — failures are silent.
          // revalidate: 前缀 key 与请求 dedupKey 命名空间隔离，并发 stale 命中只触发一次后台请求。
          const revalidateKey = `revalidate:${cacheKey}`;
          if (!this.#inFlight.has(revalidateKey)) {
            const revalidation = this.#doFetch(state, cacheKey, cacheTags)
              .catch((err: unknown) => {
                if (err instanceof ApiError) {
                  if (this.#options.onSwrError) this.#options.onSwrError(err, cacheKey);
                } else {
                  console.warn('[@nimble-api/api-service] SWR background revalidation failed', err);
                }
              })
              .finally(() => {
                this.#inFlight.delete(revalidateKey);
              });
            this.#inFlight.set(revalidateKey, revalidation);
          }
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

    return this.#doFetch<T>(state, cacheKey, cacheTags);
  }

  async #doFetch<T>(
    state: RequestState,
    cacheKey: string,
    cacheTags: string[],
  ): Promise<T> {
    // 4. Check maxBodyLength
    if (state.options.maxBodyLength != null && state.request.body != null) {
      const bodySize = calcBodySize(state.request.body);
      if (bodySize > state.options.maxBodyLength) {
        throw new ApiError(`Request body too large: ${bodySize} > ${state.options.maxBodyLength}`, {
          code: 'ERR_MAX_SIZE',
          status: 0,
          data: { maxBodyLength: state.options.maxBodyLength, actual: bodySize },
          request: state.request,
        });
      }
    }

    // 5. Actually fetch
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
      deleteBodyMode: state.options.deleteBodyMode,
    });

    state.response = {
      status: response.status,
      data: response.data,
      headers: response.headers,
    };

    // 5a. transformResponse — 归一化后端响应格式
    if (state.options.transformResponse) {
      try {
        const transformed = await state.options.transformResponse({
          status: state.response.status,
          data: state.response.data,
          headers: state.response.headers,
        });
        state.response = {
          status: transformed.status,
          data: transformed.data,
          headers: transformed.headers,
        };
      } catch (err) {
        throw new ApiError(
          err instanceof Error ? err.message : 'transformResponse error',
          {
            code: 'ERR_BAD_RESPONSE',
            status: state.response.status,
            data: state.response.data,
            request: state.request,
            response: state.response,
            cause: err,
          },
        );
      }
    }

    // 6. maxContentLength check
    if (state.options.maxContentLength != null) {
      const lenHeader = state.response.headers['content-length'];
      if (lenHeader) {
        const len = parseInt(lenHeader, 10);
        if (len > state.options.maxContentLength) {
          throw new ApiError(`Response too large: ${len} > ${state.options.maxContentLength}`, {
            code: 'ERR_MAX_SIZE',
            status: state.response.status,
            data: null,
            request: state.request,
            response: { status: state.response.status, headers: state.response.headers },
          });
        }
      }
    }

    // 7. Error status check (before schema — 500s shouldn't waste CPU on validation)
    if (!state.options.validateStatus(state.response.status)) {
      const effectiveParser = state.options.parser ?? defaultParser;
      let parsed: BusinessResult | null = null;
      try {
        parsed = await effectiveParser({
          status: state.response.status,
          data: state.response.data,
          headers: state.response.headers,
        });
      } catch { /* parser throw on error response → ignore, use default message */ }

      throw new ApiError(
        (!parsed?.ok && parsed?.businessMessage) || `Request failed with status ${state.response.status}`,
        {
          code: state.response.status >= 400 && state.response.status < 500 ? 'ERR_BAD_REQUEST' : 'ERR_BAD_RESPONSE',
          status: state.response.status,
          data: state.response.data,
          request: state.request,
          response: { status: state.response.status, headers: state.response.headers },
          businessCode: !parsed?.ok ? parsed?.businessCode : undefined,
          businessMessage: !parsed?.ok ? parsed?.businessMessage : undefined,
        },
      );
    }

    // 7a. Business result parse — HTTP 成功后判断业务成功/失败
    const effectiveParser = state.options.parser ?? defaultParser;
    let businessResult: BusinessResult | null = null;
    try {
      businessResult = await effectiveParser({
        status: state.response.status,
        data: state.response.data,
        headers: state.response.headers,
      });
    } catch {
      // parser 异常让它抛，走 beforeError + retry
    }

    if (businessResult && !businessResult.ok) {
      throw new ApiError(
        businessResult.businessMessage || '业务错误',
        {
          code: 'ERR_BUSINESS',
          status: state.response.status,
          data: state.response.data,
          request: state.request,
          response: {
            status: state.response.status,
            headers: state.response.headers,
          },
          businessCode: businessResult.businessCode,
          businessMessage: businessResult.businessMessage,
        },
      );
    }

    // 成功：data 替换为解析后的值
    if (businessResult?.ok && businessResult.data !== undefined) {
      state.response.data = businessResult.data;
    }

    // 8. Schema validation (only on successful status)
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

    // 9. afterResponse hooks
    state = await runAfterResponse(this.#hooks, state);

    // 10. Cache store
    if (cacheKey && this.#cache) {
      const cacheOpts = state.options.cache;
      this.#cache.set(cacheKey, state.response!.data, cacheOpts.ttl, cacheTags, cacheOpts.gcTime);
    }

    // 11. Entity cache tags from response
    if (state.options.entities.length > 0 && state.response?.data) {
      this.#extractEntities(state.options.entities, state.response.data);
    }

    // 12. Invalidate tags
    if (state.options.invalidates.length > 0 && this.#cache) {
      this.#cache.invalidateByTags(state.options.invalidates);
    }

    // 13. Dispatch events
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
      maxBodyLength: opts.maxBodyLength ?? this.#options.maxBodyLength ?? DEFAULT_OPTIONS.maxBodyLength,
      deleteBodyMode: opts.deleteBodyMode ?? this.#options.deleteBodyMode ?? DEFAULT_OPTIONS.deleteBodyMode,
      dedup: opts.dedup ?? DEFAULT_OPTIONS.dedup,
      transformResponse:
        opts.transformResponse
        ?? this.#options.transformResponse
        ?? DEFAULT_OPTIONS.transformResponse,
      parser:
        opts.parser
        ?? this.#options.parser
        ?? DEFAULT_OPTIONS.parser,
      autoErrorEvents:
        this.#options.autoErrorEvents ?? DEFAULT_OPTIONS.autoErrorEvents,
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
        return baseUrl ? joinUrl(baseUrl, url) : url;
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
    return baseUrl ? joinUrl(baseUrl, url) : url;
  }

  #extractBody(opts: RequestOptions): unknown {
    if (opts.json !== undefined) return opts.json;
    if (opts.form !== undefined) return opts.form;
    if (opts.text !== undefined) return opts.text;
    return undefined;
  }

  #extractEntities(entities: Array<{ name: string; idKey?: string; envelopeKey?: string }>, data: unknown): void {
    const envelope = data as Record<string, unknown>;
    for (const entity of entities) {
      const envKey = entity.envelopeKey ?? 'data';
      const payload = envelope?.[envKey] != null && typeof envelope[envKey] === 'object'
        ? envelope[envKey]
        : data;
      const items = Array.isArray(payload) ? payload : [payload];
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

  #dispatchVanilla(state: RequestState): void {
    const hub = this.#eventHub;
    if (!hub) return;

    const data = state.response?.data;
    const status = state.response?.status;

    // onSuccess — only fire on actual success, not when error is set
    if (state.options.onSuccess.length > 0 && !state.error && status != null && state.options.validateStatus(status)) {
      for (const key of state.options.onSuccess) {
        try { hub.emit(key, data); } catch (err: unknown) {
          if (this.#options.onEventError) this.#options.onEventError(key, err);
          else console.warn(`[@nimble-api/api-service] Event handler threw for "${key}"`, err);
        }
      }
    }

    // onError
    if (state.options.onError && state.error) {
      const code = state.error.businessCode
        ?? (typeof state.error.data === 'object' && state.error.data !== null
          ? (state.error.data as Record<string, unknown>).code
          : undefined);
      const eventKey = (code != null ? state.options.onError[String(code)] : undefined) ?? state.options.onError.default;
      if (eventKey) {
        const payload = {
          code: state.error.businessCode ?? code,
          message: state.error.businessMessage ?? state.error.message,
        };
        try { hub.emit(eventKey, payload); } catch (err: unknown) {
          if (this.#options.onEventError) this.#options.onEventError(eventKey, err);
          else console.warn(`[@nimble-api/api-service] Event handler threw for "${eventKey}"`, err);
        }
      }
    }
  }

  #emitAutoError(state: RequestState, hub: EventHubLike): void {
    if (!state.error?.businessCode) return;
    const payload = {
      code: state.error.businessCode,
      message: state.error.businessMessage ?? state.error.message,
    };
    try { hub.emit(`error:${state.error.businessCode}`, payload); } catch (err: unknown) {
      if (this.#options.onEventError) this.#options.onEventError(`error:${state.error.businessCode}`, err);
      else console.warn(`[@nimble-api/api-service] Event handler threw for "error:${state.error.businessCode}"`, err);
    }
  }

  #checkDestroyed(): void {
    if (this.#destroyed) throw new Error('[@nimble-api/api-service] Client is destroyed');
  }
}
