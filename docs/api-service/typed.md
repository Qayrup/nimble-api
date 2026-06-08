# TypedApi — 类型安全端点

`createTypedApi()` 将 `ApiClient` 的字符串 URL 方法包装为类型安全的端点函数，编译期即可发现参数错误。

## 设计理念

- **端点即类型** — 通过 `EndpointSpec` 声明式定义每个接口的入参/出参类型
- **编译期安全** — 参数缺失或类型错误在 IDE 中即时提示
- **内置流控** — 端点级 `lock`、`debounce`、`throttle`，无需额外封装

## 定义端点

```ts
import { createTypedApi } from '@nimble-api/api-service'
import type { EndpointSpec } from '@nimble-api/api-service'

const api = createTypedApi(client, {
  getUser: {
    url: '/api/user/{userId}',
    _params: {} as { userId: string },
    _response: {} as { name: string; email: string },
  },
  createUser: {
    url: '/api/user',
    method: 'POST',
    _response: {} as { id: string },
  },
  searchUsers: {
    url: '/api/users',
    _params: {} as { q: string },
    _response: {} as { items: { name: string }[]; total: number },
    debounce: 300,
  },
})
```

`_params` 和 `_response` 是**幻影字段**，仅用于类型推导，运行时不会访问。它们的值（如 `{} as SomeType`）不产生任何运行时开销，仅为 TypeScript 编译器提供类型信息。

## 调用端点

有 `_params` 的端点要求传入 `params`，没有的则可省略：

```ts
// 有 _params → 必须传 params
const user = await api.getUser({ params: { userId: '123' } })
// user: { name: string; email: string }

// 无 _params → params 可选
const newUser = await api.createUser({ body: { name: 'Bob' } })
// newUser: { id: string }
```

## 内置流控

```ts
// 防抖：快速连续调用只执行最后一次
const api = createTypedApi(client, {
  search: { url: '/search', debounce: 300, _response: {} as Result },
})

// 防抖 + abort：取消已发出的 HTTP 请求
const api = createTypedApi(client, {
  liveSearch: { url: '/search', debounce: { wait: 300, abort: true }, _response: {} as Result },
})

// 节流：窗口期内后续调用返回 null（edge 默认 'both'——首次立即发 + 结束时补发一次）
const api = createTypedApi(client, {
  track: { url: '/track', method: 'POST', throttle: 100, _response: {} as void },
})

// 节流 trailing：每次调用重置 timer，只发窗口内最后一次调用（最新参数）
const api = createTypedApi(client, {
  track: { url: '/track', method: 'POST', throttle: { wait: 1000, edge: 'trailing' }, _response: {} as void },
})

// 锁：同一时刻只允许 1 个进行中，其余返回 null
const api = createTypedApi(client, {
  submit: { url: '/submit', method: 'POST', lock: true, _response: {} as void },
})

// 锁 N：允许最多 N 个并发，超出返回 null
const api = createTypedApi(client, {
  upload: { url: '/upload', method: 'POST', lock: 3, _response: {} as void },
})
```

流控支持调用时覆盖：

```ts
// 临时禁用端点级防抖
await api.search({ params: { q: 'test' }, debounce: false })
```

## HasSuppression 类型

如果端点配置了 `lock`、`debounce`（含对象形式）或 `throttle`（含对象形式），返回类型自动变为 `T | null`，因为被抑制的调用会返回 `null`：

```ts
const api = createTypedApi(client, {
  safe: { url: '/safe', _response: {} as Data },
  guarded: { url: '/guarded', lock: true, _response: {} as Data },
})

const a = await api.safe()     // 类型: Data
const b = await api.guarded()  // 类型: Data | null  ← 自动添加 null
```

## EndpointSpec 完整配置

| 字段 | 类型 | 说明 |
|------|------|------|
| `url` | `string` | 路径模板，支持 `{param}` 占位 |
| `method` | `string` | HTTP 方法，默认 `GET` |
| `_params` | 幻影字段 | 路径参数类型定义 |
| `_response` | 幻影字段 | 响应数据类型定义 |
| `lock` | `boolean \| number` | 并发锁，`true`/`1`=串行，`N`=最多 N 个并发 |
| `debounce` | `number \| { wait: number; abort?: boolean }` | 防抖延迟（ms）；`abort: true` 取消已发出请求 |
| `throttle` | `number \| { wait: number; edge?: 'leading' \| 'trailing' \| 'both' }` | 节流间隔（ms）；`edge` 控制发射边，默认 `'both'` |
| `cache` | `CacheOptions` | 端点级缓存配置 |
| `retry` | `RetryConfig` | 端点级重试配置 |
| `schema` | `SchemaValidator` | 响应校验 |
| `onSuccess` | `string \| string[]` | 成功事件名 |
| `onError` | `object` | 错误事件映射 |
| `headers` | `Record<string, string>` | 端点级请求头 |
| `timeout` | `number` | 端点级超时 |
| `responseType` | `'json' \| 'text' \| 'blob' \| 'arrayBuffer'` | 响应类型 |
| `validateStatus` | `(status: number) => boolean` | 自定义状态码校验 |
