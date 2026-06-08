# 项目介绍

Nimble-API 是一个轻量级的 TypeScript API 服务框架，采用 monorepo 架构，包含 5 个独立发布的包，覆盖从事件管理到 HTTP 客户端的完整能力栈。

## 设计理念

- **最小化依赖** — eventhub 零外部依赖，api-service 仅依赖 eventhub
- **渐进增强** — 可以只用 eventhub 做事件管理，也可以搭配 api-service 做完整的 API 客户端
- **类型优先** — 所有 API 都经过完整的 TypeScript 类型推导
- **可扩展** — 适配器模式支持 fetch / XHR / uni-app / Node.js，钩子系统支持任意生命周期拦截

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

- 完整 HTTP 方法（GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS）
- LRU 缓存 + TTL + SWR 模式
- 可配置重试策略（指数退避/固定延迟）
- 钩子管线（init → beforeRequest → afterResponse → beforeRetry → beforeError）
- 请求去重（相同请求并发只发一次）
- 端点级 lock/debounce/throttle（并发锁、防抖、节流）
- Schema 校验（Zod 等任意 parse/safeParse 实现）
- 实体标签提取与缓存失效
- 可插拔适配器（内置 fetch、XHR、uni-app）
- Bearer / Basic Auth 内置钩子，支持动态凭据
- DELETE body 模式可选（query string 或 JSON body）
- 请求体大小限制（maxBodyLength）+ 响应大小限制（maxContentLength）
- XSRF 自动防护

### @nimble-api/node-adapter

Node.js 原生 `http`/`https` 适配器，提供服务端生产级能力。支持：

- keepAlive 连接池（TCP 复用）
- HTTP_PROXY / HTTPS_PROXY / NO_PROXY 代理
- 301/302/303/307/308 自动重定向
- `responseType: 'stream'` — 流式响应，无需缓冲到内存
- gzip/deflate/brotli 自动解压
- 自定义 TLS 证书、客户端证书
- Cookie jar 自动管理（SimpleCookieJar 内置）
- Unix socket、自定义 DNS 解析
- 连接超时与读取超时分离

### @nimble-api/sse-service

### @nimble-api/api-extend

## 架构关系

```
@nimble-api/eventhub  ←  零依赖
         ↑
         |  依赖（事件派发）
         |
@nimble-api/api-service  ←  依赖 eventhub
         ↑
         |  peerDependency（adapter 接口）
         |
@nimble-api/node-adapter  ←  依赖 api-service 类型
```

另外两个独立包：

- `@nimble-api/sse-service` — 原生 SSE 客户端，无框架依赖
- `@nimble-api/api-extend` — 轮询 + 并发控制扩展，无框架依赖

所有包可独立使用或自由组合。api-service 通过 `EventHubLike` 接口接收任意事件中心，通过 `RequestAdapter` 接口接入任意 HTTP 适配器。
