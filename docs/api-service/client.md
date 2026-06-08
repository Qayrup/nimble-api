# ApiClient

## 创建实例

```ts
import { createApiClient } from '@nimble-api/api-service';

const api = createApiClient({
  baseUrl: 'https://api.example.com',
  headers: { Authorization: 'Bearer token' },
  timeout: 15000,
  retry: { limit: 3, backoff: 'exponential' },
  cache: { ttl: 30000, maxSize: 100 },
});
```

## 配置项 `ApiOptions`

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseUrl` | `string` | `''` | API 基础 URL |
| `headers` | `Record<string, string>` | — | 全局请求头 |
| `timeout` | `number` | `30000` | 请求超时（ms） |
| `retry` | `RetryConfig \| false` | `false` | 重试配置，false 禁用 |
| `cache` | `CacheOptions \| false` | — | 缓存配置，`false` 禁用且不分配 MemoryCache |
| `adapter` | `RequestAdapter` | `createFetchAdapter()` | HTTP 适配器 |
| `hooks` | `Hooks` | — | 生命周期钩子 |
| `eventHub` | `EventHubLike` | — | 事件中心实例 |
| `xsrf` | `boolean` | `true` | 设为 `false` 关闭 XSRF 自动注入 |
| `onSwrError` | `(error: ApiError, key: string) => void` | — | SWR 后台刷新失败回调 |
| `onEventError` | `(event: string, error: unknown) => void` | `console.warn` | emit 事件处理器抛错时的回调 |

## HTTP 方法

所有方法签名：`method<T>(url, opts?): Promise<T>`

```ts
api.get<T>('/users/{id}', opts?)
api.post<T>('/users', opts?)
api.put<T>('/users/{id}', opts?)
api.patch<T>('/users/{id}', opts?)
api.delete<T>('/users/{id}', opts?)
api.head<T>('/users/{id}', opts?)
api.options<T>('/users/{id}', opts?)
```

## 请求选项 `RequestOptions`

| 属性 | 类型 | 说明 |
|------|------|------|
| `params` | `Record<string, string \| number>` | URL `{param}` 模板替换 |
| `searchParams` | `Record<string, string \| number>` | Query string 参数 |
| `json` | `unknown` | JSON 请求体 |
| `form` | `FormData` | 表单请求体 |
| `text` | `string` | 文本请求体 |
| `method` | `string` | HTTP 方法（通常由便捷方法自动设置） |
| `headers` | `Record<string, string>` | 请求级请求头（与全局合并） |
| `signal` | `AbortSignal` | 取消信号 |
| `timeout` | `number` | 请求级超时 |
| `responseType` | `'json' \| 'text' \| 'blob' \| 'arrayBuffer'` | 响应类型 |
| `retry` | `RetryConfig \| false` | 请求级重写重试配置 |
| `cache` | `{ ttl?, mode?, tags?, skip? }` | 请求级缓存控制 |
| `schema` | `SchemaValidator` | 响应校验（Zod 等） |
| `onSuccess` | `string \| string[]` | 成功时通过 EventHub 发射的事件 |
| `onError` | `{ default: string; [code: string]: string }` | 失败时发射的事件 |
| `entities` | `EntityDef[]` | 从响应提取的实体标签 |
| `invalidates` | `string[]` | 请求成功后失效的缓存标签 |
| `lock` | `boolean \| number` | 并发锁，`true`/`1`=串行，`N`=最多 N 个并发，超出返回 `null` |
| `debounce` | `number \| false \| { wait: number; abort?: boolean }` | 防抖（ms）；对象形式 `abort: true` 会用 AbortController 取消已发出的 HTTP 请求 |
| `throttle` | `number \| false \| { wait: number; edge?: 'leading' \| 'trailing' \| 'both' }` | 节流（ms）；`edge` 控制发射边 |
| `dedup` | `boolean` | `true` | 设为 `false` 跳过请求去重 |
| `uploadFieldName` | `string` | `'file'` | UniApp 适配器文件上传表单字段名 |

## CSRF 保护

自动检测并发送 CSRF token。默认从 cookie `XSRF-TOKEN` 读取，以 header `X-XSRF-TOKEN` 发送。与 Laravel、Spring Security 等框架的 CSRF 机制兼容。

```ts
const api = createApiClient({
  xsrfCookieName: 'csrf-token',  // cookie 名，默认 XSRF-TOKEN
  xsrfHeaderName: 'X-CSRF-TOKEN', // header 名，默认 X-XSRF-TOKEN
});

// 或完全关闭 XSRF
const api = createApiClient({ xsrf: false });
```

## 高级配置

### `validateStatus`

自定义有效状态码判断。默认 `status >= 200 && status < 300`。

```ts
const api = createApiClient({
  validateStatus: (status) => status >= 200 && status < 500,
  // 4xx 也不抛错，业务自行处理
});
```

### `totalTimeout`

请求总超时（含所有重试时间）。超过此时间，即使仍在重试也会终止并抛出 `ERR_TIMEOUT`。

```ts
const api = createApiClient({
  totalTimeout: 60000, // 60s 总体上限
  retry: { limit: 5 }, // 单次超时 30s，但总时间超过 60s 则中止
});
```

### `paramsSerializer`

自定义 query string 序列化。默认使用 `URLSearchParams`。用于支持嵌套对象、数组等特殊格式。

```ts
const api = createApiClient({
  paramsSerializer: (params) => qs.stringify(params, { arrayFormat: 'brackets' }),
});
```

### `maxContentLength`

响应体大小上限。超限抛出 `ERR_MAX_SIZE` 错误。检查 `Content-Length` 响应头。

```ts
const api = createApiClient({ maxContentLength: 5 * 1024 * 1024 }); // 5MB
```

### `onUploadProgress` / `onDownloadProgress`

上传/下载进度回调。**仅 XHR 适配器支持**——fetch 适配器因浏览器限制不支持。

```ts
await api.post('/upload', {
  form: formData,
  onUploadProgress: ({ loaded, total }) => updateBar(loaded / total),
});
```

## 请求去重

相同 `METHOD:URL:BODY_HASH` 的并发调用自动去重（in-flight dedup）。第一个请求发出 HTTP 调用，后续调用者直接复用同一个 Promise。

```ts
// 同时触发 3 次相同请求 → 只有 1 次真实 HTTP 调用
const [a, b, c] = await Promise.all([
  api.get('/users/1'),
  api.get('/users/1'),
  api.get('/users/1'),
]);

