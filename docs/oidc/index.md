# OIDC 客户端

`@nimble-api/oidc` 是 OAuth 2.0 / OpenID Connect 客户端，Authorization Code + PKCE 流程，零外部依赖，与 `@nimble-api/api-service` 深度集成。

## 设计理念

- **零外部依赖** — PKCE 用 Web Crypto API，协议逻辑自实现（~300 行核心代码）
- **Token 安全存储** — RefreshToken 仅存内存（XSS 无法窃取），AccessToken 存 sessionStorage（Tab 隔离）
- **多 Tab 同步** — BroadcastChannel 跨 Tab 广播 Token 变更，静默刷新只在一个 Tab 执行
- **自动刷新** — AccessToken 过期前 60s 自动用 refresh_token 获取新 Token
- **api-service 可选** — OidcClient 可独立使用；Hook 工厂让你用一行代码接入 ApiClient

## 安装

```bash
npm install @nimble-api/oidc @nimble-api/api-service
```

`@nimble-api/api-service` 是可选 peer dependency——仅在使用 `createOidcAuthHook` / `createOidcRetryHook` 时需要。

## 快速开始

### 1. 创建 OidcClient

```ts
import { OidcClient } from '@nimble-api/oidc'

const oidc = new OidcClient({
  authority: 'https://localhost:44311',       // OpenIddict / IdentityServer 地址
  clientId: 'aureus-spa',                     // 注册的 client_id
  redirectUri: `${location.origin}/callback`, // 授权码回调地址
  postLogoutRedirectUri: location.origin,     // 登出后跳回地址
})
```

### 2. 发起登录

```ts
// 点击"登录"按钮时调用
await oidc.login()
// → 浏览器重定向到 {authority}/connect/authorize
```

### 3. 处理回调

在回调页面（`/callback`）的初始化代码中：

```ts
const params = new URLSearchParams(location.search)
await oidc.handleCallback(params)
// → 用 authorization_code 换 Token，存入存储，启动自动刷新
```

### 4. 接入 ApiClient

```ts
import { createApiClient } from '@nimble-api/api-service'
import { createOidcAuthHook, createOidcRetryHook } from '@nimble-api/oidc'

const api = createApiClient({
  baseUrl: '/api',
  hooks: {
    beforeRequest: [createOidcAuthHook(oidc)],    // 自动注入 Bearer Token
    beforeRetry:   [createOidcRetryHook(oidc)],   // 401 自动静默刷新
  },
})
```

### 5. 登出

```ts
await oidc.logout()
// → 吊销 refresh_token → 清理存储 → 重定向到 end_session_endpoint
```

---

## 配置项 `OidcConfig`

| 属性 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `authority` | `string` | **必填** | Authorization Server 的 issuer URL |
| `clientId` | `string` | **必填** | 注册的 client_id |
| `redirectUri` | `string` | **必填** | 授权码回调地址 |
| `postLogoutRedirectUri` | `string` | **必填** | 登出后跳回地址 |
| `scopes` | `string[]` | `['openid', 'profile', 'offline_access']` | 请求的 scope |
| `silentRefreshUri` | `string?` | — | 静默刷新 iframe 页面 URL（预留） |
| `onBeforeLogin` | `() => void` | — | 登录重定向前回调 |

---

## API 参考

### `login()`

发起 Authorization Code + PKCE 流程。生成 PKCE code_verifier + code_challenge，存入 sessionStorage，然后重定向到 authorization_endpoint。

```ts
await oidc.login()
```

流程：
1. 获取 OIDC 发现文档（`.well-known/openid-configuration`），内存缓存
2. 生成 PKCE pair（SHA-256），verifier 存 sessionStorage
3. 生成随机 state，存 sessionStorage
4. 浏览器重定向到 `{authorization_endpoint}?response_type=code&...&code_challenge=...`
5. `onBeforeLogin` 在此前调用

### `handleCallback(urlParams)`

处理授权回调。校验 state，用 authorization_code 换 Token，存入存储并启动自动刷新。

```ts
await oidc.handleCallback(new URLSearchParams(location.search))
```

流程：
1. 校验 state 是否与 sessionStorage 中一致 → 不一致抛 `OidcStateError`
2. 取出 code 和 code_verifier
3. POST token_endpoint → 换 Token
4. 存入 TokenStore → BroadcastChannel 广播 → 启动静默刷新定时器
5. 清理 sessionStorage 中的临时数据

抛错：`OidcStateError`（state 不匹配）、`OidcTokenError`（服务端返回错误）

### `silentRefresh()`

用 refresh_token 获取新 Token。失败时（invalid_grant）清除 Token 并广播过期。

```ts
const newToken = await oidc.silentRefresh()
// 成功返回 TokenSet，session 过期返回 null（并清除已存 Token）
```

Token 轮换：如果服务端未返回新 refresh_token，保留旧值（兼容一次性 refresh_token 和 rotation）。

### `logout()`

清理 Token 并登出。尝试吊销 refresh_token（best-effort），清除存储，广播登出，重定向。

```ts
await oidc.logout()
```

### `getAccessToken()`

返回当前有效的 AccessToken，过期或无 Token 返回 `null`。

```ts
const token = oidc.getAccessToken()
// token: string | null
```

### `isAuthenticated()`

当前是否已认证（Token 存在且未过期）。

```ts
if (oidc.isAuthenticated()) {
  // 已登录
}
```

### `waitForInitialSync()`

