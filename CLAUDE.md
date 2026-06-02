# nimble-api

TypeScript monorepo (npm workspaces)，Node.js >= 18，包管理工具 npm，构建工具 tsup。

## 工作区

- **@nimble-api/eventhub** (`eventhub/`) — 轻量级事件管理器，基于 AdvancedEventEmitter，支持单例模式和工厂函数创建。
- **@nimble-api/api-service** (`api-service/`) — 轻量级 API 服务框架，支持动态方法生成、请求缓存、防抖/节流等优化策略。依赖 eventhub 做事件派发。

## 常用命令

- `npm run build` — 构建所有工作区（先 eventhub，后 api-service）
- `npm run typecheck` — 所有工作区类型检查
- `npm test` — vitest 运行所有测试
- `npm run lint` / `npm run format` — ESLint / Prettier
- `npm run clean` — 清理所有工作区构建产物

## 关键约定

- 源码使用 ESM 模块（`.mjs` 输出），同时输出 CJS（`.js`）
- 每个包导出一个只读 Proxy 作为默认导出（单例），同时导出 `init*` / `create*` / `destroy*` 函数
- api-service 依赖 eventhub（workspace 内 `"@nimble-api/eventhub": "*"`）