// 单次跳过去重
await api.post('/users', { json: data, dedup: false });
```

请求完成后 `inFlight` map 自动清理对应 key。`dispose()` 清空所有进行中的请求。

## `extend(options)`

创建子客户端，继承父客户端缓存：

```ts
const authApi = api.extend({
  headers: { 'X-Custom': 'value' },
});

// authApi 与 api 共享同一个 MemoryCache
authApi.cache.clear(); // 会清空父客户端的缓存
```

## `cache` (CacheControl)

控制缓存的访问器：

```ts
// 按标签失效
api.cache.invalidate({ tags: ['users'] });

// 按 key 失效
api.cache.invalidate({ key: '/users/1' });

// 清空全部
api.cache.clear();
```

## `dispose()` / `[Symbol.dispose]()`

销毁客户端，清空缓存和进行中的请求：

```ts
api.dispose();
// 之后调用任何方法都会抛出错误

// 或使用 using 语法
{
  using api = createApiClient({ baseUrl: '...' });
  // ...
} // 作用域结束自动销毁
```

## Schema 校验

> Schema 校验在 status 检查**之后**执行：4xx/5xx 响应会先抛出，不会浪费 CPU 做无效校验。

```ts
import { z } from 'zod';

const UserSchema = z.object({ id: z.string(), name: z.string() });

// parse 模式 — 异常时直接 throw
const user = await api.get('/users/1', { schema: UserSchema });

// safeParse 模式 — 校验失败抛出 ApiError
```

## `createTypedApi(client, endpoints)`

通过 `EndpointSpec` 定义端点，生成类型安全的 API 方法。参数和返回值类型自动从 spec 推导。

```ts
import { createApiClient, createTypedApi } from '@nimble-api/api-service';
import type { EndpointSpec } from '@nimble-api/api-service';

const client = createApiClient({ baseUrl: 'https://api.example.com' });

const endpoints = {
  getUser: {
    url: '/users/{id}',
    _params: {} as { id: string },
    _response: {} as { id: string; name: string },
  } satisfies EndpointSpec,

  createUser: {
    url: '/users',
    method: 'POST',
    _response: {} as { id: string; name: string },
    onSuccess: 'cache:users:updated',
  } satisfies EndpointSpec,

  // 带并发锁 — 同时多次调用只发出一次请求，其余返回 null
  refreshToken: {
    url: '/auth/refresh',
    method: 'POST',
    lock: true,
    _response: {} as { token: string },
  } satisfies EndpointSpec,

  // 防抖搜索 — 快速连续输入时取消上一次请求，只执行最后一次
  searchUsers: {
    url: '/users/search',
    params: { q: '' },
    method: 'GET',
    debounce: 300,
    _params: {} as { q: string },
    _response: {} as { id: string; name: string }[],
  } satisfies EndpointSpec,

  // 节流上报 — 1s 内最多上报一次
  reportView: {
    url: '/analytics/view',
    method: 'POST',
    throttle: 1000,
    _response: {} as void,
  } satisfies EndpointSpec,
};

const api = createTypedApi(client, endpoints);

// 类型安全 — params.id 必须有，返回值类型自动推断
const user = await api.getUser({ params: { id: '1' } });
// user: { id: string; name: string }

// 带锁的端点 — 返回值类型自动加 | null
const token = await api.refreshToken();
// token: { token: string } | null

// 防抖端点 — 返回值类型自动加 | null
const results = await api.searchUsers({ params: { q: 'nimble' } });
// results: { id: string; name: string }[] | null

// 调用时覆盖 — 禁用端点默认的防抖
const immediate = await api.searchUsers({ params: { q: 'nimble' }, debounce: false });
// immediate: { id: string; name: string }[] — 不再 | null
```

`EndpointSpec` 上可覆盖的方法级配置（与 `RequestOptions` 合并优先级为 spec > options）：

| 属性 | 说明 |
|------|------|
| `url` | 端点 URL，支持 `{param}` 模板 |
| `method` | HTTP 方法，默认 GET |
| `lock` | 并发锁，`true`/`1`=串行，`N`=最多 N 个并发 |
| `debounce` | 防抖（ms），取消前一次未完成调用，被取消的调用返回 null |
| `throttle` | 节流（ms），窗口内后续调用直接返回 null |
| `cache` / `retry` / `schema` | 覆盖全局配置 |
| `onSuccess` / `onError` | 请求级事件 |
| `entities` / `invalidates` | 缓存标签 |
| `headers` / `timeout` / `responseType` / `validateStatus` | 请求级覆盖 |

## 事件派发

注入 EventHub 后，可通过 `onSuccess` 和 `onError` 配置自动派发事件：

```ts
const hub = createEventHub();

hub.on('cache:users:updated', (data) => {
  console.log('用户数据已更新', data);
});

const api = createApiClient({
  baseUrl: '/api',
  eventHub: hub,
});

await api.post('/users', {
  json: { name: 'Alice' },
  onSuccess: 'cache:users:updated',
});
```
