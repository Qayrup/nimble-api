# nimble-api

TypeScript monorepo (npm workspaces)，Node.js >= 18，包管理工具 npm，构建工具 tsup。

## 工作区

- **@nimble-api/eventhub** (`eventhub/`) — 轻量级事件管理器，零依赖，支持 glob 匹配、meta 事件、AsyncIterable 流式消费。
- **@nimble-api/api-service** (`api-service/`) — 轻量级 API 客户端框架，支持缓存（TTL/SWR）、重试、防抖/节流、Schema 校验、XSRF 防护。依赖 eventhub 做事件派发。
- **@nimble-api/node-adapter** (`node-adapter/`) — Node.js `http`/`https` 适配器，支持连接池、proxy、重定向、流式响应、TLS、Cookie jar。peerDependency 依赖 api-service 类型。
- **@nimble-api/api-extend** (`api-extend/`) — 独立扩展工具包，poll() 轮询和 createConcurrencyLimit() 并发控制。
- **@nimble-api/sse-service** (`sse-service/`) — SSE (Server-Sent Events) 客户端，自动重连、Last-Event-ID。

## 常用命令

- `npm run build` — 构建所有工作区（eventhub → api-service → api-extend → sse-service → node-adapter）
- `npm run typecheck` — 所有工作区类型检查
- `npm test` — vitest 运行所有测试
- `npm run lint` / `npm run format` — ESLint / Prettier
- `npm run clean` — 清理所有工作区构建产物
- `npm run publish:verdaccio` — 发布所有包到 Verdaccio（自动版本自增）

## 关键约定

- 源码使用 ESM 模块（`.mjs` 输出），同时输出 CJS（`.js`）
- 工厂函数模式：`create*()` 创建实例，`ApiClient.dispose()` / `EventHub.dispose()` 销毁
- api-service 依赖 eventhub（workspace 内 `"@nimble-api/eventhub": "*"`）
- node-adapter peerDependency 依赖 api-service（adapter 接口类型）
