# 项目介绍

Nimble-API 是一个轻量级的 TypeScript API 服务框架，采用 monorepo 架构，包含两个独立发布的包。

## 设计理念

- **最小化依赖** — eventhub 零外部依赖，api-service 仅依赖 eventhub
- **渐进增强** — 可以只用 eventhub 做事件管理，也可以搭配 api-service 做完整的 API 客户端
- **类型优先** — 所有 API 都经过完整的 TypeScript 类型推导
- **可扩展** — 适配器模式支持任意 HTTP 层，钩子系统支持任意生命周期拦截

## 包概览

### @nimble-api/eventhub

轻量级事件管理器，基于 Map + Set 实现 O(1) 的监听器查找。支持：

- 类型安全的事件订阅与派发
- `once()` Promise 语义 + timeout + filter
- `emitSerial()` 顺序异步执行
- `events()` AsyncIterable 流式消费
- AbortSignal 取消订阅
- 快照安全的 emit（emit 期间可增删监听器）
- Debounce/Throttle（防抖/节流，支持 options 传参和链式调用）

### @nimble-api/api-service

功能完备的 API 客户端框架，依赖 eventhub 做事件派发。支持：

- 完整 HTTP 方法（GET/POST/PUT/PATCH/DELETE）
- LRU 缓存 + TTL + SWR 模式
- 可配置重试策略（指数退避/固定延迟）
- 钩子管线（请求前、响应后、重试前、错误处理）
- 请求去重（相同请求并发只发一次）
- 端点级 lock/debounce/throttle（并发锁、防抖、节流）
- Schema 校验（Zod 等任意 parse/safeParse 实现）
- 实体标签提取与缓存失效
- 可插拔适配器（内置 fetch 和 uni-app）

## 架构关系

```
@nimble-api/eventhub  ←  零依赖
         ↑
         |  依赖（事件派发）
         |
@nimble-api/api-service  ←  依赖 eventhub
```

两个包可以独立使用，也可以组合使用。api-service 通过 `EventHubLike` 接口接收任意兼容的事件中心实例。
