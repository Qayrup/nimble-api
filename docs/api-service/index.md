# API Service 概述

`@nimble-api/api-service` 是一个功能完备的 TypeScript API 客户端框架，构建于 `@nimble-api/eventhub` 之上，提供缓存、重试、钩子、适配器等企业级特性。

## 设计理念

- **可插拔适配器** — 实现 `RequestAdapter` 接口即可接入任意 HTTP 层
- **钩子管线** — 覆盖请求生命周期的 4 个节点，支持状态修改和中止
- **智能缓存** — LRU + TTL + SWR 三模式，支持标签批量失效
- **类型优先** — 请求/响应/选项全链路类型安全

## 架构概览

```
                    ┌──────────────────────────┐
                    │       ApiClient           │
                    │                           │
  get/post/    ──►  │  #request()              │
  put/patch/        │    ├─ beforeRequest hooks │
  delete            │    ├─ cache check         │
                    │    ├─ adapter.request()   │
                    │    ├─ transformResponse   │
                    │    ├─ validateStatus      │
                    │    ├─ parser              │
                    │    ├─ schema validate     │
                    │    ├─ afterResponse hooks │
                    │    ├─ cache store         │
                    │    └─ event dispatch      │
                    │                           │
                    │  依赖:                    │
                    │   ├─ MemoryCache          │
                    │   ├─ RequestAdapter       │
                    │   ├─ EventHub             │
                    │   ├─ Hooks pipeline       │
                    │   ├─ transformResponse    │
                    │   └─ parser               │
                    └──────────────────────────┘
```

## 请求生命周期

一次完整的请求经过以下阶段：

1. **init 钩子** — 修改请求选项（注入 token、默认参数等）
2. **beforeRequest 钩子** — 修改请求配置（URL、headers、body）
3. **请求去重检查** — 相同请求并发只发一次
4. **缓存检查** — TTL 命中直接返回 / SWR 命中返回旧值后台刷新
5. **适配器请求** — 实际 HTTP 调用
6. **transformResponse** — 响应格式归一化（ABP / 通用格式）
7. **状态码检查** — 非 2xx 抛出 `ApiError`（含 parser 提取的错误消息）
8. **parser** — 业务成功/失败判断 + 数据解包（默认识别 `{code, msg, result}`）
9. **Schema 校验** — `parse()` 或 `safeParse()` 验证响应
10. **afterResponse 钩子** — 后置处理（逆序执行）
11. **缓存存储** — 写入缓存 + 提取实体标签
12. **事件派发** — 通过 EventHub 发射 onSuccess/onError 事件
13. **重试（失败时）** — beforeRetry → backoff → 重新发起（ERR_BUSINESS 不重试）

## 核心类

| 类/函数 | 说明 |
|---------|------|
| `ApiClient` | HTTP 客户端主类 |
| `createApiClient()` | 工厂函数 |
| `MemoryCache` | LRU 内存缓存（可独立使用） |
| `ApiError` | 结构化请求错误 |

## 核心工具函数

| 函数 | 说明 |
|------|------|
| `calcBackoff()` | 计算重试延迟 |
| `shouldRetry()` | 判断是否应重试 |
| `runBeforeRequest()` | 运行 beforeRequest 钩子链 |
| `runAfterResponse()` | 运行 afterResponse 钩子链 |
| `runBeforeRetry()` | 运行 beforeRetry 钩子链 |
| `runBeforeError()` | 运行 beforeError 钩子链 |
| `defaultParser()` | 默认业务解析器，识别 `{code, msg, result}` |
| `createResultParser()` | 创建结果包装器，成功时返回 `ApiResult<T>` |
| `createFetchAdapter()` | 创建 fetch 适配器 |
| `createUniAppAdapter()` | 创建 uni-app 适配器 |
| `createTypedApi()` | 创建类型安全的端点包装器 |
