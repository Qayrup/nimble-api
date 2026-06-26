# @nimble-api/oidc — 实施计划

> 基于 `oauth2-authorization-code-flow.md` 第二部分，为 nimble-api 新增 OIDC 客户端包。
> 零侵入：api-service 和 eventhub 不需任何修改。

---

## 一、包结构

```
oidc/                              ← 新增于 nimble-api 根目录
  src/
    index.ts                       ← 公开 API 入口
    OidcClient.ts                  ← 核心客户端
    pkce.ts                        ← PKCE challenge/verifier
    token-store.ts                 ← Token 双层存储
    session-sync.ts                ← BroadcastChannel 多 Tab 同步
    oidc-auth-hook.ts              ← nimble-api hook 工厂
    types.ts                       ← 类型定义
  package.json
  tsconfig.json
  tsup.config.ts
```

---

## 二、各文件详细设计

### 2.1 `types.ts` — 类型定义

```typescript
/** OIDC 客户端配置 */
export interface OidcConfig {
  /** Authorization Server 的 issuer URL，如 "https://localhost:44311" */
  authority: string
  /** OpenIddict 中注册的 client_id */
  clientId: string
  /** 授权码回调地址 */
  redirectUri: string
  /** 登出后跳回地址 */
  postLogoutRedirectUri: string
  /** 静默刷新 iframe 页面 URL */
  silentRefreshUri?: string
  /** 请求的 scope，默认 ["openid", "profile", "offline_access"] */
  scopes?: string[]
  /** 请求前回调（可在此处拼接额外参数） */
  onBeforeLogin?: () => void
}

/** Token 集合 */
export interface TokenSet {
  accessToken: string
  refreshToken?: string
  expiresAt: number       // Unix 毫秒时间戳
  idToken?: string
  tokenType: string
  scope?: string
}

/** OIDC 发现文档（仅取用到的字段） */
export interface OidcMetadata {
  issuer: string
  authorization_endpoint: string
  token_endpoint: string
  userinfo_endpoint: string
  revocation_endpoint: string
  end_session_endpoint?: string
  scopes_supported?: string[]
}

/** PKCE 参数对 */
export interface PkcePair {
  codeVerifier: string
  codeChallenge: string
}

/** 静默刷新结果事件 */
export interface TokenChangedEvent {
  token: TokenSet | null
  source: 'login' | 'silent-refresh' | 'logout' | 'expired'
}
```

### 2.2 `pkce.ts` — PKCE 生成

```typescript
import type { PkcePair } from './types'

/**
 * 生成 PKCE code_verifier 和 code_challenge。
 * verifier: 128 字节随机 → base64url
 * challenge: SHA-256(verifier) → base64url
 */
export function generatePkcePair(): PkcePair

/**
 * 仅供测试：手动构造 PKCE pair
 */
export function createPkcePair(verifier: string): PkcePair
```

**实现要点**：

| 步骤 | API |
|------|-----|
| 生成随机字节 | `crypto.getRandomValues(new Uint8Array(128))` |
| 计算 SHA-256 | `crypto.subtle.digest('SHA-256', encoded)` |
| Base64URL 编码 | 自实现：标准 base64 → replace `+`/`/` → `-`/`_`，去掉 `=` |

```
generateCodeVerifier():
  1. arr = crypto.getRandomValues(new Uint8Array(128))
  2. return base64UrlEncode(arr)

generateCodeChallenge(verifier):
  1. encoded = new TextEncoder().encode(verifier)
  2. hash = await crypto.subtle.digest('SHA-256', encoded)
  3. return base64UrlEncode(new Uint8Array(hash))
```

### 2.3 `token-store.ts` — Token 双层存储

```typescript
import type { TokenSet } from './types'

export class TokenStore {
  /**
   * 从内存或 sessionStorage 获取 Token。
   * 返回 null 表示无有效 Token。
   */
  getToken(): TokenSet | null

  /**
   * 存入内存 + sessionStorage。
   */
  setToken(token: TokenSet): void

  /**
   * 清除内存 + sessionStorage 中的 Token。
   */
  clear(): void

  /**
   * 检查 Token 是否过期。
   * @param skewMs 提前多少毫秒判定过期，默认 60_000（1 分钟缓冲）
   */
  isExpired(skewMs?: number): boolean
}
```

