import http from 'node:http';
import https from 'node:https';
import { resolveProxy } from './proxy';
import { isRedirect, buildRedirectUrl, methodAfterRedirect, shouldKeepBody } from './redirect';
import { calcBodySize } from './utils/body-size';
import type { NodeAdapterOptions, CookieJar } from './types';
import { ApiError, type AdapterRequestConfig, type AdapterResponse } from '@nimble-api/api-service';

interface ResolvedOptions {
  keepAlive: boolean;
  maxSockets: number;
  maxFreeSockets: number;
  keepAliveMsecs: number;
  connectTimeout: number;
  readTimeout: number;
  proxy: NodeAdapterOptions['proxy'];
  maxRedirects: number;
  decompress: boolean;
  httpAgent: http.Agent | undefined;
  httpsAgent: https.Agent | undefined;
  rejectUnauthorized: boolean;
  ca: string | Buffer | Array<string | Buffer> | undefined;
  cert: string | Buffer | undefined;
  key: string | Buffer | undefined;
  socketPath: string | undefined;
  lookup: NodeAdapterOptions['lookup'];
  cookieJar: CookieJar | undefined;
  maxContentLength: number;
}

const DEFAULT_OPTIONS: ResolvedOptions = {
  keepAlive: true,
  maxSockets: Infinity,
  maxFreeSockets: 256,
  keepAliveMsecs: 1000,
  connectTimeout: 0,
  readTimeout: 0,
  proxy: 'env',
  maxRedirects: 5,
  decompress: true,
  httpAgent: undefined,
  httpsAgent: undefined,
  rejectUnauthorized: true,
  ca: undefined,
  cert: undefined,
  key: undefined,
  socketPath: undefined,
  lookup: undefined,
  cookieJar: undefined,
  maxContentLength: Infinity,
};

