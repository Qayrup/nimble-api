# @nimble-api/eventhub

轻量级 TypeScript 事件中心，支持 glob 通配符、meta 事件、多 emit 模式、快照迭代。

```bash
npm install @nimble-api/eventhub
```

## 快速开始

```ts
import { createEventHub } from '@nimble-api/eventhub'

interface Events {
  'user:login': { userId: string }
  'user:logout': { userId: string }
  'order:*': { orderId: string; status: string }
}

const hub = createEventHub<Events>()

// 订阅
hub.on('user:login', (payload) => {
  console.log(`用户 ${payload.userId} 登录`)
})

// 通配符订阅 — 匹配所有 order: 前缀的事件
hub.on('order:*', (event, payload) => {
  console.log(`事件: ${event}`, payload)
})

// 发射
hub.emit('user:login', { userId: 'u1' })
hub.emit('order:created', { orderId: 'o1', status: 'pending' })
```

## API 概览

### 订阅

| 方法 | 说明 |
|---|---|
| `on(event, handler, opts?)` | 订阅事件，返回 `unsubscribe` 函数 |
| `onAny(handler)` | 订阅所有事件 |
| `once(event, handler)` | 一次性订阅 |
| `off(event, handler)` | 移除指定 handler |
| `offAll(event?)` | 移除事件的所有 handler，或全部 handler |
| `hasListeners(event?)` | 是否有监听器 |

### 通配符

```ts
hub.on('user:*', handler)      // 匹配 user:login, user:logout 等
hub.on('**:error', handler)    // 匹配任意段 + :error
hub.on('**', handler)          // 匹配所有事件
```

通配符语法：`*` 匹配单段（不含分隔符），`**` 匹配任意段，`?` 匹配单个字符。分隔符默认为 `:./`，可通过 `delimiter` 选项自定义。

### 发射模式

```ts
const hub = createEventHub({
  emitMode: 'aggregate',  // 收集所有 handler 错误，抛 AggregateError
  emitSafety: 'safe',     // 快照迭代，handler 中 unsubscribe 不影响当前 emit
})
```

| 选项 | 值 | 说明 |
|---|---|---|
| `emitMode` | `'aggregate'` | 收集所有错误后抛出（默认） |
| | `'failFast'` | 第一个错误立即抛出 |
| | `'silent'` | 静默吞掉错误 |
| `emitSafety` | `'safe'` | 快照迭代（默认） |
| | `'fast'` | 直接迭代（零分配，但 handler 中 unsubscribe 会跳过一个） |

### Meta 事件

监听器生命周期事件：

```ts
hub.on('listenerAdded', ({ event }) => {
  console.log(`监听器已添加到 "${event}"`)
})
hub.on('listenerRemoved', ({ event }) => {
  console.log(`监听器已从 "${event}" 移除`)
})

const hub = createEventHub({ metaMode: 'full' })
// full  — 发射 beforeListenerAdd/Remove + listenerAdded/Removed，携带 handler
// lean  — 只发射 listenerAdded/Removed，不携带 handler
// smart — 默认：普通事件 full，meta 事件不递归
// simple — 完全禁用
```

### 其它

```ts
hub.setMaxListeners(20)       // 设置最大监听器数
hub.listenerCount('user:*')    // 统计匹配的监听器数
hub.removeAllListeners()       // 移除全部
hub.dispose()                  // 销毁实例
```

## 选项

```ts
createEventHub({
  delimiter?: string          // 通配符分隔符，默认 ':./'
  metaMode?: 'smart' | 'full' | 'lean' | 'simple'
  emitMode?: 'aggregate' | 'failFast' | 'silent'
  emitSafety?: 'safe' | 'fast'
  maxListenersAction?: 'warn' | 'throw' | 'silent' | ((event, count) => void)
})
```

## 许可

ISC
