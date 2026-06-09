# @nimble-api/sse-service

轻量级 Server-Sent Events (SSE) 客户端，零依赖，基于 `fetch` + `ReadableStream`，兼容 EventSource 标准并支持 POST streaming。

```bash
npm install @nimble-api/sse-service
```

## 快速开始

```ts
import { createSSE } from '@nimble-api/sse-service'

const sse = createSSE('/api/events')

sse.on<User>('user:updated', (user) => console.log('用户更新:', user.name))
sse.onMessage((event, data) => console.log(`[${event}]`, data))
sse.onError((err) => console.error('SSE 错误:', err.message))
sse.onClose(() => console.log('连接已关闭'))
sse.close()
```

## 配置

| 选项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `baseUrl` | `string` | — | 基础 URL |
| `method` | `string` | `'GET'` | HTTP 方法，设为 `'POST'` 可发送 body |
| `body` | `string \| object \| FormData` | — | 请求体（仅非 GET/HEAD 生效） |
| `headers` | `Record<string, string>` | — | 自定义请求头 |
| `withCredentials` | `boolean` | — | 携带 Cookie |
| `params` | `Record<string, string \| number>` | — | 查询参数 |
| `reconnect` | `{ maxAttempts, interval } \| false` | 自动重连 | 重连配置，`false` 禁用 |
| `signal` | `AbortSignal` | — | 外部取消信号 |

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

## POST streaming

```ts
const sse = createSSE('/chat/completions', {
  baseUrl: 'https://api.openai.com',
  method: 'POST',
  headers: { 'Authorization': 'Bearer sk-xxx' },
  body: { model: 'gpt-4', messages: [...], stream: true },
})

sse.on('content', (chunk) => console.log(chunk))
```

## 连接状态

```ts
import { createSSE, ReadyState } from '@nimble-api/sse-service'

sse.readyState  // ReadyState.CONNECTING (0) | OPEN (1) | CLOSED (2)
sse.url         // 完整连接 URL

sse.onOpen(() => console.log('连接已建立'))
```

## 重连机制

- 连接断开后自动重连
- 重连时自动携带 `Last-Event-ID`
- 优先使用服务端 `retry:` 字段，客户端配置 `interval` 覆盖
- 超过 `maxAttempts` 触发 `onError`
- `reconnect: false` 禁用重连

## SSEConnection

```ts
interface SSEConnection {
  readonly readyState: ReadyState
  readonly url: string
  on<T = unknown>(event: string, handler: (data: T) => void): () => void
  onMessage(handler: (event: string, data: unknown) => void): () => void
  onOpen(handler: () => void): () => void
  onError(handler: (error: Error) => void): () => void
  onClose(handler: () => void): () => void
  close(): void
}
```

所有 `on*` 方法返回 unsubscribe 函数。

## 与 EventHub 集成

```ts
import { createEventHub } from '@nimble-api/eventhub'
import { createSSE } from '@nimble-api/sse-service'

const hub = createEventHub()
const sse = createSSE('/api/stream')

sse.onMessage((event, data) => hub.emit(event as never, data))
```

## 许可

ISC
