# 重试策略

## 默认配置

```ts
const DEFAULT_RETRY = {
  limit: 2,                     // 最多重试 2 次
  methods: ['GET', 'PUT', 'HEAD', 'DELETE', 'OPTIONS', 'TRACE'],
  statusCodes: [408, 413, 429, 500, 502, 503, 504],
  backoff: 'exponential',       // 退避策略
  baseDelay: 1000,              // 基准延迟（ms）
  maxDelay: 30000,              // 最大延迟（ms）
};
```

## 配置方式

**全局配置：**

```ts
const api = createApiClient({
  retry: { limit: 3, backoff: 'fixed', baseDelay: 2000 },
});

// 禁用重试
const api = createApiClient({ retry: false });
```

**请求级覆盖（与全局合并）：**

```ts
await api.get('/unstable', {
  retry: { limit: 5, statusCodes: [500, 502, 503] },
});
```

---

## 退避策略

### 指数退避 (exponential)

```
delay = baseDelay × 2^(attempt - 1) + random(0, 200ms)
```

第 1 次重试：~1s，第 2 次：~2s，第 3 次：~4s（上限 maxDelay）。

### 固定延迟 (fixed)

```
delay = baseDelay + random(0, 200ms)
```

每次重试间隔相同。

---

## 重试判定

`shouldRetry()` 函数的判定逻辑：

1. 检查 HTTP 方法是否在允许列表中
2. 如果有状态码，检查是否在允许的状态码列表中
3. 网络错误（无状态码）对允许的 HTTP 方法默认可重试

---

## 中止重试

在 `beforeRetry` 钩子中返回 `stop` symbol 可中止重试链：

```ts
import { stop } from '@nimble-api/api-service';

const api = createApiClient({
  hooks: {
    beforeRetry: [
      (state) => {
        if (state.error?.status === 401) return stop;
        if (state.error?.status === 422) return stop;
        return state;
      },
    ],
  },
});
```

---

## calcBackoff

独立导出的退避计算函数：

```ts
import { calcBackoff, type RetryConfig } from '@nimble-api/api-service';

const config: RetryConfig = {
  backoff: 'exponential',
  baseDelay: 500,
  maxDelay: 10000,
};

const delay = calcBackoff(config, 3); // 第 3 次重试的延迟
// exponential: 500 × 2^2 = 2000ms + jitter

const delay2 = calcBackoff({ ...config, backoff: 'fixed' }, 3);
// fixed: 500ms + jitter
```

---

## shouldRetry

独立导出的重试判定函数：

```ts
import { shouldRetry } from '@nimble-api/api-service';

const config = { limit: 3, statusCodes: [500, 502, 503] };

shouldRetry(config, 500, 'GET');   // true
shouldRetry(config, 404, 'GET');   // false — 404 不在列表中
shouldRetry(config, undefined, 'GET'); // true — 网络错误可重试
shouldRetry(config, 500, 'POST');  // false — POST 不在默认方法列表中
```