**存储策略**：

| 层 | 存储位置 | 生命周期 | 用途 |
|----|---------|---------|------|
| L1 | 内存变量 | 页面关闭即失效 | 快速读取，XSS 无法通过 `localStorage` 窃取 RefreshToken |
| L2 | `sessionStorage` | Tab 关闭即失效 | 页面刷新后恢复 |

为什么 `sessionStorage` 而非 `localStorage`：
- `sessionStorage` 是 Tab 级隔离，关浏览器自动清除
- RefreshToken 存在 L1（内存）中 → XSS 无法读取
- AccessToken 可存 L2，因为 15 分钟过期，即使泄露影响有限

### 2.4 `session-sync.ts` — 多 Tab 同步

```typescript
import type { TokenSet } from './types'

/**
 * 多 Tab Token 同步器。
 * 一个 Tab 刷新 Token 后，其他 Tab 自动同步。
 * 使用 BroadcastChannel API，在 Node 环境或旧浏览器中静默降级。
 */
export class SessionSync {
  constructor(channelName: string)

  /**
   * 向其他 Tab 广播 Token 更新。
   */
  broadcast(token: TokenSet | null, source: 'login' | 'silent-refresh' | 'logout'): void

  /**
   * 注册回调：收到其他 Tab 的 Token 更新时调用。
   * 返回取消订阅函数。
   */
  onUpdate(cb: (token: TokenSet | null, source: string) => void): () => void

  /**
   * 关闭 BroadcastChannel，释放资源。
   */
  close(): void
}
```

**实现要点**：
- `BroadcastChannel` 不可用时（Node.js、旧浏览器）→ 静默降级为 no-op
- 消息格式：`{ type: 'token_sync', token: TokenSet | null, source: string, timestamp: number }`
- 收到消息后对比 `expiresAt`，跳过已过期的通知

### 2.5 `OidcClient.ts` — 核心客户端

```typescript
import type { OidcConfig, TokenSet, OidcMetadata } from './types'
import { TokenStore } from './token-store'
import { SessionSync } from './session-sync'

export class OidcClient {
  constructor(config: OidcConfig)

  // === 生命周期 ===

  /** 启动 Authorization Code Flow：重定向到 /authorize */
  login(): Promise<void>

  /** 处理回调：用 ?code=xxx 换 Token，存入 TokenStore */
  handleCallback(urlParams: URLSearchParams): Promise<void>

  /** 静默刷新：用 refresh_token 换新 Token（用于定时器或 401 响应） */
  silentRefresh(): Promise<TokenSet | null>

  /** 登出：清理 Token，可选重定向到 OP 的 end_session_endpoint */
  logout(): Promise<void>

  // === 查询 ===

  /** 返回当前有效 AccessToken，过期或无 Token 返回 null */
  getAccessToken(): string | null

  /** 当前是否已认证（Token 存在且未过期） */
  isAuthenticated(): boolean

  // === 事件 ===

  /** Token 变更时触发（登录/刷新/登出/过期） */
  onTokenChanged(cb: (event: { token: TokenSet | null; source: string }) => void): () => void

  // === 内部 ===

  /** 获取 OIDC 发现文档，带内存缓存 */
  private getMetadata(): Promise<OidcMetadata>
}
```

**各方法流程**：

#### `login()`
```
1. generatePkcePair()
2. sessionStorage.setItem('oidc:pkce:verifier', codeVerifier)
3. sessionStorage.setItem('oidc:state', randomState)
4. 拼接 URL:
   GET {authorization_endpoint}?
     response_type=code
     &client_id={clientId}
     &redirect_uri={redirectUri}
     &scope={scopes}
     &code_challenge={codeChallenge}
     &code_challenge_method=S256
     &state={state}
5. window.location.href = url   ← 浏览器重定向
```

