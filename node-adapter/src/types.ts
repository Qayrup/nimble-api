export interface NodeAdapterOptions {
  // --- 连接池 ---
  keepAlive?: boolean;
  maxSockets?: number;
  maxFreeSockets?: number;
  keepAliveMsecs?: number;

  // --- 超时 ---
  connectTimeout?: number;
  readTimeout?: number;

  // --- Proxy ---
  proxy?: ProxyMode | ProxyConfig;

  // --- 重定向 ---
  maxRedirects?: number;

  // --- 解压 ---
  decompress?: boolean;

  // --- 自定义 Agent ---
  httpAgent?: import('node:http').Agent;
  httpsAgent?: import('node:https').Agent;

  // --- TLS ---
  rejectUnauthorized?: boolean;
  ca?: string | Buffer | Array<string | Buffer>;
  cert?: string | Buffer;
  key?: string | Buffer;

  // --- Unix Socket ---
  socketPath?: string;

  // --- DNS ---
  lookup?: (
    hostname: string,
    options: unknown,
    callback: (err: Error | null, address: string, family: number) => void,
  ) => void;

  // --- Cookie ---
  cookieJar?: CookieJar;
}

export interface CookieJar {
  getCookieString(url: string): string;
  setCookieFromHeaders(url: string, headers: Record<string, string>): void;
}

export interface ProxyConfig {
  host: string;
  port: number;
  protocol?: 'http' | 'https';
  auth?: { username: string; password: string };
}

export type ProxyMode = 'env' | 'manual';
