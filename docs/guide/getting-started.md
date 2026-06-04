# 快速开始

## 安装

```bash
# 安装 eventhub（可独立使用）
npm install @nimble-api/eventhub

# 安装 api-service（会同时安装 eventhub）
npm install @nimble-api/api-service
```

## 基本用法 — EventHub

```ts
import { createEventHub } from '@nimble-api/eventhub';

// 定义事件类型
interface MyEvents {
  'user:login': { userId: string; timestamp: number };
  'user:logout': { userId: string };
}

const hub = createEventHub<MyEvents>();

// 订阅事件
const unsub = hub.on('user:login', (payload) => {
  console.log(`用户 ${payload.userId} 登录`);
});

// 一次性监听
const payload = await hub.once('user:login', { timeout: 5000 });

// 派发事件
await hub.emit('user:login', { userId: 'u1', timestamp: Date.now() });

// 取消订阅
unsub();
```

## 基本用法 — ApiClient

```ts
import { createApiClient } from '@nimble-api/api-service';

const api = createApiClient({
  baseUrl: 'https://api.example.com',
  headers: { Authorization: 'Bearer token' },
  retry: { limit: 3 },
  cache: { ttl: 30000, maxSize: 100 },
});

// GET 请求（自动缓存）
const user = await api.get('/users/1');

// POST 请求
const newUser = await api.post('/users', {
  json: { name: 'Alice', email: 'alice@example.com' },
});

// 带参数请求
const posts = await api.get('/users/{id}/posts', {
  params: { id: '1' },
  searchParams: { page: 1, limit: 10 },
});

// 扩展客户端
const authApi = api.extend({
  headers: { 'X-Custom': 'value' },
});
```

## 组合使用

将 EventHub 注入 ApiClient 以实现全局事件监听：

```ts
import { createEventHub } from '@nimble-api/eventhub';
import { createApiClient } from '@nimble-api/api-service';

const hub = createEventHub();

// 监听 API 成功/失败事件
hub.on('api:success', ({ url, data }) => {
  console.log(`请求成功: ${url}`, data);
});

hub.on('api:error', ({ url, error }) => {
  console.error(`请求失败: ${url}`, error);
});

const api = createApiClient({
  baseUrl: 'https://api.example.com',
  eventHub: hub, // 注入事件中心
});

// 请求会自动触发事件
await api.get('/users/1');
```

## 类型安全的端点定义

```ts
import { createApiClient, createTypedApi } from '@nimble-api/api-service';
import { z } from 'zod';

const client = createApiClient({ baseUrl: 'https://api.example.com' });

const typed = createTypedApi(client, {
  getUser: {
    method: 'GET',
    path: '/users/{id}',
    schema: z.object({ id: z.string(), name: z.string() }),
  },
  createUser: {
    method: 'POST',
    path: '/users',
    schema: z.object({ id: z.string(), name: z.string() }),
  },
});

// 完全类型推导
const user = await typed.getUser({ params: { id: '1' } });
// user 类型为 { id: string; name: string }
```
