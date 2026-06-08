# @nimble-api/node-adapter

Node.js `http`/`https` adapter for `@nimble-api/api-service`. Provides keep-alive connection pooling, proxy support, redirect handling, stream responses, decompression, TLS configuration, and cookie jar integration.

```bash
npm install @nimble-api/node-adapter
```

## Quick Start

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

## Adapter Options

| Option | Default | Description |
|---|---|---|
| `keepAlive` | `true` | Reuse TCP connections |
| `maxSockets` | `Infinity` | Max sockets per host |
| `maxFreeSockets` | `256` | Max idle sockets per host |
| `keepAliveMsecs` | `1000` | Keep-alive timeout ms |
| `connectTimeout` | — | TCP connection establishment timeout (ms) |
| `readTimeout` | — | Socket read timeout (ms), separate from request timeout |
| `proxy` | `'env'` | `'env'` \| `{ host, port, protocol?, auth? }` \| `false` |
| `maxRedirects` | `5` | Max redirects to follow. `0` disables |
| `decompress` | `true` | Auto-decompress gzip/deflate/brotli |
| `httpAgent` | — | Custom `http.Agent` (overrides keepAlive settings) |
| `httpsAgent` | — | Custom `https.Agent` (overrides keepAlive settings) |
| `rejectUnauthorized` | `true` | TLS certificate validation |
| `ca` | — | CA certificate(s) for self-signed certs |
| `cert` | — | Client certificate |
| `key` | — | Client private key |
| `socketPath` | — | Unix socket path |
| `lookup` | — | Custom DNS lookup function |
| `cookieJar` | — | Cookie jar instance for automatic cookie handling |

## Proxy

By default, `HTTP_PROXY` / `HTTPS_PROXY` / `NO_PROXY` environment variables are respected.

```ts
// Explicit proxy config (overrides env vars)
createNodeAdapter({
  proxy: { host: 'proxy.corp.com', port: 8080, auth: { username: 'user', password: 'pass' } },
})

// Disable proxy
createNodeAdapter({ proxy: false })
```

## Response Stream

```ts
const client = createApiClient({
  adapter: createNodeAdapter(),
})

const stream = await client.get('/large-file', { responseType: 'stream' })
stream.pipe(fs.createWriteStream('output.bin'))
```

## Cookie Jar

```ts
import { SimpleCookieJar } from '@nimble-api/node-adapter'

const jar = new SimpleCookieJar()
const client = createApiClient({
  adapter: createNodeAdapter({ cookieJar: jar }),
})

// Cookies are automatically stored and sent
await client.post('/login', { json: { user: 'admin', pass: 'secret' } })
await client.get('/dashboard') // automatically sends session cookie
```

For advanced use cases, implement the `CookieJar` interface or wrap `tough-cookie`.

## Connection Timeout vs Read Timeout

```ts
createNodeAdapter({
  connectTimeout: 5000,  // TCP handshake timeout — 5s
  readTimeout: 10000,    // Socket idle timeout — 10s (for slow responses)
})
```

The adapter also respects `ApiOptions.timeout` / `RequestOptions.timeout` as the overall request deadline (including redirects and retries).

## TLS / Client Certificates

```ts
createNodeAdapter({
  rejectUnauthorized: false,  // for self-signed certs
  cert: fs.readFileSync('/path/to/client.crt'),
  key: fs.readFileSync('/path/to/client.key'),
  ca: fs.readFileSync('/path/to/ca.crt'),
})
```

## DNS Lookup

```ts
import { promises as dns } from 'node:dns'

createNodeAdapter({
  lookup: (hostname, opts, cb) => {
    // IPv4 first, then IPv6
    dns.resolve4(hostname).then(addrs => cb(null, addrs[0], 4), cb)
  },
})
```

## License

ISC
