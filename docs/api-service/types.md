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
  validateStatus?: (status: number) => boolean;
  totalTimeout?: number;
  paramsSerializer?: (params: Record<string, unknown>) => string;
  maxContentLength?: number;
  maxBodyLength?: number;
  deleteBodyMode?: 'query' | 'json';
  xsrfCookieName?: string;
  xsrfHeaderName?: string;
  xsrf?: boolean;
  onSwrError?: (error: ApiError, key: string) => void;
  onEventError?: (event: string, error: unknown) => void;
}
```

### `RequestOptions`

```ts
interface RequestOptions {
  params?: Record<string, string | number>;
  searchParams?: Record<string, string | number | (string | number)[] | null | undefined>;
  json?: unknown;
  form?: FormData;
  text?: string;
  method?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeout?: number;
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
  retry?: RetryConfig | false;
  cache?: { ttl?: number; mode?: 'ttl' | 'swr'; tags?: string[]; skip?: boolean; gcTime?: number };
  schema?: SchemaValidator;
  onSuccess?: string | string[];
  onError?: { default: string; [code: string]: string };
  entities?: EntityDef[];
  invalidates?: string[];
  validateStatus?: (status: number) => boolean;
  onUploadProgress?: (progress: { loaded: number; total: number }) => void;
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
  totalTimeout?: number;
  paramsSerializer?: (params: Record<string, unknown>) => string;
  maxContentLength?: number;
  maxBodyLength?: number;
  deleteBodyMode?: 'query' | 'json';
  lock?: boolean | number;
  debounce?: number | false | { wait: number; abort?: boolean };
  throttle?: number | false | { wait: number; edge?: 'leading' | 'trailing' | 'both' };
  dedup?: boolean;
  uploadFieldName?: string;
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
  gcTime?: number; // 垃圾回收时间（ms），过期后回收到 gc 缓存
}
```

### `CacheControl`

```ts
interface CacheControl {
  invalidate(opts: { tags?: string[]; key?: string; keyPrefix?: string }): void;
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
  responseType?: 'json' | 'text' | 'blob' | 'arrayBuffer' | 'stream';
  onUploadProgress?: (progress: { loaded: number; total: number }) => void;
  onDownloadProgress?: (progress: { loaded: number; total: number }) => void;
  uploadFieldName?: string;
  deleteBodyMode?: 'query' | 'json';
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
  init?: InitHook[];
  beforeRequest?: BeforeRequestHook[];
  afterResponse?: AfterResponseHook[];
  beforeRetry?: BeforeRetryHook[];
  beforeError?: BeforeErrorHook[];
}
```

### 钩子函数类型

```ts
type InitHook = (opts: RequestOptions) => RequestOptions | Promise<RequestOptions>;
type BeforeRequestHook = (state: RequestState) => RequestState | Promise<RequestState>;
type AfterResponseHook = (state: RequestState) => RequestState | Promise<RequestState>;
type BeforeRetryHook = (state: RequestState) => RequestState | Promise<RequestState> | typeof stop;
type BeforeErrorHook = (state: RequestState) => RequestState | Promise<RequestState>;
```

`init` 钩子在请求创建阶段执行，可修改 `RequestOptions`；其余钩子在生命周期各阶段执行。`beforeRetry` 中返回 `stop` 可中止重试。

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
  name: string;        // 实体名（用作缓存标签）
  idKey?: string;      // ID 字段，默认 'id'
  envelopeKey?: string; // 响应信封字段名，默认 'data'
}
```

---

## 事件

### `EventHubLike`

```ts
interface EventHubLike {
  emit: (event: string, payload: unknown) => void;
  on: (event: string, handler: (payload: unknown) => void) => () => void;
}
```

最小化的事件中心接口，避免与 eventhub 包产生循环依赖。

---

## 错误

### `ApiErrorCode`

```ts
type ApiErrorCode =
  | 'ERR_NETWORK'
  | 'ERR_BAD_REQUEST'
  | 'ERR_BAD_RESPONSE'
  | 'ERR_TIMEOUT'
  | 'ERR_ABORTED'
  | 'ERR_VALIDATION'
  | 'ERR_MAX_SIZE'
  | 'ERR_UNKNOWN';
```

### `ApiError`

```ts
class ApiError extends Error {
  name: 'ApiError';
  code: ApiErrorCode;
  status: number;
  data: unknown;
  request: { url: string; method: string };
  response?: { status: number; headers: Record<string, string> };
  cause?: unknown; // ES2022 Error cause chain
}
```

### `NetworkError`

```ts
class NetworkError extends ApiError {
  name: 'NetworkError';
  // code 固定为 'ERR_NETWORK'，status 固定为 0
}
```

网络错误（DNS 解析失败、连接拒绝等）自动创建 `NetworkError`，通过 `instanceof` 可区分处理：

```ts
import { NetworkError } from '@nimble-api/api-service';

try {
  await api.get('/data');
} catch (err) {
  if (err instanceof NetworkError) {
    // 断网或 DNS 错误
  }
}
```

---

## 类型化 API

### `EndpointSpec<TParams, TResponse>`

端点规格定义，用于 `createTypedApi` 生成类型安全的端点方法。

```ts
interface EndpointSpec<
  TParams extends Record<string, string | number> | undefined = undefined,
  TResponse = unknown,
> {
  url: string;
  method?: string;
  _params?: TParams;        // phantom field — 仅用于参数类型推断
  _response?: TResponse;    // phantom field — 仅用于返回值类型推断
  lock?: boolean | number;
  debounce?: number | { wait: number; abort?: boolean };
  throttle?: number | { wait: number; edge?: 'leading' | 'trailing' | 'both' }; // edge 默认 'both'
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
}
```

`_params` 和 `_response` 是 phantom 字段，仅用于编译期类型推导，运行时不被访问。`method` 默认 `GET`。

### `TypedApi<T>`

`createTypedApi` 返回的代理对象类型：

```ts
type TypedApi<T extends Record<string, EndpointSpec<any, any>>> = {
  [K in keyof T & string]: (
    ...args: ... // 根据 spec._params 自动推导 opts.params 类型
  ) => Promise<
    T[K] extends { debounce: number } | { throttle: number } | { lock: boolean | number }
      ? T[K]['_response'] | null
      : T[K]['_response']
  >
};
```

- 不带 `_params` 的端点 → `(opts?)` 参数完全可选
- 带 `_params` 的端点 → `(opts: { params: TParams })` 要求传入 params
- 配置了 `lock` / `debounce` / `throttle` → 返回值联合 `| null`（被抑制的调用返回 null）
- 调用时可通过 `debounce: false` / `throttle: false` 覆盖端点默认值

### `createTypedApi(client, endpoints)`

从 `ApiClient` 和端点规格映射创建类型化 API：

```ts
function createTypedApi<T extends Record<string, EndpointSpec<any, any>>>(
  client: ApiClient,
  endpoints: T,
): TypedApi<T>
```

使用示例见 [ApiClient 文档](./client#createtypedapi)。

---

## `stop` Symbol

```ts
const stop: unique symbol = Symbol('nimble-api:stop');
```

在 `beforeRetry` 钩子中返回 `stop` 可中止重试。