#### `handleCallback(urlParams)`
```
1. 校验 state 是否与 sessionStorage.getItem('oidc:state') 一致
   → 不一致抛出 Error("Invalid state")
2. 取出 code = urlParams.get('code')
   取出 codeVerifier = sessionStorage.getItem('oidc:pkce:verifier')
3. POST {token_endpoint}
   Content-Type: application/x-www-form-urlencoded
   grant_type=authorization_code
   &code={code}
   &redirect_uri={redirectUri}
   &client_id={clientId}
   &code_verifier={codeVerifier}
4. 解析响应 → TokenSet
5. tokenStore.setToken(tokenSet)
6. sessionSync.broadcast(tokenSet, 'login')
7. 清理 sessionStorage 中的 pkce:verifier 和 state
8. 如配置了 silentRefreshUri → 启动定时器在 expiresAt 前 60s 自动刷新
```

#### `silentRefresh()`
```
1. token = tokenStore.getToken()
   → 无 refreshToken 返回 null
2. POST {token_endpoint}
   grant_type=refresh_token
   &refresh_token={token.refreshToken}
   &client_id={clientId}
3. 成功 → tokenStore.setToken(newTokenSet)
         → sessionSync.broadcast(newTokenSet, 'silent-refresh')
         → 返回 newTokenSet
4. 失败（400 invalid_grant）→ tokenStore.clear()
                           → sessionSync.broadcast(null, 'expired')
                           → 返回 null
```

#### `logout()`
```
1. token = tokenStore.getToken()
2. 如果有 revocation_endpoint 和 refreshToken:
   POST {revocation_endpoint}
   token={token.refreshToken}
   token_type_hint=refresh_token
   client_id={clientId}
3. tokenStore.clear()
4. sessionSync.broadcast(null, 'logout')
5. 重定向到 {end_session_endpoint}?post_logout_redirect_uri=...
   或直接重定向到 postLogoutRedirectUri
```

#### `getMetadata()`
```
1. 检查内存缓存（static Map<string, OidcMetadata>），命中直接返回
2. GET {authority}/.well-known/openid-configuration
3. 缓存结果，返回
```

### 2.6 `oidc-auth-hook.ts` — nimble-api Hook 工厂

```typescript
import { createBearerAuth, stop, type BeforeRequestHook, type BeforeRetryHook } from '@nimble-api/api-service'
import type { OidcClient } from './OidcClient'

/**
 * 创建 OIDC Bearer Token 注入 Hook。
 * 每次请求前调用 client.getAccessToken() 获取最新 Token。
 * 委托给 api-service 的 createBearerAuth。
 */
export function createOidcAuthHook(client: OidcClient): BeforeRequestHook {
  return createBearerAuth(() => client.getAccessToken() ?? '')
}

/**
 * 创建 OIDC 401 自动刷新 Hook。
 * 拦截 401 响应 → 调用 silentRefresh → 成功后允许重试 → 失败则停止。
 */
export function createOidcRetryHook(client: OidcClient): BeforeRetryHook {
  return async (state) => {
    if (state.response?.status === 401 && !state.meta.__oidc_retried) {
      state.meta.__oidc_retried = true
      const refreshed = await client.silentRefresh()
      if (!refreshed) return stop
    }
    return state
  }
}
```

**与 api-service 的对接方式**：

```typescript
import { createApiClient } from '@nimble-api/api-service'
import { OidcClient, createOidcAuthHook, createOidcRetryHook } from '@nimble-api/oidc'

const oidc = new OidcClient({
  authority: 'https://localhost:44311',
  clientId: 'aureus-spa',
  redirectUri: `${location.origin}/callback`,
  postLogoutRedirectUri: location.origin,
})

const api = createApiClient({
  baseUrl: '/api',
  hooks: {
    beforeRequest: [createOidcAuthHook(oidc)],
    beforeRetry:   [createOidcRetryHook(oidc)],
  },
})
```

### 2.7 `index.ts` — 公开 API 入口

