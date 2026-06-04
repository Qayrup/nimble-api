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
| `cache` | `CacheOptions \| false` | — | 缓存配置，false 禁用 |
| `adapter` | `RequestAdapter` | `createFetchAdapter()` | HTTP 适配器 |
| `hooks` | `Hooks` | — | 生命周期钩子 |
| `eventHub` | `EventHubLike` | — | 事件中心实例 |

## HTTP 方法

所有方法签名：`method<T>(url, opts?): Promise<T>`

```ts
api.get<T>('/users/{id}', opts?)
api.post<T>('/users', opts?)
api.put<T>('/users/{id}', opts?)
api.patch<T>('/users/{id}', opts?)
api.delete<T>('/users/{id}', opts?)
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
| `onError` | `{ default: string; [code: number]: string }` | 失败时发射的事件 |
| `entities` | `EntityDef[]` | 从响应提取的实体标签 |
| `invalidates` | `string[]` | 请求成功后失效的缓存标签 |

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

## 请求去重

相同请求（method + URL + body）的并发调用自动去重，只发出一次真实请求，多个调用者共享同一个 Promise。

## Schema 校验

```ts
import { z } from 'zod';

const UserSchema = z.object({ id: z.string(), name: z.string() });

// parse 模式 — 异常时直接 throw
const user = await api.get('/users/1', { schema: UserSchema });

// safeParse 模式 — 校验失败抛出 ApiError
```

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
