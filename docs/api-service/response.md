# 响应处理

一个 HTTP 请求从适配器返回后，经过一条完整的响应处理管线。理解这条管线是正确使用 nimble-api 的关键。

## 响应管线

```
adapter.request() → 原始 HTTP 响应 { status, data, headers }
  │
  ├─ ① transformResponse   格式归一化（可选，默认跳过）
  ├─ ② maxContentLength    响应体大小检查
  ├─ ③ validateStatus      HTTP 状态码判断
  │     ├─ 不通过 → 跑 parser 提取错误消息 → throw ApiError
  │     └─ 通过   → 进入 ④
  ├─ ④ parser              业务结果判断 + 数据解包
  │     ├─ ok: true  → 替换 state.response.data
  │     └─ ok: false → throw ApiError(ERR_BUSINESS) 不重试
  ├─ ⑤ schema              响应校验（可选）
  ├─ ⑥ afterResponse hooks
  ├─ ⑦ cache store
  └─ ⑧ #dispatchEvents     onSuccess / onError
```

---

## ① transformResponse — 响应守卫

**位置**：adapter 返回后立即执行，早于一切判断。  
**用途**：归一化不同后端的响应格式。  
**默认**：`null`（跳过）。

### 为什么需要它

后端格式千奇百怪：

- **通用格式**：`{ code: 0, msg: 'ok', result: { ... } }`
- **ABP**：成功裸数据，失败 `{ error: { code, message } }`
- **Spring**：`{ code: 200, data: { ... }, message: 'success' }`

`transformResponse` 在门口把所有格式归一化，后续管线无需关心差异。

### 签名

```ts
type TransformResponseFn = (
  response: { status: number; data: unknown; headers: Record<string, string> }
) => { status: number; data: unknown; headers: Record<string, string> } | Promise<...>
```

### ABP 示例

```ts
const api = createApiClient({
  transformResponse: (resp) => {
    const d = resp.data as any

    // ABP 错误：{ error: { code, message, ... } }
    if (d?.error) {
      return {
        ...resp,
        data: { code: d.error.code, msg: d.error.message },
      }
    }

    // ABP 成功：裸数据 → 包成统一格式
    return {
      ...resp,
      data: { code: 0, msg: 'ok', result: d },
    }
  },
})
```

### 关键规则

- **返回值的 status/data/headers 覆盖原始值**
- **修改 status 会影响后续 validateStatus 判断** — 比如把 ABP 的 400 改成 200，后续 parser 走业务错误分支
- **抛异常中断请求** — 被包装为 `ERR_BAD_RESPONSE`

---

## ②③ HTTP 状态码判断

### validateStatus（默认）

```ts
(status) => status >= 200 && status < 300
```

所有 2xx 通过，4xx/5xx 不通过。

### HTTP 错误时的消息提取

4xx/5xx 响应也会跑 parser 尝试提取有意义的消息：

```ts
// ABP 的 400 返回 { error: { code: "User:NotFound", message: "用户不存在" } }
// → ApiError.message = "用户不存在"（而非 "Request failed with status 400"）
```

---

## ④ parser — 业务结果解析

**位置**：validateStatus 通过后执行。  
**用途**：从 HTTP 200 的响应体中判断业务成功/失败 + 解包数据。  
**默认**：`defaultParser`（识别 `{ code, msg, result }` 格式）。

### defaultParser 行为

```ts
// 成功 — 解包 result
{ code: 0, msg: 'ok', result: { items: [...] } }  → 返回 { items: [...] }

// 成功 — 无 result 不解包
{ code: 0 }                                        → 返回 { code: 0 }

// 成功 — 无 code 字段
{ name: 'Alice' }                                  → 返回 { name: 'Alice' }

// 失败 — 抛 ERR_BUSINESS
{ code: 10001, msg: '余额不足' }                    → throw ApiError(ERR_BUSINESS)
```

### 判断逻辑

```ts
code === 0 || code === '0' || code === undefined || code === null  → 成功
其他值                                                              → 失败
```

### 自定义 parser

```ts
const api = createApiClient({
  parser: (resp) => {
    const d = resp.data as any
    if (d?.error) {
      return { ok: false, businessCode: d.error.code, businessMessage: d.error.message }
    }
    return { ok: true, data: d }
  },
})
```

### 失败时的行为

- `ok: false` → 抛出 `ApiError`，`code` = `ERR_BUSINESS`
- **不触发重试** — 业务错误重试无意义
- `error.businessCode` / `error.businessMessage` 被设置
- 通过 `onError` 事件分发

### 优先级

```
per-request parser > endpoint spec parser > client 级 parser > defaultParser
```

