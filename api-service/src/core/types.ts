declare global {
  interface SymbolConstructor {
    readonly dispose: unique symbol;
    readonly asyncDispose: unique symbol;
  }
}

// === Schema ===

export interface SchemaValidator {
  parse?: (data: unknown) => unknown;
  safeParse?: (data: unknown) => { success: boolean; data: unknown; error?: unknown };
}

// === Entity ===

export interface EntityDef {
  name: string;
  idKey?: string;
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
  params?: Record<string, string | number>;
  searchParams?: Record<string, string | number | (string | number)[] | null | undefined>;
  json?: unknown;
  form?: FormData;
  text?: string;
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer';
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
  onError?: { default: string; [code: number]: string };
  entities?: EntityDef[];
  invalidates?: string[];
  validateStatus?: (status: number) => boolean;
  onUploadProgress?: (progress: { loaded: number; total: number }) => void;
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
  totalTimeout?: number;
  paramsSerializer?: (params: Record<string, unknown>) => string;
  maxContentLength?: number;
}

// === Normalized Options (internal, all defaults filled) ===

export interface NormalizedRequestOptions {
  baseUrl: string;
  timeout: number;
  responseType: 'json' | 'text' | 'blob' | 'arrayBuffer';
  retry: RetryConfig | false;
  cache: {
    ttl: number;
    mode: 'ttl' | 'swr';
    tags: string[];
    skip: boolean;
    gcTime?: number;
  };
  onSuccess: string[];
  onError: { default: string; [code: number]: string } | null;
  entities: EntityDef[];
  invalidates: string[];
  schema: SchemaValidator | null;
  validateStatus: (status: number) => boolean;
  onUploadProgress: ((progress: { loaded: number; total: number }) => void) | null;
  onDownloadProgress: ((progress: { loaded: number; total: number }) => void) | null;
  totalTimeout: number | null;
  maxContentLength: number | null;
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
  xsrfCookieName?: string;
  xsrfHeaderName?: string;
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
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer';
  onUploadProgress?: (progress: { loaded: number; total: number }) => void;
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
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
  | 'ERR_UNKNOWN';

export class ApiError extends Error {
  code: ApiErrorCode;
  status: number;
  data: unknown;
  request: { url: string; method: string };
  response?: { status: number; headers: Record<string, string> };

  constructor(message: string, opts: {
    code?: ApiErrorCode;
    status: number;
    data: unknown;
    request: { url: string; method: string };
    response?: { status: number; headers: Record<string, string> };
  }) {
    super(message);
    this.name = 'ApiError';
    this.code = opts.code ?? 'ERR_UNKNOWN';
    this.status = opts.status;
    this.data = opts.data;
    this.request = opts.request;
    this.response = opts.response;
  }
}

export class NetworkError extends ApiError {
  name = 'NetworkError';

  constructor(message: string, opts: { request: { url: string; method: string } }) {
    super(message, {
      code: 'ERR_NETWORK',
      status: 0,
      data: null,
      request: opts.request,
    });
  }
}

// === Endpoint Spec (for typed API) ===

export interface EndpointSpec<
  TParams extends Record<string, string | number> | undefined = undefined,
  TResponse = unknown,
> {
  url: string;
  method?: string;
  /** Phantom field — only used for parameter type inference, never accessed at runtime */
  _params?: TParams;
  /** Phantom field — only used for response type inference, never accessed at runtime */
  _response?: TResponse;
  /** Prevent concurrent calls to this endpoint. While a call is in-flight, subsequent calls return null immediately. */
  lock?: boolean;
  cache?: RequestOptions['cache'];
  retry?: RequestOptions['retry'];
  schema?: SchemaValidator;
  onSuccess?: string | string[];
  onError?: { default: string; [code: number]: string };
  entities?: EntityDef[];
  invalidates?: string[];
  headers?: Record<string, string>;
  timeout?: number;
  responseType?: RequestOptions['responseType'];
  validateStatus?: (status: number) => boolean;
}

