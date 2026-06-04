# 类型系统参考

API Service 提供完整的 TypeScript 类型导出，以下是全部公共类型。

## 客户端配置

### `ApiOptions`

```ts
interface ApiOptions {
  baseUrl?: string;
  headers?: Record<string, string>;
  timeout?: number;
  retry?: RetryConfig | false;
  cache?: CacheOptions | false;
  adapter?: RequestAdapter;
  hooks?: Hooks;
  eventHub?: EventHubLike;
}
```

### `RequestOptions`

```ts
interface RequestOptions {
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
  cache?: { ttl?: number; mode?: 'ttl' | 'swr'; tags?: string[]; skip?: boolean };
  schema?: SchemaValidator;
  onSuccess?: string | string[];
  onError?: { default: string; [code: number]: string };
  entities?: EntityDef[];
  invalidates?: string[];
}
```

---

## 缓存

### `CacheOptions`

```ts
interface CacheOptions {
  ttl?: number;
  mode?: 'ttl' | 'swr';
  maxSize?: number;
}
```

### `CacheControl`

```ts
interface CacheControl {
  invalidate(opts: { tags?: string[]; key?: string }): void;
  clear(): void;
}
```

---

## 适配器

### `RequestAdapter`

```ts
interface RequestAdapter {
  request(config: AdapterRequestConfig): Promise<AdapterResponse>;
}
```

### `AdapterRequestConfig`

```ts
interface AdapterRequestConfig {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
  signal?: AbortSignal;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer';
}
```

### `AdapterResponse`

```ts
interface AdapterResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}
```

---

## 重试

### `RetryConfig`

```ts
interface RetryConfig {
  limit?: number;          // 最大重试次数，默认 2
  methods?: string[];      // 允许重试的 HTTP 方法
  statusCodes?: number[];  // 允许重试的状态码
  backoff?: 'fixed' | 'exponential';  // 退避策略，默认 exponential
  baseDelay?: number;      // 基准延迟 ms，默认 1000
  maxDelay?: number;       // 最大延迟 ms，默认 30000
}
```

---

## 钩子

### `Hooks`

```ts
interface Hooks {
  beforeRequest?: BeforeRequestHook[];
  afterResponse?: AfterResponseHook[];
  beforeRetry?: BeforeRetryHook[];
  beforeError?: BeforeErrorHook[];
}
```

### 钩子函数类型

```ts
type BeforeRequestHook = (state: RequestState) => RequestState | Promise<RequestState>;
type AfterResponseHook = (state: RequestState) => RequestState | Promise<RequestState>;
type BeforeRetryHook = (state: RequestState) => RequestState | Promise<RequestState> | typeof stop;
type BeforeErrorHook = (state: RequestState) => RequestState | Promise<RequestState>;
```

### `RequestState`

```ts
interface RequestState {
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
  cache?: { key: string; hit: boolean; stale: boolean };
  meta: Record<string, unknown>;
}
```

---

## Schema

### `SchemaValidator`

```ts
interface SchemaValidator {
  parse?: (data: unknown) => unknown;
  safeParse?: (data: unknown) => { success: boolean; data: unknown; error?: unknown };
}
```

兼容 Zod、Yup、Valibot 等任意 schema 库。

---

## 实体

### `EntityDef`

```ts
interface EntityDef {
  name: string;   // 实体名（用作缓存标签）
  idKey?: string; // ID 字段，默认 'id'
}
```

---

## 事件

### `EventHubLike`

```ts
interface EventHubLike {
  emit: (event: string, payload: unknown) => Promise<void>;
  on: (event: string, handler: (payload: unknown) => void) => () => void;
}
```

最小化的事件中心接口，避免与 eventhub 包产生循环依赖。

---

## 错误

### `ApiError`

```ts
class ApiError extends Error {
  status: number;
  data: unknown;
  request: { url: string; method: string };
  response?: { status: number; headers: Record<string, string> };
}
```

---

## 类型化 API

### `ApiDefinition` / `TypedApi<T>`

```ts
interface ApiDefinition {
  [name: string]: {
    params?: Record<string, string | number>;
    body?: Record<string, unknown>;
    response?: unknown;
  };
}

type TypedApi<T extends ApiDefinition> = {
  [K in keyof T & string]: (
    opts?: {
      params?: T[K]['params'];
      body?: T[K]['body'];
    } & Omit<RequestOptions, 'json' | 'form' | 'text'>,
  ) => Promise<T[K]['response']>;
};
```

---

## `stop` Symbol

```ts
const stop: unique symbol = Symbol('nimble-api:stop');
```

在 `beforeRetry` 钩子中返回 `stop` 可中止重试。
