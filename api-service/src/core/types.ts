// === Schema ===

export interface SchemaValidator {
  parse?: (data: unknown) => unknown;
  safeParse?: (data: unknown) => { success: boolean; data: unknown; error?: unknown };
}

// === Request Body ===

export type DeleteBodyMode = 'query' | 'json';

// === Entity ===

export interface EntityDef {
  name: string;
  idKey?: string;
  /** Response envelope key containing the entity array. Default `'data'`. */
  envelopeKey?: string;
}

// === Retry ===

export interface RetryConfig {
  limit?: number;
  methods?: string[];
  statusCodes?: number[];
  backoff?: 'fixed' | 'exponential';
  baseDelay?: number;
  maxDelay?: number;
}

// === Cache ===

export interface CacheOptions {
  ttl?: number;
  mode?: 'ttl' | 'swr';
  maxSize?: number;
  gcTime?: number;
}

export interface CacheControl {
  invalidate(opts: { tags?: string[]; key?: string; keyPrefix?: string }): void;
  clear(): void;
}

// === Hooks ===

export interface RequestState {
  request: {
    url: string;
    method: string;
    headers: Record<string, string>;
    body?: unknown;
    signal?: AbortSignal;
  };
  response?: {
    status: number;
    data: unknown;
    headers: Record<string, string>;
  };
  error?: ApiError;
  retryCount: number;
  options: NormalizedRequestOptions;
  cache?: {
    key: string;
    hit: boolean;
    stale: boolean;
  };
  meta: Record<string, unknown>;
}

export const stop: unique symbol = Symbol('nimble-api:stop');

export type InitHook = (opts: RequestOptions) => RequestOptions | Promise<RequestOptions>;
export type BeforeRequestHook = (state: RequestState) => RequestState | Promise<RequestState>;
export type AfterResponseHook = (state: RequestState) => RequestState | Promise<RequestState>;
export type BeforeRetryHook = (state: RequestState) => RequestState | Promise<RequestState> | typeof stop;
export type BeforeErrorHook = (state: RequestState) => RequestState | Promise<RequestState>;

export interface Hooks {
  init?: InitHook[];
  beforeRequest?: BeforeRequestHook[];
  afterResponse?: AfterResponseHook[];
  beforeRetry?: BeforeRetryHook[];
  beforeError?: BeforeErrorHook[];
}

// === Request Options ===

export interface RequestOptions {
  params?: Record<string, string | number | boolean | (string | number | boolean)[] | null | undefined>;
  searchParams?: Record<string, string | number | boolean | (string | number | boolean)[] | null | undefined>;
  json?: unknown;
  form?: FormData;
  text?: string;
  method?: string;
  headers?: Record<string, string>;
  /** 取消信号。注意：请求被 dedup 合并时仅首个发起者的 signal 生效，后加入者的 signal 被忽略。 */
  signal?: AbortSignal;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
  retry?: RetryConfig | false;
  cache?: {
    ttl?: number;
    mode?: 'ttl' | 'swr';
    tags?: string[];
    skip?: boolean;
    gcTime?: number;
  };
  schema?: SchemaValidator;
  onSuccess?: string | string[];
  onError?: { default: string; [code: string]: string };
  entities?: EntityDef[];
  invalidates?: string[];
  validateStatus?: (status: number) => boolean;
  onUploadProgress?: (progress: { loaded: number; total: number }) => void;
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
  uploadFieldName?: string;
  totalTimeout?: number;
  paramsSerializer?: (params: Record<string, unknown>) => string;
  maxContentLength?: number;
  maxBodyLength?: number;
  /** Control how DELETE/GET/HEAD/OPTIONS body is handled. 'query' = convert to search params (default), 'json' = send as JSON body. */
  deleteBodyMode?: DeleteBodyMode;
  /** Limit concurrent calls. true/1 = one-at-a-time; N = allow up to N concurrent. Calls beyond the limit return null. */
  lock?: boolean | number;
  /** Override per-call — debounce in ms, or `{ wait, abort }` to cancel in-flight. `false` to disable */
  debounce?: number | false | { wait: number; abort?: boolean };
  /** Override per-call — throttle in ms, or `{ wait, edge }` for edge control. `false` to disable endpoint default */
  throttle?: number | false | { wait: number; edge?: 'leading' | 'trailing' | 'both' };
  /** Skip in-flight request deduplication for this call. dedup 开启时相同请求共享首个发起者的完整生命周期（含重试与缓存写入），后加入者的 options/hooks/signal 不生效。 */
  dedup?: boolean;
  /** 响应守卫 — adapter 返回后立即执行，早于 validateStatus/hooks。归一化后端差异。 */
  transformResponse?: TransformResponseFn;
  /** 业务解析器 — validateStatus 通过后判断业务成功/失败并解包。覆盖客户端级 parser。 */
  parser?: ResponseParser;
}

