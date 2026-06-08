# @nimble-api/api-extend

`@nimble-api/api-service` 扩展包，提供轮询、并发控制等高级请求模式。

```bash
npm install @nimble-api/api-extend
```

## createConcurrencyLimit()

限制同时进行的 Promise 数量，超出部分 FIFO 排队。

```ts
import { createConcurrencyLimit } from '@nimble-api/api-extend'

const limiter = createConcurrencyLimit(4)

// 最多 4 个并发
const results = await Promise.all(
  urls.map(url => limiter(() => fetch(url)))
)

// 实时监控
console.log(limiter.running)  // 当前运行中
console.log(limiter.pending)  // 排队等待中

// 清空队列
limiter.clear()
```

配合 api-service 使用：

```ts
const limiter = createConcurrencyLimit(3)

for (const file of files) {
  limiter(() => client.post('/upload', { body: file }))
    .then(() => console.log('完成'))
    .catch(err => console.error('失败', err))
}
```

### API

```ts
interface ConcurrencyLimiter {
  <T>(fn: () => Promise<T>): Promise<T>
  readonly running: number
  readonly pending: number
  clear(): void
}
```

- `limit < 1` 抛出错误
- 任务 reject 不影响后续队列
- `clear()` 只清队列，不中断运行中的任务

## poll()

轮询执行异步函数，直到满足条件。

```ts
import { poll } from '@nimble-api/api-extend'

const result = await poll(
  () => client.get('/api/order/xyz'),
  {
    interval: 2000,                    // 每 2 秒轮询
    until: (data) => data.status === 'paid',
    maxAttempts: 30,                   // 最多 30 次（60 秒）
  }
)
```

### API

```ts
function poll<T>(
  fn: () => Promise<T>,
  options: {
    interval: number           // 轮询间隔 ms
    until: (data: T) => boolean // 成功条件
    maxAttempts?: number        // 最大尝试次数，默认 Infinity
    stopIf?: (data: T) => boolean // 提前失败条件
    signal?: AbortSignal        // 取消信号
  }
): Promise<T>
```

### Type Guard 窄化

```ts
type Status = { state: 'pending' } | { state: 'done'; value: number }

const result = await poll(() => getStatus(), {
  interval: 500,
  until: (data): data is Status & { state: 'done' } => data.state === 'done',
})
// result: { state: 'done'; value: number }
```

### 错误处理

```ts
import { PollCanceledError, PollTimeoutError, PollFailedError } from '@nimble-api/api-extend'

try {
  await poll(fn, { interval: 1000, until: () => false, maxAttempts: 10 })
} catch (err) {
  if (err instanceof PollCanceledError) {
    // AbortSignal 触发
  } else if (err instanceof PollTimeoutError) {
    console.log(`超时，尝试了 ${err.attempts} 次`)
  } else if (err instanceof PollFailedError) {
    console.log('业务失败:', err.data)
  }
}
```

## 许可

ISC
