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
}

export interface CacheControl {
  invalidate(opts: { tags?: string[]; key?: string }): void;
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

export type BeforeRequestHook = (state: RequestState) => RequestState | Promise<RequestState>;
export type AfterResponseHook = (state: RequestState) => RequestState | Promise<RequestState>;
export type BeforeRetryHook = (state: RequestState) => RequestState | Promise<RequestState> | typeof stop;
export type BeforeErrorHook = (state: RequestState) => RequestState | Promise<RequestState>;

export interface Hooks {
  beforeRequest?: BeforeRequestHook[];
  afterResponse?: AfterResponseHook[];
  beforeRetry?: BeforeRetryHook[];
  beforeError?: BeforeErrorHook[];
}

// === Request Options ===

export interface RequestOptions {
  params?: Record<string, string | number>;
  searchParams?: Record<string, string | number>;
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
  };
  schema?: SchemaValidator;
  onSuccess?: string | string[];
  onError?: { default: string; [code: number]: string };
  entities?: EntityDef[];
  invalidates?: string[];
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
  };
  onSuccess: string[];
  onError: { default: string; [code: number]: string } | null;
  entities: EntityDef[];
  invalidates: string[];
  schema: SchemaValidator | null;
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

export class ApiError extends Error {
  status: number;
  data: unknown;
  request: { url: string; method: string };
  response?: { status: number; headers: Record<string, string> };

  constructor(message: string, opts: {
    status: number;
    data: unknown;
    request: { url: string; method: string };
    response?: { status: number; headers: Record<string, string> };
  }) {
    super(message);
    this.name = 'ApiError';
    this.status = opts.status;
    this.data = opts.data;
    this.request = opts.request;
    this.response = opts.response;
  }
}

// === Endpoint Spec (for typed API) ===

export interface EndpointSpec {
  url: string;
  method?: string;
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
}

export interface ApiDefinition {
  [name: string]: {
    params?: Record<string, string | number>;
    body?: Record<string, unknown>;
    response?: unknown;
  };
}

export type TypedApi<T extends ApiDefinition> = {
  [K in keyof T & string]: (
    opts?: {
      params?: T[K]['params'];
      body?: T[K]['body'];
    } & Omit<RequestOptions, 'json' | 'form' | 'text'>,
  ) => Promise<T[K]['response']>;
};