// === Normalized Options (internal, all defaults filled) ===

export interface NormalizedRequestOptions {
  baseUrl: string;
  timeout: number;
  responseType: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
  retry: RetryConfig | false;
  cache: {
    ttl: number;
    mode: 'ttl' | 'swr';
    tags: string[];
    skip: boolean;
    gcTime?: number;
  };
  onSuccess: string[];
  onError: { default: string; [code: string]: string } | null;
  entities: EntityDef[];
  invalidates: string[];
  schema: SchemaValidator | null;
  validateStatus: (status: number) => boolean;
  onUploadProgress: ((progress: { loaded: number; total: number }) => void) | null;
  onDownloadProgress: ((progress: { loaded: number; total: number }) => void) | null;
  uploadFieldName: string | null;
  totalTimeout: number | null;
  maxContentLength: number | null;
  maxBodyLength: number | null;
  deleteBodyMode: DeleteBodyMode;
  dedup: boolean;
  transformResponse: TransformResponseFn | null;
  parser: ResponseParser | null;
  autoErrorEvents: boolean;
}

// === Client Options ===

export interface ApiOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  timeout?: number;
  retry?: RetryConfig | false;
  cache?: CacheOptions | false;
  adapter?: RequestAdapter;
  hooks?: Hooks;
  eventHub?: EventHubLike;
  validateStatus?: (status: number) => boolean;
  totalTimeout?: number;
  paramsSerializer?: (params: Record<string, unknown>) => string;
  maxContentLength?: number;
  maxBodyLength?: number;
  deleteBodyMode?: DeleteBodyMode;
  xsrfCookieName?: string;
  xsrfHeaderName?: string;
  /** Set to false to disable automatic XSRF cookie-to-header injection. Default true. */
  xsrf?: boolean;
  /** Called when a stale-while-revalidate background refresh fails. */
  onSwrError?: (error: ApiError, key: string) => void;
  /** Called when an eventHub emit throws (e.g., handler bug). Default logs console.warn. */
  onEventError?: (event: string, error: unknown) => void;
  /**
   * 响应守卫 — adapter 返回后立即执行，早于 validateStatus 和所有 hooks。
   * 用于归一化不同后端的响应格式（ABP / 通用 {code,msg,result} / 自定义）。
   * 返回值覆盖 status、data、headers 三字段。抛异常 = 中断请求。
   */
  transformResponse?: TransformResponseFn;
  /**
   * 自动发射 error:{businessCode} 事件。默认 true。
   * 当 onError 未匹配到显式 key 时，自动 emit 'error:{businessCode}'。
   * 设为 false 则只发射 onError 显式声明的事件。
   */
  autoErrorEvents?: boolean;
  /**
   * 业务解析器 — validateStatus 通过后执行。
   * 判断业务成功/失败并解包响应体。
   * 默认内置 parser 识别 {code, msg, result} 统一格式。
   */
  parser?: ResponseParser;
}

// === Transform Response ===

/** adapter 返回的原始响应结构 */
export interface RawResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

/**
 * 响应守卫 — adapter 返回后立即执行，早于 validateStatus 和所有 hooks。
 * 用于归一化不同后端的响应格式。
 * 返回修改后的 response（可改 status/data/headers）；抛异常中断请求。
 */
export type TransformResponseFn = (response: RawResponse) => RawResponse | Promise<RawResponse>;

// === Response Parser ===

/** parser 返回结果 */
export interface BusinessResult {
  ok: boolean;
  /** ok=true 时解包后的业务数据 */
  data?: unknown;
  /** ok=false 时业务错误码 */
  businessCode?: string;
  /** ok=false 时业务错误消息 */
  businessMessage?: string;
}

/**
 * 业务解析器 — validateStatus 通过后执行。
 * 从 HTTP 200 响应体中判断业务成功/失败并解包。
 * 默认内置 parser 识别 {code, msg, result} 统一格式。
 */
export type ResponseParser = (
  response: { status: number; data: unknown; headers: Record<string, string> },
) => BusinessResult | Promise<BusinessResult>;

