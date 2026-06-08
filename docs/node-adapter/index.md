# Node.js HTTP 适配器

`@nimble-api/node-adapter` 是 `@nimble-api/api-service` 在 Node.js 端的原生 `http`/`https` 适配器，提供连接池复用、代理转发、重定向控制、流式响应、TLS 配置等生产级能力。

## 安装

```bash
npm install @nimble-api/node-adapter @nimble-api/api-service
```

## 快速开始

```ts
import { createApiClient } from '@nimble-api/api-service'
import { createNodeAdapter } from '@nimble-api/node-adapter'

const client = createApiClient({
  baseUrl: 'https://api.example.com',
  adapter: createNodeAdapter({
    keepAlive: true,
    maxRedirects: 5,
  }),
})

const data = await client.get('/users')
```

## 配置项 `NodeAdapterOptions`

### 连接池

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `keepAlive` | `boolean` | `true` | 复用 TCP 连接，避免每次请求重新握手 |
| `maxSockets` | `number` | `Infinity` | 每 host 最大 socket 数 |
| `maxFreeSockets` | `number` | `256` | 每 host 最大空闲 socket 数 |
| `keepAliveMsecs` | `number` | `1000` | keep-alive 超时 ms |

```ts
createNodeAdapter({
  keepAlive: true,
  maxSockets: 50,
  maxFreeSockets: 10,
})
```

### 超时控制

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `connectTimeout` | `number` | — | TCP 连接建立超时（ms），区别于请求读写超时 |
| `readTimeout` | `number` | — | Socket 读取超时（ms），长时间无数据则断开 |

```ts
createNodeAdapter({
  connectTimeout: 5000,  // 连接 5s 超时
  readTimeout: 30000,    // 30s 无数据则断
})
```

`ApiOptions.timeout` / `RequestOptions.timeout` 作为请求总超时（含重定向和重试），与 `connectTimeout`/`readTimeout` 独立。

### 代理

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `proxy` | `'env'` \| `ProxyConfig` \| `false` | `'env'` | 代理配置 |

默认 `'env'` 模式自动读取 `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` 环境变量。

```ts
// 显式配置
createNodeAdapter({
  proxy: {
    host: 'proxy.corp.com',
    port: 8080,
    auth: { username: 'user', password: 'pass' },
  },
})

// 禁用代理
createNodeAdapter({ proxy: false })
```

HTTPS 请求通过 CONNECT tunnel 转发代理。

### 重定向

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `maxRedirects` | `number` | `5` | 最大跟随重定向次数，`0` 禁用 |

```ts
createNodeAdapter({ maxRedirects: 0 })  // 不跟随任何重定向
```

重定向规则：
- 301/302：POST → GET（浏览器行为），HEAD 保持
- 303：始终 GET
- 307/308：保持原 method 和 body

### 解压

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `decompress` | `boolean` | `true` | 自动解压 gzip/deflate/brotli |

设为 `false` 时不会自动解压，且请求头 `Accept-Encoding` 设为 `identity`。

```ts
createNodeAdapter({ decompress: false })
```

### 自定义 Agent

| 选项 | 类型 | 说明 |
|------|------|------|
| `httpAgent` | `http.Agent` | 完全自定义 HTTP Agent（覆盖 keepAlive 设置） |
| `httpsAgent` | `https.Agent` | 完全自定义 HTTPS Agent（覆盖 keepAlive/TLS 设置） |

```ts
createNodeAdapter({
  httpAgent: new http.Agent({ keepAlive: false }),
})
```

### TLS / 客户端证书

| 选项 | 类型 | 默认值 | 说明 |
|------|------|--------|------|
| `rejectUnauthorized` | `boolean` | `true` | TLS 证书校验，自签证书场景设为 `false` |
| `ca` | `string \| Buffer \| Array` | — | CA 证书 |
| `cert` | `string \| Buffer` | — | 客户端证书 |
| `key` | `string \| Buffer` | — | 客户端私钥 |

```ts
import fs from 'node:fs'

createNodeAdapter({
  rejectUnauthorized: false,
  cert: fs.readFileSync('/path/to/client.crt'),
  key: fs.readFileSync('/path/to/client.key'),
  ca: fs.readFileSync('/path/to/ca.crt'),
})
```

### Unix Socket

| 选项 | 类型 | 说明 |
|------|------|------|
| `socketPath` | `string` | Unix socket 路径 |

```ts
createNodeAdapter({ socketPath: '/var/run/docker.sock' })
```

### DNS 解析

| 选项 | 类型 | 说明 |
|------|------|------|
| `lookup` | `(hostname, options, callback) => void` | 自定义 DNS 解析函数 |

```ts
import { promises as dns } from 'node:dns'

createNodeAdapter({
  lookup: (hostname, opts, cb) => {
    dns.resolve4(hostname).then(
      addrs => cb(null, addrs[0], 4),
      cb,
    )
  },
})
```

### Cookie Jar

| 选项 | 类型 | 说明 |
|------|------|------|
| `cookieJar` | `CookieJar` | Cookie 罐实例，自动保存和发送 cookie |

```ts
import { SimpleCookieJar } from '@nimble-api/node-adapter'

const jar = new SimpleCookieJar()
const client = createApiClient({
  adapter: createNodeAdapter({ cookieJar: jar }),
})

// Cookie 自动保存和发送
await client.post('/login', { json: { user: 'admin', pass: 'secret' } })
await client.get('/dashboard')  // 自动携带 session cookie
```

实现 `CookieJar` 接口可接入 `tough-cookie` 等成熟的 cookie 库：

```ts
interface CookieJar {
  getCookieString(url: string): string;
  setCookieFromHeaders(url: string, headers: Record<string, string>): void;
}
```

---

## 流式响应

`responseType: 'stream'` 直接返回 Node.js `Readable` 流，无需将整个响应缓冲到内存：

```ts
import { createWriteStream } from 'node:fs'

const client = createApiClient({ adapter: createNodeAdapter() })
const stream = await client.get('/large-file', { responseType: 'stream' })
stream.pipe(createWriteStream('output.bin'))
```

---

## 配合 api-service 使用

node-adapter 实现 `RequestAdapter` 接口，可无缝接入所有 api-service 能力：

```ts
const client = createApiClient({
  baseUrl: 'https://api.example.com',
  adapter: createNodeAdapter({ keepAlive: true }),
  retry: { limit: 3, backoff: 'exponential' },
  cache: { ttl: 60000, mode: 'swr' },
  hooks: {
    beforeRequest: createBearerAuth(() => getToken()),
  },
})

// 所有 api-service 功能照常工作
const api = createTypedApi(client, {
  getUser: {
    url: '/users/{id}',
    _params: {} as { id: string },
    _response: {} as { id: string; name: string },
    debounce: 300,
  },
})

await api.getUser({ params: { id: '1' } })
```

## 许可

ISC