export function createNodeAdapter(options: NodeAdapterOptions = {}) {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  const httpAgent = opts.httpAgent ?? (opts.keepAlive
    ? new http.Agent({
      keepAlive: true,
      maxSockets: opts.maxSockets,
      maxFreeSockets: opts.maxFreeSockets,
      keepAliveMsecs: opts.keepAliveMsecs,
      timeout: opts.readTimeout || undefined,
    })
    : undefined);

  const httpsAgent = opts.httpsAgent ?? (opts.keepAlive
    ? new https.Agent({
      keepAlive: true,
      maxSockets: opts.maxSockets,
      maxFreeSockets: opts.maxFreeSockets,
      keepAliveMsecs: opts.keepAliveMsecs,
      timeout: opts.readTimeout || undefined,
      rejectUnauthorized: opts.rejectUnauthorized,
      ca: opts.ca as https.AgentOptions['ca'],
      cert: opts.cert as https.AgentOptions['cert'],
      key: opts.key as https.AgentOptions['key'],
    })
    : undefined);

  async function performRequest(
    config: AdapterRequestConfig,
    redirectCount: number,
  ): Promise<AdapterResponse> {
    const targetUrl = config.url;
    const isHttps = targetUrl.startsWith('https:');

    const proxy = resolveProxy(targetUrl, opts.proxy ?? false);
    const requestUrl = proxy
      ? (isHttps ? targetUrl : `${targetUrl}`) // For HTTPS through proxy, use CONNECT
      : targetUrl;

    const parsedUrl = new URL(requestUrl);

    // Build request options
    const isConnectProxy = proxy && isHttps;
    const actualHost = proxy && !isConnectProxy ? proxy.host : parsedUrl.hostname;
    const actualPort = proxy && !isConnectProxy
      ? proxy.port
      : (parseInt(parsedUrl.port, 10) || (isHttps ? 443 : 80));

    const baseReqOptions: Record<string, unknown> = {
      hostname: actualHost,
      port: actualPort,
      path: proxy && !isConnectProxy ? targetUrl : `${parsedUrl.pathname}${parsedUrl.search}`,
      method: config.method,
      headers: { ...config.headers },
      agent: isHttps ? httpsAgent : httpAgent,
      timeout: opts.readTimeout || undefined,
    };
    if (isHttps) {
      baseReqOptions.rejectUnauthorized = opts.rejectUnauthorized;
      baseReqOptions.ca = opts.ca;
      baseReqOptions.cert = opts.cert;
      baseReqOptions.key = opts.key;
    }
    const reqOptions = baseReqOptions as http.RequestOptions;

    if (opts.socketPath) reqOptions.socketPath = opts.socketPath;
    if (config.socketPath) reqOptions.socketPath = config.socketPath;
    if (opts.lookup) reqOptions.lookup = opts.lookup;

    // Disable decompress so we can handle it ourselves if needed
    // When decompress is true (default), Node's http module auto-decompresses
    // and strips content-encoding — which is what we want in most cases.

    // Cookie jar — inject cookies
    if (opts.cookieJar) {
      const cookieStr = opts.cookieJar.getCookieString(config.url);
      if (cookieStr) {
        reqOptions.headers = { ...reqOptions.headers, Cookie: cookieStr };
      }
    }

    // Proxy auth
    if (proxy?.auth) {
      const proxyAuth = Buffer.from(`${proxy.auth.username}:${proxy.auth.password}`).toString('base64');
      reqOptions.headers = {
        ...reqOptions.headers,
        'Proxy-Authorization': `Basic ${proxyAuth}`,
      };
    }

    // Access-Control headers for proxy
    if (proxy) {
      reqOptions.headers = { ...reqOptions.headers, Host: parsedUrl.host };
    }

    // Decompress: if false, we need to ask the server NOT to compress
    if (!opts.decompress) {
      reqOptions.headers = { ...reqOptions.headers, 'Accept-Encoding': 'identity' };
    }

    const isStreamResponse = config.responseType === 'stream';

    return new Promise<AdapterResponse>((resolve, reject) => {
      const transport = isHttps ? https : http;
      let req: http.ClientRequest | undefined;
      let connectTimer: ReturnType<typeof setTimeout> | undefined;
      let requestTimer: ReturnType<typeof setTimeout> | undefined;
      let onAbort: (() => void) | undefined;

      function cleanup() {
        if (connectTimer) clearTimeout(connectTimer);
        if (requestTimer) clearTimeout(requestTimer);
        if (onAbort && config.signal) {
          config.signal.removeEventListener('abort', onAbort);
        }
      }

      function handleError(err: Error & { code?: string }) {
        cleanup();
        reject(err);
      }

      // AbortSignal
      if (config.signal) {
        if (config.signal.aborted) {
          reject(new DOMException('The operation was aborted', 'AbortError'));
          return;
        }
        onAbort = () => req?.destroy(new DOMException('The operation was aborted', 'AbortError'));
        config.signal.addEventListener('abort', onAbort, { once: true });
      }

      // Connection timeout
      const effectiveConnectTimeout = config.connectTimeout ?? opts.connectTimeout;
      if (effectiveConnectTimeout && effectiveConnectTimeout > 0) {
        connectTimer = setTimeout(() => {
          req?.destroy(new Error(`Connection timed out after ${effectiveConnectTimeout}ms`));
        }, effectiveConnectTimeout);
      }

      // Request-level timeout (total deadline)
      if (config.timeout && config.timeout > 0) {
        requestTimer = setTimeout(() => {
          req?.destroy(new Error(`Request timed out after ${config.timeout}ms`));
        }, config.timeout);
      }

      // For HTTPS through proxy, use CONNECT tunnel
      if (isConnectProxy && proxy) {
        const connectReq = http.request({
          host: proxy.host,
          port: proxy.port,
          method: 'CONNECT',
          path: `${parsedUrl.hostname}:${parsedUrl.port || 443}`,
          headers: proxy.auth ? {
            'Proxy-Authorization': `Basic ${Buffer.from(`${proxy.auth.username}:${proxy.auth.password}`).toString('base64')}`,
          } : undefined,
        });
        req = connectReq;

        connectReq.on('connect', (res, socket) => {
          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            socket.destroy();
            handleError(new Error(`Proxy CONNECT to ${parsedUrl.hostname} failed with status ${status}`));
            return;
          }

          // Clear connect timer as we're now connected
          if (connectTimer) clearTimeout(connectTimer);

          const tlsOptions = {
            socket,
            hostname: parsedUrl.hostname,
            port: parseInt(parsedUrl.port, 10) || 443,
            path: `${parsedUrl.pathname}${parsedUrl.search}`,
            method: config.method,
            headers: reqOptions.headers as Record<string, string | string[] | number | undefined>,
            agent: false as const,
            rejectUnauthorized: opts.rejectUnauthorized,
            ca: opts.ca,
            cert: opts.cert,
            key: opts.key,
          } as https.RequestOptions;

          if (opts.lookup) tlsOptions.lookup = opts.lookup;

          const tlsReq = https.request(tlsOptions, (res) =>
            handleResponse(res as http.IncomingMessage, config, redirectCount, resolve, reject, cleanup, isStreamResponse),
          );
          req = tlsReq;
          tlsReq.on('error', handleError);

          if (config.timeout && config.timeout > 0) {
            tlsReq.setTimeout(config.timeout);
          }

          writeBody(tlsReq, config);
          tlsReq.end();
        });

        connectReq.on('response', (res) => {
          res.resume();
          handleError(new Error(`Proxy CONNECT to ${parsedUrl.hostname} failed with status ${res.statusCode ?? 0}`));
        });

        connectReq.on('error', handleError);
        connectReq.end();
        return;
      }

      // Normal request (no CONNECT tunnel)
      req = transport.request(reqOptions, (res) =>
        handleResponse(res, config, redirectCount, resolve, reject, cleanup, isStreamResponse),
      );

      req.on('error', handleError);

      if (connectTimer) {
        req.on('socket', (socket) => {
          if (!socket.connecting) {
            if (connectTimer) clearTimeout(connectTimer);
          } else {
            socket.once('connect', () => {
              if (connectTimer) clearTimeout(connectTimer);
            });
          }
        });
      }

      if (config.timeout && config.timeout > 0 && !opts.readTimeout) {
        req.setTimeout(config.timeout);
      }

      writeBody(req, config);
      req.end();
    });
  }

  function handleResponse(
    res: http.IncomingMessage,
    config: AdapterRequestConfig,
    redirectCount: number,
    resolve: (value: AdapterResponse) => void,
    reject: (reason: Error) => void,
    cleanup: () => void,
    isStreamResponse: boolean,
  ): void {
    const status = res.statusCode ?? 0;

    // Redirect handling
    if (isRedirect(status) && opts.maxRedirects > 0) {
      if (redirectCount >= opts.maxRedirects) {
        cleanup();
        reject(new Error(`Exceeded max redirects (${opts.maxRedirects})`));
        return;
      }

      const location = res.headers.location;
      if (!location) {
        cleanup();
        reject(new Error(`Redirect ${status} without Location header`));
        return;
      }

      // Consume and discard the response body
      res.resume();

      const newUrl = buildRedirectUrl(location, config.url);
      if (!newUrl) {
        cleanup();
        reject(new Error(`Invalid redirect location: ${location}`));
        return;
      }

      const newMethod = methodAfterRedirect(config.method, status);
      const keepBody = shouldKeepBody(config.method, status);

      const nextConfig: AdapterRequestConfig = {
        ...config,
        url: newUrl,
        method: newMethod,
        body: keepBody ? config.body : undefined,
      };

      // 跨源重定向（含协议降级 https→http）剥离敏感头，防止凭据泄露到第三方源
      try {
        const orig = new URL(config.url);
        const target = new URL(newUrl);
        if (orig.origin !== target.origin || orig.protocol !== target.protocol) {
          nextConfig.headers = Object.fromEntries(
            Object.entries(nextConfig.headers).filter(([key]) => {
              const lower = key.toLowerCase();
              return lower !== 'authorization' && lower !== 'cookie' && lower !== 'proxy-authorization';
            }),
          );
        }
      } catch { /* URL 解析失败则跳过跨源判断 */ }

      // Don't send body for GET redirects
      if (newMethod === 'GET') {
        nextConfig.headers = Object.fromEntries(
          Object.entries(nextConfig.headers).filter(([key]) => {
            const lower = key.toLowerCase();
            return lower !== 'content-type' && lower !== 'content-length' && lower !== 'content-encoding';
          }),
        );
        nextConfig.body = undefined;
      }

      cleanup();
      performRequest(nextConfig, redirectCount + 1).then(resolve, reject);
      return;
    }

    // Cookie jar — store cookies
    if (opts.cookieJar) {
      const rawHeaders: Record<string, string | string[]> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (value != null) {
          const lowerKey = key.toLowerCase();
          rawHeaders[lowerKey] = value;
        }
      }
      // Pass set-cookie as-is (array or string)
      opts.cookieJar.setCookieFromHeaders(config.url, rawHeaders as unknown as Record<string, string>);
    }

    // Stream response — resolve immediately with stream
    if (isStreamResponse) {
      cleanup();
      const resHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (value != null) {
          resHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        }
      }
      resolve({
        status,
        data: res,
        headers: resHeaders,
      });
      return;
    }

    // Buffer-based response types
    const chunks: Buffer[] = [];
    let totalBytes = 0;

    const contentLength = res.headers['content-length'];
    const total = contentLength ? parseInt(contentLength, 10) : 0;

    res.on('data', (chunk: Buffer) => {
      totalBytes += chunk.byteLength;

      if (totalBytes > opts.maxContentLength) {
        res.destroy(new Error(`Response body too large: exceeded maxContentLength (${opts.maxContentLength} bytes)`));
        return;
      }

      chunks.push(chunk);

      if (config.onDownloadProgress) {
        config.onDownloadProgress({ loaded: totalBytes, total });
      }
    });

    res.on('end', () => {
      cleanup();
      const raw = Buffer.concat(chunks);
      const resHeaders: Record<string, string> = {};
      for (const [key, value] of Object.entries(res.headers)) {
        if (value != null) {
          resHeaders[key.toLowerCase()] = Array.isArray(value) ? value.join(', ') : String(value);
        }
      }

      const responseType = config.responseType ?? 'json';
      let data: unknown;

      try {
        if (responseType === 'text') {
          data = raw.toString('utf8');
        } else if (responseType === 'blob') {
          // In Node, Blob doesn't natively exist, but we can provide a buffer-backed object
          // For compatibility, we return a Uint8Array that has .size, .type, .arrayBuffer(), .text()
          data = raw;
        } else if (responseType === 'arrayBuffer') {
          data = raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength);
        } else {
          // json (default)
          try {
            data = raw.length > 0 ? JSON.parse(raw.toString('utf8')) : null;
          } catch {
            // For non-success statuses, return raw text rather than failing
            if (status >= 200 && status < 300) {
              reject(new ApiError(`Invalid JSON response from ${config.url}`, {
                code: 'ERR_BAD_RESPONSE',
                status,
                data: null,
                request: { url: config.url, method: config.method },
                response: { status, headers: resHeaders },
              }));
              return;
            }
            data = raw.toString('utf8');
          }
        }
      } catch (caught) {
        reject(caught instanceof Error ? caught : new Error(String(caught)));
        return;
      }

      resolve({ status, data, headers: resHeaders });
    });

    res.on('error', (err) => {
      cleanup();
      reject(err);
    });
  }

  function writeBody(req: http.ClientRequest, config: AdapterRequestConfig): void {
    const body = config.body;
    if (body == null) return;

    if (typeof body === 'string') {
      req.write(body);
    } else if (Buffer.isBuffer(body)) {
      req.write(body);
    } else if (body instanceof Uint8Array) {
      req.write(body);
    } else if (body instanceof ArrayBuffer) {
      req.write(Buffer.from(body));
    } else {
      // JSON serialized body (plain object, array, etc.)
      req.write(JSON.stringify(body));
    }
  }

  return {
    async request(config: AdapterRequestConfig): Promise<AdapterResponse> {
      // maxBodyLength check (node-level, can override api-service's check)
      const bodySizeOpt = config.maxBodyLength;
      if (bodySizeOpt != null && bodySizeOpt > 0 && config.body != null) {
        const size = calcBodySize(config.body);
        if (size > bodySizeOpt) {
          throw new Error(`Request body too large: ${size} > ${bodySizeOpt}`);
        }
      }

      return performRequest(config, 0);
    },

    dispose(): void {
      httpAgent?.destroy();
      httpsAgent?.destroy();
    },
  };
}