```typescript
// 类
export { OidcClient } from './OidcClient'
export { TokenStore } from './token-store'
export { SessionSync } from './session-sync'

// 工厂函数
export { createOidcAuthHook, createOidcRetryHook } from './oidc-auth-hook'

// 工具函数
export { generatePkcePair, createPkcePair } from './pkce'

// 类型
export type { OidcConfig, TokenSet, PkcePair, TokenChangedEvent, OidcMetadata } from './types'
```

---

## 三、依赖关系

### 3.1 外部依赖

**零外部 npm 依赖。** 仅使用运行时 API：

| API | 用途 | 可用性 |
|-----|------|--------|
| `crypto.subtle.digest` | PKCE SHA-256 | 浏览器 + Node 19+ |
| `crypto.getRandomValues` | PKCE 随机数 | 浏览器 + Node 19+ |
| `BroadcastChannel` | 多 Tab 同步 | 浏览器，Node 不可用（降级） |
| `sessionStorage` | Token 持久化 | 浏览器，Node 不可用（降级） |
| `fetch` | Token 端点请求 | 浏览器 + Node 18+ |

### 3.2 workspace 依赖

```json
{
  "peerDependencies": {
    "@nimble-api/api-service": "workspace:^"
  }
}
```

仅对 `api-service` 有 peer dependency（因为需要 `createBearerAuth`、`stop` 和 hook 类型）。如果用户只使用 OidcClient 而不使用 nimble-api hooks，则不需要安装 api-service。

实际上更好的做法是将 `api-service` 相关的部分（`oidc-auth-hook.ts`）作为可选导出，让 OidcClient 本身独立：

```typescript
// oidc-auth-hook.ts 单独从 '@nimble-api/oidc/hooks' 导出
// 或者放在主包中，对 api-service 做 optional peer dependency
```

**简化方案**：`@nimble-api/api-service` 作为 `peerDependencies`（可选）。如果未安装，`createOidcAuthHook` 和 `createOidcRetryHook` 不可用。OidcClient 核心功能不受影响。

### 3.3 package.json

```json
{
  "name": "@nimble-api/oidc",
  "version": "1.0.0",
  "description": "OAuth 2.0 / OIDC client with PKCE for nimble-api",
  "license": "ISC",
  "author": "qayrup",
  "type": "module",
  "main": "./dist/index.js",
  "module": "./dist/index.mjs",
  "types": "./dist/index.d.ts",
  "exports": {
    ".": {
      "types": "./dist/index.d.ts",
      "import": "./dist/index.mjs",
      "require": "./dist/index.js",
      "default": "./dist/index.mjs"
    }
  },
  "files": ["dist"],
  "sideEffects": false,
  "engines": { "node": ">=18" },
  "scripts": {
    "test": "vitest run",
    "clean": "rimraf dist",
    "build": "tsup",
    "dev": "tsup --watch",
    "typecheck": "tsc --noEmit",
    "prepublishOnly": "npm run build"
  },
  "peerDependencies": {
    "@nimble-api/api-service": "workspace:^"
  },
  "peerDependenciesMeta": {
    "@nimble-api/api-service": { "optional": true }
  },
  "publishConfig": { "access": "public" }
}
```

---

## 四、测试策略

### 4.1 单元测试

| 文件 | 测试内容 |
|------|---------|
| `pkce.test.ts` | verifier 长度 128 字节、challenge 是 SHA-256 哈希、base64url 格式正确 |
| `token-store.test.ts` | 存取过期逻辑、sessionStorage 读写、clear 清理 |
| `session-sync.test.ts` | BroadcastChannel mock、消息格式、跨 Tab 同步、降级行为 |
| `oidc-auth-hook.test.ts` | Bearer 头注入、Token 为空时行为、401 重试 + 停止重试 |

### 4.2 集成测试（需要运行中的 Aureus 后端）

| 场景 | 步骤 |
|------|------|
| 完整授权码流程 | login() → 模拟回调 → handleCallback() → getAccessToken() 有效 |
| 静默刷新 | silentRefresh() → 新 Token 不同于旧 Token → 旧 Token 被吊销 |
| 登出 | logout() → Token 清除 → getAccessToken() 返回 null |

### 4.3 测试基础设施

