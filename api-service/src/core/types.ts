// EventHub 实例引用（避免循环类型依赖）
interface EventBusLike {
  emit: (event: string, payload: unknown) => unknown;
  on: (event: string, handler: (...args: unknown[]) => void) => () => void;
}

export interface EndpointConfig {
  url: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'PATCH' | 'UPLOAD';
  headers?: Record<string, string>;

  cacheTTL?: number;
  cacheMode?: 'ttl' | 'swr';

  entities?: EntityDefinition[];
  invalidates?: string[];

  retry?: RetryConfig;

  schema?: unknown;

  onSuccess?: string[];
  onError?: { default: string; [code: number]: string };

  optimistic?: OptimisticConfig;
}

export interface EntityDefinition {
  name: string;
  idKey?: string;
}

export interface RetryConfig {
  count: number;
  backoff?: 'fixed' | 'exponential';
  baseDelay?: number;
  maxDelay?: number;
}

export interface OptimisticConfig {
  update: (current: unknown, params: unknown) => unknown;
  rollback?: (previous: unknown) => void;
}

export type ApiConfig = Record<string, EndpointConfig>;

export interface CallOptions {
  signal?: AbortSignal;
  skipCache?: boolean;
  debounce?: number;
  throttle?: number;
  lock?: boolean;
  lockThrow?: boolean;
}

export interface ApiMethod<TRes = unknown> {
  (params?: Record<string, string | number>, body?: Record<string, unknown>, opts?: CallOptions): Promise<TRes>;
  with(opts: CallOptions): ApiMethod<TRes>;
}

export interface RequestContext {
  apiKey: string;
  config: EndpointConfig;
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
  params: Record<string, string | number>;
  opts: CallOptions;
  signal?: AbortSignal;
  timeout: number;
}

export interface ResponseContext {
  apiKey: string;
  config: EndpointConfig;
  status: number;
  data: unknown;
  headers: Record<string, string>;
  fromCache: boolean;
  stale: boolean;
}

export interface ErrorContext {
  apiKey: string;
  config: EndpointConfig;
  error: Error;
  attempt: number;
}

export interface ApiPlugin {
  name: string;
  onRequest?(ctx: RequestContext): RequestContext | Promise<RequestContext>;
  onResponse?(ctx: ResponseContext): ResponseContext | Promise<ResponseContext>;
  onError?(ctx: ErrorContext): ErrorContext | Promise<ErrorContext>;
  setup?(client: unknown): void;
  teardown?(): void;
}

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
}

export interface AdapterResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

export interface ApiClientSettings {
  adapter?: RequestAdapter;
  plugins?: ApiPlugin[];
  eventHub?: EventBusLike;
  timeout?: number;
  enableLogging?: boolean;
}
