# SSE Service 概述

`@nimble-api/sse-service` 是一个轻量级 Server-Sent Events (SSE) 客户端，兼容 EventSource 标准，并扩展了 POST streaming、连接状态追踪等能力。

## 设计理念

- **零依赖** — 仅使用 `fetch` + `ReadableStream`，浏览器和 Node.js 18+ 均可运行
- **类型安全** — `on<T>(event, handler)` 支持泛型载荷类型
- **自动重连** — 连接断开后按配置自动重连，携带 `Last-Event-ID`
- **服务端 retry 支持** — 优先使用服务端建议的重连间隔
- **POST streaming** — 支持 `method` / `body`，兼容 OpenAI 等 POST-based 流式 API

## 安装

```bash
npm install @nimble-api/sse-service
```

## 快速开始

```ts
import { createSSE, ReadyState } from '@nimble-api/sse-service'

const sse = createSSE('/api/events')

// 连接状态
console.log(sse.readyState) // ReadyState.CONNECTING (0)

// 连接成功回调
sse.onOpen(() => {
  console.log(sse.readyState) // ReadyState.OPEN (1)
  console.log(sse.url)        // 完整连接 URL
})

// 监听命名事件
sse.on<User>('user:updated', (user) => {
  console.log('用户更新:', user.name)
})

// 监听所有消息
sse.onMessage((event, data) => {
  console.log(`[${event}]`, data)
})

// 错误处理
sse.onError((err) => {
  console.error('SSE 错误:', err.message)
})

// 连接关闭
sse.onClose(() => {
  console.log(sse.readyState) // ReadyState.CLOSED (2)
})

// 手动关闭
sse.close()
```

---

## 配置选项

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `baseUrl` | `string` | — | 基础 URL，会与 `url` 参数拼接 |
| `method` | `string` | `'GET'` | HTTP 方法，设为 `'POST'` 可发送 body |
| `body` | `string \| object \| FormData` | — | 请求体，仅非 GET/HEAD 生效 |
| `headers` | `Record<string, string>` | — | 自定义请求头，会与内置头合并 |
| `withCredentials` | `boolean` | — | 携带 Cookie（`credentials: 'include'`） |
| `params` | `Record<string, string \| number>` | — | 查询参数，自动拼接到 URL |
| `reconnect` | `SSEReconnect \| false` | 自动重连 | 重连配置，`false` 禁用 |
| `signal` | `AbortSignal` | — | 外部取消信号，触发时调用 `close()` |

```ts
const sse = createSSE('/api/stream', {
  baseUrl: 'https://api.example.com',
  headers: { Authorization: 'Bearer token' },
  withCredentials: true,
  params: { channel: 'news' },
  reconnect: { maxAttempts: 5, interval: 3000 },
  signal: abortController.signal,
})
```

### POST streaming

通过 `method` 和 `body` 发送 POST 请求进行流式消费，适用于 OpenAI、Anthropic 等 POST-based streaming API：

```ts
const sse = createSSE('/chat/completions', {
  baseUrl: 'https://api.openai.com',
  method: 'POST',
  headers: { 'Authorization': 'Bearer sk-xxx' },
  body: { model: 'gpt-4', messages: [{ role: 'user', content: 'Hello' }], stream: true },
})

sse.on('content', (chunk) => console.log(chunk))
```

- `body` 为 object 时自动 `JSON.stringify`，并添加 `Content-Type: application/json`
- `body` 为 `string` 时直接发送，需自行设置 `Content-Type`
- `body` 为 `FormData` 时直接发送

> 后端只需对应端点支持 POST 方法即可。对传统 GET-based SSE 后端无影响——默认 `method: 'GET'` 保持不变。

---

## ReadyState 连接状态

```ts
import { ReadyState } from '@nimble-api/sse-service'

ReadyState.CONNECTING  // 0 — 正在建立连接 / 重连中
ReadyState.OPEN        // 1 — 已连接，正在接收事件
ReadyState.CLOSED      // 2 — 已关闭（手动 close 调用后）
```

