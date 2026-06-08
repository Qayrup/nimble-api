# API Extend 概述

`@nimble-api/api-extend` 是 `@nimble-api/api-service` 的扩展包，提供轮询（polling）、并发控制等高级请求模式。

## 设计理念

- **零配置轮询** — 一条函数调用，声明式等待异步条件满足
- **并发控制** — 限制同时进行的 Promise 数量，FIFO 排队
- **类型安全** — `until` 谓词支持 type guard 窄化
- **可取消** — 通过 `AbortSignal` 优雅中断

## 安装

```bash
npm install @nimble-api/api-extend
```

## poll()

轮询执行异步函数，直到满足条件。

```ts
import { poll } from '@nimble-api/api-extend'

// 轮询订单状态直到支付完成
const payment = await poll(
  () => apiClient.get('/api/order/xyz'),
  {
    interval: 2000,        // 每 2 秒轮询一次
    until: (data) => data.status === 'paid',
    maxAttempts: 30,       // 最多 30 次（60 秒）
  }
)
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `fn` | `() => Promise<T>` | 轮询执行的异步函数 |
| `options.interval` | `number` | 轮询间隔（ms） |
| `options.until` | `(data: T) => boolean` | 成功条件谓词 |
| `options.maxAttempts` | `number` | 最大尝试次数，默认 `Infinity` |
| `options.stopIf` | `(data: T) => boolean` | 提前终止条件（失败） |
| `options.signal` | `AbortSignal` | 取消信号 |

### 错误类型

轮询可能抛出三种错误，可分别捕获：

```ts
import { PollCanceledError, PollTimeoutError, PollFailedError } from '@nimble-api/api-extend'

try {
  await poll(fetchStatus, { interval: 1000, until: (d) => d === 'done' })
} catch (err) {
  if (err instanceof PollCanceledError) {
    // AbortSignal 触发 → 用户主动取消
  } else if (err instanceof PollTimeoutError) {
    // maxAttempts 耗尽 → 超时
    console.log(`超时，尝试了 ${err.attempts} 次`)
  } else if (err instanceof PollFailedError) {
    // stopIf 条件满足 → 业务失败
    console.log('轮询失败:', err.data)
  }
}
```

### 结合 AbortSignal

```ts
const controller = new AbortController()

// 10 秒后自动取消
setTimeout(() => controller.abort(), 10_000)

const result = await poll(
  () => api.get('/status'),
  { interval: 1000, until: (d) => d === 'ready', signal: controller.signal }
)
```

### Type Guard 窄化

`until` 支持 TypeScript type guard，轮询结束后类型被自动窄化：

```ts
type Status = { state: 'pending' } | { state: 'done'; value: number }

const result = await poll(
  () => getStatus(),
  {
    interval: 500,
    until: (data): data is Status & { state: 'done' } => data.state === 'done',
  }
)
// result 类型被窄化为 { state: 'done'; value: number }
console.log(result.value) // ✅ 类型安全
```

## createConcurrencyLimit()

限制同时进行的 Promise 数量，超出部分 FIFO 排队。

```ts
import { createConcurrencyLimit } from '@nimble-api/api-extend'

const limiter = createConcurrencyLimit(4)

// 最多 4 个并发，其余排队
const results = await Promise.all(
  urls.map(url => limiter(() => fetch(url)))
)
```

### 参数

| 参数 | 类型 | 说明 |
|------|------|------|
| `limit` | `number` | 最大并发数，必须 >= 1 |

### 返回值

返回一个 `ConcurrencyLimiter` 对象，既可调用又带有属性：

```ts
interface ConcurrencyLimiter {
  <T>(fn: () => Promise<T>): Promise<T>;
  readonly running: number;   // 当前运行中的任务数
  readonly pending: number;   // 排队等待中的任务数
  clear(): void;              // 清空队列（不影响已运行的任务）
}
```

### 使用示例

**批量请求：**

```ts
const limiter = createConcurrencyLimit(3)

for (const id of ids) {
  limiter(() => apiClient.get(`/api/user/${id}`))
    .then(data => console.log(data))
}
```

**AbortSignal 配合清空队列：**

```ts
const limiter = createConcurrencyLimit(2)
const controller = new AbortController()

const task = limiter(() => apiClient.get('/api/data', { signal: controller.signal }))

// 取消排队 + 清空队列
controller.abort()
limiter.clear()
```

**监控并发状态：**

```ts
console.log(`进行中: ${limiter.running}, 排队: ${limiter.pending}`)
```

## 错误类型

### PollCanceledError

当 `AbortSignal` 触发时抛出。

```ts
new PollCanceledError()
```

### PollTimeoutError

当 `maxAttempts` 耗尽时抛出，包含 `attempts` 属性。

```ts
new PollTimeoutError(attempts: number, interval: number)
```

### PollFailedError\<T\>

当 `stopIf` 条件满足时抛出，包含 `data` 属性。

```ts
new PollFailedError(data: T)
```