等待多 Tab 初始同步完成（300ms 内等待其他 Tab 响应 Token probe）。

```ts
await oidc.waitForInitialSync()
// 之后 getAccessToken() 反映跨 Tab 同步的最新状态
```

### `onTokenChanged(callback)`

Token 变更时触发（登录/刷新/登出/过期）。返回取消订阅函数。

```ts
const unsub = oidc.onTokenChanged(({ token, source }) => {
  // source: 'login' | 'silent-refresh' | 'logout' | 'expired'
  console.log('Token 变更:', source, token?.accessToken)
})
```

### `dispose()` / `[Symbol.dispose]()`

销毁客户端，清除定时器和监听器（不清除已存 Token）。

```ts
oidc.dispose()
// 或
using oidc = new OidcClient(config)
```

---

## 与 api-service 集成

### `createOidcAuthHook(client)`

创建 Bearer Token 注入 Hook。每次请求前自动调用 `client.getAccessToken()`。

```ts
import { createOidcAuthHook } from '@nimble-api/oidc'

const api = createApiClient({
  hooks: {
    beforeRequest: [createOidcAuthHook(oidc)],
  },
})
```

### `createOidcRetryHook(client)`

创建 401 自动刷新 Hook。拦截 401 响应 → 调用 `silentRefresh()` → 成功后允许重试 → 失败停止。

```ts
import { createOidcRetryHook } from '@nimble-api/oidc'

const api = createApiClient({
  hooks: {
    beforeRetry: [createOidcRetryHook(oidc)],
  },
})
```

> Hook 内部通过 `state.meta.__oidc_retried` 标记防止无限重试循环。每次请求最多尝试一次静默刷新。

---

## 独立使用（不依赖 api-service）

OidcClient 核心不依赖 api-service。可独立使用，手动管理 HTTP 请求：

```ts
const oidc = new OidcClient({
  authority: 'https://auth.example.com',
  clientId: 'my-app',
  redirectUri: `${location.origin}/callback`,
  postLogoutRedirectUri: location.origin,
})

// 手动注入 token
const token = oidc.getAccessToken()
const res = await fetch('/api/data', {
  headers: token ? { Authorization: `Bearer ${token}` } : {},
})

// 手动处理 401
if (res.status === 401) {
  const refreshed = await oidc.silentRefresh()
  if (refreshed) {
    // 用新 token 重试
  } else {
    // session 过期，引导用户重新登录
    await oidc.login()
  }
}
```

---

## Token 存储策略

| 层 | 存储位置 | 生命周期 | 数据 |
|----|---------|---------|------|
| L1 | 内存变量 | 页面关闭即失效 | **RefreshToken**（XSS 不可读） |
| L2 | `sessionStorage` | Tab 关闭即失效 | AccessToken + expiresAt（sessionStorage Tab 隔离） |

为什么用 sessionStorage 而非 localStorage：
- Tab 级隔离，关浏览器自动清除
- RefreshToken 仅存内存，XSS 无法通过 `localStorage.getItem()` 窃取
- AccessToken 短期过期（15 分钟），存 sessionStorage 泄露影响有限

---

## 多 Tab 同步

使用 BroadcastChannel API 在多个 Tab 间广播 Token 变更：

```
Tab A: 静默刷新成功 → broadcast(newToken, 'silent-refresh')
Tab B: 收到广播 → setToken(newToken) → getAccessToken() 返回新 Token
```

- 不支持 BroadcastChannel 的环境（Node.js、旧浏览器）静默降级为 no-op
- 新打开的 Tab 通过 `waitForInitialSync()` 请求其他 Tab 的当前 Token 状态
- Token 变更通过 `onTokenChanged` 回调通知

---

## 错误类型

| 错误类 | 场景 |
|--------|------|
| `OidcError` | 通用 OIDC 错误（基类） |
| `OidcStateError` | State 校验失败（CSRF 攻击或回调被篡改） |
| `OidcTokenError` | Token 端点返回错误（含 `error` 字段，如 `invalid_grant`） |
| `OidcUnavailableError` | 需要的 Web API 不可用（如 Node.js 环境调用 `login()`） |

---

## PKCE 工具

```ts
import { generatePkcePair, createPkcePair } from '@nimble-api/oidc'

const pkce = await generatePkcePair()
// pkce.codeVerifier — 128 字节随机 → base64url
// pkce.codeChallenge — SHA-256(verifier) → base64url

// 仅供测试：手动构造
const testPair = createPkcePair('test-verifier')
```

---

## SessionSync（高级）

`SessionSync` 是多 Tab Token 同步器，通常 OidcClient 内部使用，也可独立使用：

```ts
import { SessionSync } from '@nimble-api/oidc'

const sync = new SessionSync('my-client-id')

sync.onUpdate((token, source) => {
  console.log('其他 Tab 广播了 Token 变更', source)
})

sync.onProbe(() => {
  // 新 Tab 打开时被询问当前 Token 状态
  // 如果持有有效 Token，调用 sync.broadcast(token, 'login')
})

sync.broadcast(token, 'login')
sync.dispose()
```

## TokenStore（高级）

`TokenStore` 是双层存储实现，通常 OidcClient 内部使用：

```ts
import { TokenStore } from '@nimble-api/oidc'

const store = new TokenStore()
store.setToken(tokenSet)
store.getToken()     // TokenSet | null
store.isExpired(60)  // 是否在 60s 内过期（默认 60s 缓冲）
store.clear()
```