| 属性 | 类型 | 说明 |
|------|------|------|
| `sse.readyState` | `ReadyState` | 当前连接状态 |
| `sse.url` | `string` | 完整请求 URL（含 baseUrl 和 params） |

状态流转：

```
CONNECTING → OPEN → (断开) → CONNECTING → OPEN → ... → CLOSED
```

- 每次重连前 `readyState` 会回到 `CONNECTING`
- `maxAttempts` 耗尽后 `readyState` 变为 `CLOSED`，触发 `onClose` 回调，不再重连
- 调用 `close()` 后 `readyState` 变为 `CLOSED`，不再触发重连

---

## SSEConnection 接口

```ts
interface SSEConnection {
  readonly readyState: ReadyState      // 连接状态
  readonly url: string                 // 完整 URL
  on<T = unknown>(event: string, handler: (data: T) => void): () => void
  onMessage(handler: (event: string, data: unknown) => void): () => void
  onOpen(handler: () => void): () => void
  onError(handler: (error: Error) => void): () => void
  onClose(handler: () => void): () => void
  close(): void
}
```

所有 `on*` 方法返回 unsubscribe 函数：

```ts
const unsub = sse.on<User>('user:updated', (user) => { ... })
// 不再需要时取消监听
unsub()
```

---

## 重连机制

| 配置 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `reconnect.maxAttempts` | `number` | `Infinity` | 最大重连次数。超出后 `readyState` 转 `CLOSED` 并触发 `onClose` |
| `reconnect.interval` | `number` | 服务端 `retry:` 字段兜底 `3000` | 基础重连间隔 ms |
| `reconnect.maxInterval` | `number` | `30000` | 指数退避封顶值 ms |

> 服务端可通过 SSE 的 `retry:` 字段建议重连间隔。sse-service 会解析该字段，并以客户端 `interval` 覆盖（客户端配置优先）。

### 指数退避策略

- 每次重连延迟 = `min(interval × 2^(attempts-1), maxInterval)`
- 连接稳定超过 `interval` 时长，或成功收到事件，**attempts 自动清零**——秒连秒断不会再无限退避
- `reconnect: false` 完全禁用重连，断开后直接进入 CLOSED 状态

- 重连时自动携带 `Last-Event-ID` 请求头，服务端可从事件 `id` 之后继续发送

---

## SSEEvent 类型

```ts
interface SSEEvent {
  event: string           // 事件名，默认 'message'
  data: unknown           // 解析后的数据（自动尝试 JSON.parse，失败则保留原始字符串）
  id?: string             // 事件 ID，用于断线重连的 Last-Event-ID
  explicitEvent: boolean  // 是否为显式命名事件（通过 event: 字段声明）
}
```

## 协议解析

支持标准 SSE 协议的全部字段：

| 字段 | 说明 |
|------|------|
| `event:` | 事件名，默认 `'message'` |
| `data:` | 数据行，多行会以 `\n` 拼接 |
| `id:` | 事件 ID，自动记录用于重连 |
| `retry:` | 服务端建议的重连间隔 ms |
| `:` (comment) | 注释行，忽略 |

空行结束一个消息块并触发事件分发。

---

## 安全保护

- **缓冲区上限 1MB** — 异常服务器不发空行时不会无限增长，超限自动 `close()` + `onError`
- **handler 错误隔离** — 单个事件 handler 抛错不影响其他 handler，也不中断连接

---

## 与 EventHub 集成

```ts
import { createEventHub } from '@nimble-api/eventhub'
import { createSSE } from '@nimble-api/sse-service'

const hub = createEventHub()
const sse = createSSE('/api/stream')

// 将 SSE 消息桥接到 EventHub，实现全局事件分发
sse.onMessage((event, data) => hub.emit(event as never, data))
```
