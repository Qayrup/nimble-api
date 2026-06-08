# @nimble-api/sse-service

轻量级 Server-Sent Events (SSE) 客户端，零依赖，基于浏览器原生 `fetch` + `ReadableStream`。

```bash
npm install @nimble-api/sse-service
```

## 快速开始

```ts
import { createSSE } from '@nimble-api/sse-service'

const sse = createSSE('/api/events')

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

// 连接关闭回调
sse.onClose(() => {
  console.log('连接已关闭')
})

// 手动关闭
sse.close()
```

## 配置

```ts
const sse = createSSE('/api/stream', {
  baseUrl: 'https://api.example.com',
  headers: { Authorization: 'Bearer token' },
  withCredentials: true,               // 携带 Cookie
  params: { channel: 'news' },         // 查询参数
  reconnect: {
    maxAttempts: 5,                    // 最大重连次数，默认 Infinity
    interval: 3000,                    // 重连间隔 ms，默认 3000
  },
  signal: abortController.signal,      // 外部取消信号
})
```

| 选项 | 类型 | 默认 | 说明 |
|---|---|---|---|
| `baseUrl` | `string` | — | 基础 URL |
| `headers` | `Record<string, string>` | — | 自定义请求头 |
| `withCredentials` | `boolean` | — | 携带 Cookie |
| `params` | `Record<string, string \| number>` | — | 查询参数 |
| `reconnect` | `{ maxAttempts, interval } \| false` | 自动重连 | 重连配置，`false` 禁用 |
| `signal` | `AbortSignal` | — | 外部取消信号 |

## 重连机制

- 连接断开后自动重连（可配置间隔和最大次数）
- 重连时自动携带 `Last-Event-ID` 请求头
- 超过 `maxAttempts` 后触发 `onError`
- 通过 `reconnect: false` 禁用

## SSEConnection

```ts
interface SSEConnection {
  on<T = unknown>(event: string, handler: (data: T) => void): () => void
  onMessage(handler: (event: string, data: unknown) => void): () => void
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

sse.onMessage((event, data) => {
  hub.emit(event as never, data)
})
```

## 许可

ISC