`defaultParser` 始终作为最终兜底 — 除非显式传 null（但 null 也会回退到 defaultParser）。

---

## ⑤⑥⑦⑧ 后续节点

### onSuccess 事件

成功时 `data` 已是 parser 解包后的值：

```ts
// after parsing: state.response.data = { items: [...], totalCount: 2 }
hub.emit('dict:list-loaded', { items: [...], totalCount: 2 })
```

### onError 事件

错误时 payload 为规范化的 `{ code, message }`：

```ts
// code 匹配顺序：
//   ① error.businessCode（parser 提取）
//   ② error.data.code   （原始 body 兜底）
//   ③ onError.default   （最终兜底）

// payload:
{
  code: error.businessCode ?? dataCode,
  message: error.businessMessage ?? error.message,
}
```

### onError 精确匹配

```ts
const spec = {
  url: '/api/user/{id}',
  onError: {
    default: 'user:error',              // 兜底
    'User:NotFound': 'user:not-found',  // businessCode 精确匹配
    'ConcurrencyFailure': 'user:conflict',
  },
}

// 后端返回 businessCode "User:NotFound"
// → hub.emit('user:not-found', { code: "User:NotFound", message: "用户不存在" })
```

---

## ApiError 结构

```ts
class ApiError extends Error {
  code: ApiErrorCode           // 错误分类
  status: number               // HTTP 状态码
  data: unknown                // 响应体（transformResponse 归一化后）
  request: { url, method }
  response?: { status, headers }

  // parser 提取的业务信息
  businessCode?: string        // 业务错误码
  businessMessage?: string     // 业务错误消息
}
```

### 错误类型对照

| 来源 | `code` | `status` | `businessCode` | 重试 |
|------|--------|----------|----------------|:---:|
| 网络不通 | `ERR_NETWORK` | 0 | — | ✓ |
| HTTP 400 | `ERR_BAD_REQUEST` | 400 | parser 提取 | 408/413/429 才重试 |
| HTTP 500 | `ERR_BAD_RESPONSE` | 500 | parser 提取 | ✓ |
| parser 判定失败 | `ERR_BUSINESS` | 200 | "10001" | ✗ |
| 超时 | `ERR_TIMEOUT` | 0 | — | ✓ |
| Schema 校验失败 | `ERR_VALIDATION` | 200 | — | ✗ |

---

## createResultParser + ApiResult

### 问题

默认行为：成功返回干净数据，失败抛异常。  
但有时希望成功也能拿到结构化上下文（httpStatus、businessCode、businessMessage）。

### 方案

```ts
const api = createApiClient({
  parser: createResultParser(),  // 包装 defaultParser
})
```

### 返回值对比

```ts
// 默认
const user = await api.getUser()  // → { name: 'Alice' }

// 使用 createResultParser
const r = await api.getUser()
// → {
//     ok: true,
//     httpStatus: 200,
//     businessCode: 0,
//     businessMessage: 'ok',
//     data: { name: 'Alice' }
//   }
```

### ApiResult 类型

```ts
interface ApiResult<T = unknown> {
  ok: true
  httpStatus: number
  businessCode: string | number
  businessMessage: string
  data: T
}
```

### 搭配自定义 innerParser

```ts
createApiClient({
  parser: createResultParser((resp) => {
    const d = resp.data as any
    if (d?.error) return { ok: false, businessCode: d.error.code, businessMessage: d.error.message }
    return { ok: true, data: d }
  }),
})
```

### 按端点使用

```ts
const api = createTypedApi(client, {
  getList: {
    url: '/api/list',
    _response: {} as ItemDto[],               // 不包装
  },
  create: {
    url: '/api/item',
    method: 'POST',
    _response: {} as ApiResult<ItemDto>,      // 包装
    parser: createResultParser(),
  },
})
```

---

## ABP 全栈示例

```ts
const api = createApiClient({
  // ① 归一化 ABP 格式
  transformResponse: (resp) => {
    const d = resp.data as any
    if (d?.error) {
      return { ...resp, data: { code: d.error.code, msg: d.error.message } }
    }
    return { status: 200, data: { code: 0, msg: 'ok', result: d } }
  },
  // ② 包装为 ApiResult
  parser: createResultParser(),
})

// 成功
const r = await api.get('/api/user/1')
// r = { ok: true, httpStatus: 200, businessCode: 0, businessMessage: 'ok', data: { name: 'Alice' } }

// 失败
try {
  await api.get('/api/user/not-found')
} catch (err) {
  const e = err as ApiError
  // e.code = 'ERR_BUSINESS'
  // e.businessCode = 'User:NotFound'
  // e.businessMessage = '用户不存在'
}
```