```typescript
// vitest 全局 mock
vi.stubGlobal('crypto', { subtle: { digest: vi.fn() }, getRandomValues: vi.fn() })
vi.stubGlobal('sessionStorage', { getItem: vi.fn(), setItem: vi.fn(), removeItem: vi.fn() })
vi.stubGlobal('BroadcastChannel', vi.fn())
vi.stubGlobal('fetch', vi.fn())
```

---

## 五、实施步骤

### Step 1：脚手架（30 min）

- [ ] 创建 `oidc/` 目录
- [ ] 创建 `package.json`（参照 api-service 模板）
- [ ] 创建 `tsconfig.json`（`extends ../tsconfig.base.json`）
- [ ] 创建 `tsup.config.ts`（复制 api-service 的）
- [ ] 根 `package.json` workspaces 添加 `"oidc"`
- [ ] `npm install`

### Step 2：核心类型 + PKCE（1 h）

- [ ] `types.ts`
- [ ] `pkce.ts` + `pkce.test.ts`
- [ ] 验证编译通过

### Step 3：Token 存储 + Session 同步（1.5 h）

- [ ] `token-store.ts` + `token-store.test.ts`
- [ ] `session-sync.ts` + `session-sync.test.ts`

### Step 4：OidcClient 核心（3 h）

- [ ] `OidcClient.ts`
  - [ ] `login()` — 重定向逻辑
  - [ ] `handleCallback()` — code→token 交换
  - [ ] `silentRefresh()` — refresh_token 轮换
  - [ ] `logout()` — 吊销 + 清理
  - [ ] `getMetadata()` — 发现文档缓存
- [ ] `OidcClient.test.ts` — mock fetch 的单元测试

### Step 5：nimble-api Hook 集成（1 h）

- [ ] `oidc-auth-hook.ts` + `oidc-auth-hook.test.ts`

### Step 6：入口文件 + 构建验证（30 min）

- [ ] `index.ts`
- [ ] `npm run build -w @nimble-api/oidc`
- [ ] `npm run typecheck -w @nimble-api/oidc`
- [ ] `npm test -w @nimble-api/oidc`

### Step 7：端到端验证（需要 Aureus 后端运行）

- [ ] 完整授权码流程
- [ ] 静默刷新
- [ ] 多 Tab 同步

---

## 六、与 oidc-client-ts 对比

| | oidc-client-ts | @nimble-api/oidc |
|---|---|---|
| 包大小 | ~45 KB gzip | 预计 ~5 KB gzip |
| 依赖 | oidc-client-ts 自身 | 仅可选 peer dep on api-service |
| 框架绑定 | 无（通用） | 无（通用） |
| HTTP 客户端 | 内置 fetch | 复用 nimble-api api-service |
| Token 注入 | 需手动写拦截器 | `createOidcAuthHook` 一行接入 |
| PKCE | 内置 | 内置（Web Crypto API） |
| 多 Tab 同步 | 内置 events | BroadcastChannel |
| 静默刷新 | iframe | iframe 或直接 fetch（两种方式） |
| Silent Renew | iframe-based | iframe optional；支持 timer-based |

---

## 七、关键设计决策

1. **RefreshToken 只存内存** — 不写 `sessionStorage`，XSS 无法窃取。AccessToken 可以写 `sessionStorage`（15 分钟过期，泄露影响小）。

2. **无外部依赖** — 不用 `oidc-client-ts`、`jwt-decode` 或任何 OIDC 库。PKCE 用 Web Crypto API，OIDC 协议逻辑自实现（约 300 行）。

3. **api-service 可选** — `oidc-auth-hook.ts` 是便利层。OidcClient 本身可以独立使用（手动管理 HTTP 请求），无需 nimble-api 的 ApiClient。

4. **平台无关** — 核心逻辑不依赖 DOM。`login()` 和 `logout()` 的重定向是唯一 DOM 操作。`sessionStorage` 和 `BroadcastChannel` 都有降级处理。

5. **npm workspace 同级目录** — 与其他 5 个包一样放在 nimble-api 根目录，不放在 `packages/` 子目录。
