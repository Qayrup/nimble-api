# @nimble-api/api-service

轻量级 TypeScript API 客户端框架。动态方法生成、缓存（SWR）、重试、防抖/节流/并发锁、类型安全端点。

```bash
npm install @nimble-api/api-service
```

## 快速开始

```ts
import { createApiClient, createTypedApi } from '@nimble-api/api-service'

const client = createApiClient({ baseUrl: 'https://api.example.com' })

const api = createTypedApi(client, {
  getUser: {
    url: '/users/{userId}',
    _params: {} as { userId: string },
    _response: {} as { id: string; name: string },
  },
  createUser: {
    url: '/users',
    method: 'POST',
    _response: {} as { id: string },
    onSuccess: 'users:updated',
  },
})

const user = await api.getUser({ params: { userId: '123' } })
//     ^ { id: string; name: string }

const created = await api.createUser({ body: { name: 'Alice' } })
//     ^ { id: string }
```

## 缓存

支持 TTL 和 SWR (stale-while-revalidate) 两种模式，全局或端点级配置。

```ts
const client = createApiClient({
  cache: { ttl: 60000, mode: 'swr' },  // 全局 60s SWR 缓存
})

// 端点级覆盖
const api = createTypedApi(client, {
  userList: {
    url: '/users',
    _response: {} as User[],
    cache: { ttl: 300000, tags: ['users'] },
  },
})
```

**SWR 流程**：缓存命中 → 立即返回 stale 数据 → 后台重验证 → 静默更新缓存。

```ts
// 手动控制缓存
client.cache.invalidate({ tags: ['users'] })       // 按 tag 失效
client.cache.invalidate({ key: '/users:{}' })       // 按 key 失效
client.cache.invalidate({ keyPrefix: '/users' })    // 按前缀失效
client.cache.clear()                                // 清空
```

## 请求级方法

无需类型定义的快捷方法：

```ts
await client.get('/users/{id}', { params: { id: '1' } })
await client.post('/users', { body: { name: 'Alice' } })
await client.put('/users/{id}', { params: { id: '1' }, body: { name: 'Bob' } })
await client.delete('/users/{id}', { params: { id: '1' } })
await client.head('/files/photo.jpg')
await client.options('/users')
```

## 类型安全端点

```ts
const api = createTypedApi(client, {
  getUser: {
    url: '/users/{userId}',
    _params: {} as { userId: string },
    _response: {} as { id: string; name: string; email: string },
  },
  searchUsers: {
    url: '/users/search',
    _response: {} as User[],
    debounce: 300,                     // 防抖 300ms
    cache: { ttl: 60000, tags: ['users'] },
    invalidates: ['users'],            // 成功后失效缓存
  },
  submitOrder: {
    url: '/orders',
    method: 'POST',
    lock: true,                        // 同时只允许 1 个请求
    _response: {} as { orderId: string },
    onSuccess: 'orders:updated',
  },
})

// _params 定义了参数类型 → 必须传
await api.getUser({ params: { userId: '123' } })

// 调用时覆盖端点级配置
await api.searchUsers({ params: { q: 'test' }, debounce: false })
```

### 流控

**lock** — 并发锁。`true`/`1` = 串行，`N` = 允许 N 个并发，超出返回 `null`。

```ts
lock: true   // 同一时刻只允许 1 个请求
lock: 3      // 允许 3 个并发，第 4 个返回 null
```

**debounce** — 防抖。快速连续调用只执行最后一次。

```ts
debounce: 300                               // 300ms 防抖
debounce: { wait: 300, abort: true }        // 防抖 + 取消已发出的 HTTP 请求
```

**throttle** — 节流。窗口期内后续调用返回 `null`。

```ts
throttle: 1000                                  // 1s 窗口
throttle: { wait: 1000, edge: 'both' }          // 首次发 + 结束时补发（默认）
throttle: { wait: 1000, edge: 'trailing' }      // 只补发最后一次
throttle: { wait: 1000, edge: 'leading' }       // 只发首次
```

### HasSuppression 类型

如果端点配置了 `lock`、`debounce` 或 `throttle`，返回类型自动变为 `T | null`。

```ts
const api = createTypedApi(client, {
  submit: { url: '/submit', method: 'POST', lock: true, _response: {} as void },
})
const r = await api.submit()  // r: void | null
```

## 重试

```ts
const client = createApiClient({
  retry: {
    limit: 3,           // 最大重试次数（默认 2）
    methods: ['GET'],   // 允许重试的方法
    statusCodes: [408, 429, 500, 502, 503, 504],  // 触发重试的状态码
    backoff: 'exponential',  // 退避策略：exponential | linear
    baseDelay: 1000,    // 基础延迟 ms
    maxDelay: 30000,    // 最大延迟 ms
  },
})

// 网络错误（status=0）始终重试
```

端点级覆盖：

```ts
const api = createTypedApi(client, {
  fragileEndpoint: {
    url: '/fragile',
    retry: { limit: 0 },  // 禁用重试
    _response: {} as Data,
  },
})
```

## 请求去重

默认启用，对相同 URL + method + body 的并发请求自动去重。

```ts
// 三个调用同时发起，只发送 1 个 HTTP 请求
await Promise.all([
  api.getUser({ params: { userId: '1' } }),
  api.getUser({ params: { userId: '1' } }),
  api.getUser({ params: { userId: '1' } }),
])

// 禁用去重
await api.getUser({ params: { userId: '1' }, dedup: false })
```

## 适配器

框架通过适配器与 HTTP 层解耦。

```ts
// 浏览器 / Node 18+
import { createFetchAdapter } from '@nimble-api/api-service'

// XMLHttpRequest
import { createXhrAdapter } from '@nimble-api/api-service'

// uni-app
import { createUniAppAdapter } from '@nimble-api/api-service'

const client = createApiClient({ adapter: createXhrAdapter() })
```

默认使用 `createFetchAdapter()`。

## 钩子

请求生命周期的拦截点：

```ts
const client = createApiClient({
  hooks: {
    beforeRequest: (state) => { /* 修改 headers、参数等 */ },
    afterResponse: (state) => { /* 处理响应数据 */ },
    beforeRetry: (state) => {
      // 返回 stop 符号阻止重试
      if (state.retryCount > 2) return stop
    },
    beforeError: (state) => { /* 错误处理 */ },
  },
})
```

| 钩子 | 时机 | 可修改 |
|---|---|---|
| `beforeRequest` | 请求发出前 | headers, params, body, timeout 等 |
| `afterResponse` | 收到响应后 | response.data |
| `beforeRetry` | 重试前 | 返回 `stop` 阻止重试 |
| `beforeError` | 错误抛出前 | — |

## 事件集成

通过 EventHub 派发请求生命周期事件：

```ts
import { createEventHub } from '@nimble-api/eventhub'

const hub = createEventHub()
hub.on('users:updated', () => console.log('缓存已失效'))

const client = createApiClient({ eventHub: hub })

const api = createTypedApi(client, {
  updateUser: {
    url: '/users/{id}',
    method: 'PUT',
    onSuccess: 'users:updated',
    onError: {
      default: 'errors:default',
      'USER_NOT_FOUND': 'errors:userNotFound',
      429: 'errors:rateLimited',
    },
    _response: {} as void,
  },
})
```

## API 参考

完整 API 文档 → [docs/api-service](./docs/api-service)

## 许可

ISC
