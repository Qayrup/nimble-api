# SSE Service 概述

`@nimble-api/sse-service` 是一个轻量级 Server-Sent Events (SSE) 客户端，提供连接管理、自动重连、事件路由等功能。

## 设计理念

- **零依赖** — 仅使用浏览器原生 `fetch` + `ReadableStream`
- **类型安全** — `on<T>(event, handler)` 支持泛型载荷类型
- **自动重连** — 连接断开后按配置自动重连，携带 `Last-Event-ID`
- **多监听模式** — 命名事件、全局消息、错误、关闭各自独立

## 安装

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

// 连接关闭
sse.onClose(() => {
  console.log('连接已关闭')
})

// 手动关闭
sse.close()
```

## 配置选项

```ts
const sse = createSSE('/api/stream', {
  baseUrl: 'https://api.example.com',  // 基础 URL
  headers: { Authorization: 'Bearer token' },  // 自定义请求头
  withCredentials: true,               // 携带 Cookie
  params: { channel: 'news' },         // 查询参数
  reconnect: {
    maxAttempts: 5,                    // 最大重连次数，默认 Infinity
    interval: 3000,                    // 重连间隔（ms），默认 3000
  },
  signal: abortController.signal,      // 外部取消信号
})
```

## SSEConnection 接口

```ts
interface SSEConnection {
  on<T = unknown>(event: string, handler: (data: T) => void): () => void
  onMessage(handler: (event: string, data: unknown) => void): () => void
  onError(handler: (error: Error) => void): () => void
  onClose(handler: () => void): () => void
  close(): void
}
```

所有 `on*` 方法返回 unsubscribe 函数，调用即可取消监听。

## 重连机制

- 连接断开后自动重连
- 重连时自动携带 `Last-Event-ID` 请求头
- 可通过 `reconnect: false` 禁用
- 超过 `maxAttempts` 后触发 `onError`

## 与 EventHub 集成

```ts
import { createEventHub } from '@nimble-api/eventhub'
import { createSSE } from '@nimble-api/sse-service'

const hub = createEventHub()
const sse = createSSE('/api/stream')

// 将 SSE 消息桥接到 EventHub
sse.onMessage((event, data) => {
  hub.emit(event as never, data)
})
```

## SSEEvent 类型

```ts
interface SSEEvent {
  event: string       // 事件名，默认 'message'
  data: unknown       // 解析后的数据（自动尝试 JSON.parse）
  id?: string         // 事件 ID，用于断线重连
  explicitEvent: boolean  // 是否为显式命名事件
}
```