/**
 * 统一返回结构 — 配合 createResultParser 使用。
 * 成功时包含 httpStatus / businessCode / businessMessage / data。
 */
export interface ApiResult<T = unknown> {
  ok: true;
  httpStatus: number;
  businessCode: string | number;
  businessMessage: string;
  data: T;
}

// === Adapter ===

export interface RequestAdapter {
  request(config: AdapterRequestConfig): Promise<AdapterResponse>;
}

export interface AdapterRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
  onUploadProgress?: (progress: { loaded: number; total: number }) => void;
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
  /** Form field name for file upload (UniApp adapter). Default `'file'`. */
  uploadFieldName?: string;
  maxBodyLength?: number;
  connectTimeout?: number;
  socketPath?: string;
  deleteBodyMode?: DeleteBodyMode;
}

export interface AdapterResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

// === EventHub (minimal interface, avoids circular dependency) ===

export interface EventHubLike {
  emit: (event: string, payload: unknown) => void;
  on: (event: string, handler: (payload: unknown) => void) => () => void;
}

// === Error ===

export type ApiErrorCode =
  | 'ERR_NETWORK'
  | 'ERR_BAD_REQUEST'
  | 'ERR_BAD_RESPONSE'
  | 'ERR_TIMEOUT'
  | 'ERR_ABORTED'
  | 'ERR_VALIDATION'
  | 'ERR_MAX_SIZE'
  | 'ERR_BUSINESS'
  | 'ERR_UNKNOWN';

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;
  data: unknown;
  request: { url: string; method: string };
  response?: { status: number; headers: Record<string, string> };
  /** parser 提取的业务错误码 */
  businessCode?: string;
  /** parser 提取的业务错误消息 */
  businessMessage?: string;

  constructor(message: string, opts: {
    code?: ApiErrorCode;
    status: number;
    data: unknown;
    request: { url: string; method: string };
    response?: { status: number; headers: Record<string, string> };
    cause?: unknown;
    businessCode?: string;
    businessMessage?: string;
  }) {
    super(message, { cause: opts.cause });
    this.name = 'ApiError';
    this.code = opts.code ?? 'ERR_UNKNOWN';
    this.status = opts.status;
    this.data = opts.data;
    this.request = opts.request;
    this.response = opts.response;
    this.businessCode = opts.businessCode;
    this.businessMessage = opts.businessMessage;
  }
}

export class NetworkError extends ApiError {
  name = 'NetworkError';

  constructor(message: string, opts: { request: { url: string; method: string }; cause?: unknown }) {
    super(message, {
      code: 'ERR_NETWORK',
      status: 0,
      data: null,
      request: opts.request,
      cause: opts.cause,
    });
  }
}

// === Endpoint Spec (for typed API) ===

/**
 * 请求 loading 计数引用（兼容 Vue 的 ref<number>：具 value 属性）。
 * 前端 `pending: someRef` 传入，请求发出时 value++、settle 时 value--。
 */
export interface PendingRef {
  value: number;
}

export interface EndpointSpec<
  TParams = unknown,
  TResponse = unknown,
  TBody = unknown,
> {
  url: string;
  method?: string;
  /** Phantom field — only used for parameter type inference, never accessed at runtime */
  _params?: TParams;
  /** Phantom field — only used for response type inference, never accessed at runtime */
  _response?: TResponse;
  /** Phantom field — only used for body type inference, never accessed at runtime */
  _body?: TBody;
  /** Limit concurrent calls. true/1 = one-at-a-time; N = allow up to N concurrent. */
  lock?: boolean | number;
  /** Debounce in ms, or `{ wait, abort }`. `abort: true` cancels in-flight HTTP requests. Suppressed calls resolve to null. */
  debounce?: number | { wait: number; abort?: boolean };
  /** Throttle in ms, or `{ wait, edge }` for edge control. Suppressed calls return null. */
  throttle?: number | { wait: number; edge?: 'leading' | 'trailing' | 'both' };
  cache?: RequestOptions['cache'];
  retry?: RequestOptions['retry'];
  schema?: SchemaValidator;
  onSuccess?: string | string[];
  onError?: { default: string; [code: string]: string };
  entities?: EntityDef[];
  invalidates?: string[];
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: RequestOptions['responseType'];
  validateStatus?: (status: number) => boolean;
  /** 响应守卫 — 覆盖客户端级 transformResponse */
  transformResponse?: TransformResponseFn;
  /** 业务解析器 — 覆盖客户端级 parser */
  parser?: ResponseParser;
}

