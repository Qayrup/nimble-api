# nimble-api

TypeScript 前端 API 基础设施，轻量、类型安全、渐进式。

## 包

| 包 | 版本 | 说明 |
|---|---|---|
| [`@nimble-api/eventhub`](./eventhub) | ![version](https://img.shields.io/badge/version-1.1.0-blue) | 轻量级事件中心，支持 glob 通配符、meta 事件、快照迭代 |
| [`@nimble-api/api-service`](./api-service) | ![version](https://img.shields.io/badge/version-1.0.0-blue) | API 客户端框架：缓存、重试、防抖/节流、并发锁、类型安全端点 |
| [`@nimble-api/api-extend`](./api-extend) | ![version](https://img.shields.io/badge/version-1.0.0-blue) | 高级请求模式：轮询、并发控制 |
| [`@nimble-api/sse-service`](./sse-service) | ![version](https://img.shields.io/badge/version-1.0.0-blue) | SSE (Server-Sent Events) 客户端，支持自动重连 |

## 快速开始

```bash
npm install @nimble-api/api-service
```

```ts
import { createApiClient, createTypedApi } from '@nimble-api/api-service'

const client = createApiClient({ baseUrl: 'https://api.example.com' })

const api = createTypedApi(client, {
  getUser: {
    url: '/users/{userId}',
    _params: {} as { userId: string },
    _response: {} as { id: string; name: string },
  },
})

const user = await api.getUser({ params: { userId: '123' } })
//     ^ { id: string; name: string }
```

## 技术栈

- **运行时**: Node.js >= 18 / 现代浏览器
- **语言**: TypeScript (ESM + CJS 双输出)
- **构建**: tsup
- **测试**: vitest

## 文档

完整文档 → [docs/](./docs)

## 许可

ISC
