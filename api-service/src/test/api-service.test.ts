import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient, initApiClient, destroyApiClient } from '../index';
import { ApiClient } from '../core/ApiClient';
import { MemoryCache } from '../core/cache';
import { buildUrl } from '../utils/url-builder';
import { generateCacheKey, hashString, stableNormalize } from '../utils/cache-key';
import { PluginManager } from '../plugins/manager';
import { createInterceptorPlugin } from '../plugins/interceptor';
import type { ApiConfig, RequestAdapter, AdapterResponse } from '../core/types';

// ============================================================
// Test helpers
// ============================================================

function createMockAdapter(responses: Map<string, AdapterResponse> = new Map()): RequestAdapter {
  return {
    async request(config) {
      const key = `${config.method}:${config.url}`;
      const tmpl = responses.get(key);
      // Return a fresh copy to avoid reference equality in cache tests
      return { status: tmpl?.status ?? 200, data: JSON.parse(JSON.stringify(tmpl?.data ?? { code: 200, data: 'ok' })), headers: tmpl?.headers ?? {} };
    },
  };
}

function makeTestConfig(): ApiConfig {
  return {
    getUser: {
      url: '/api/user/{userId}',
      method: 'GET',
      cacheTTL: 60000,
      onSuccess: ['user:loaded'],
      onError: { default: 'user:error' },
    },
    createUser: {
      url: '/api/user',
      method: 'POST',
      onSuccess: ['user:created'],
      onError: { default: 'user:createError' },
    },
    getOrder: {
      url: '/api/order/{orderId}',
      method: 'GET',
      onSuccess: ['order:loaded'],
      onError: { default: 'order:error' },
    },
  };
}

// ============================================================
// URL Builder
// ============================================================

describe('buildUrl', () => {
  it('replaces template params', () => {
    expect(buildUrl('/api/user/{id}', { id: '123' })).toBe('/api/user/123');
  });

  it('URI-encodes values', () => {
    expect(buildUrl('/api/search/{q}', { q: 'hello world' })).toBe('/api/search/hello%20world');
  });

  it('throws on missing param', () => {
    expect(() => buildUrl('/api/user/{id}', {})).toThrow('Missing required parameter');
  });

  it('replaces multiple params', () => {
    expect(buildUrl('/api/user/{userId}/post/{postId}', { userId: '1', postId: '2' }))
      .toBe('/api/user/1/post/2');
  });
});

// ============================================================
// Cache Key Generator
// ============================================================

describe('generateCacheKey', () => {
  it('produces consistent keys for same input', () => {
    const k1 = generateCacheKey('getUser', { id: 1 }, {});
    const k2 = generateCacheKey('getUser', { id: 1 }, {});
    expect(k1).toBe(k2);
  });

  it('produces different keys for different params', () => {
    const k1 = generateCacheKey('getUser', { id: 1 }, {});
    const k2 = generateCacheKey('getUser', { id: 2 }, {});
    expect(k1).not.toBe(k2);
  });

  it('handles empty params/data', () => {
    const key = generateCacheKey('api', {}, {});
    expect(key).toMatch(/^api:0:0$/);
  });
});

describe('hashString', () => {
  it('produces consistent hashes', () => {
    expect(hashString('hello')).toBe(hashString('hello'));
  });

  it('empty string returns zeros', () => {
    expect(hashString('')).toBe('00000000');
  });
});

describe('stableNormalize', () => {
  it('sorts object keys', () => {
    const result = stableNormalize({ b: 2, a: 1, c: 3 });
    expect(JSON.stringify(result)).toBe('{"a":1,"b":2,"c":3}');
  });
});

// ============================================================
// Memory Cache
// ============================================================

describe('MemoryCache', () => {
  let cache: MemoryCache;

  beforeEach(() => {
    cache = new MemoryCache();
  });

  it('stores and retrieves values', () => {
    cache.set('key', 'value', 60000);
    expect(cache.get('key')).toBe('value');
    expect(cache.has('key')).toBe(true);
  });

  it('expires after TTL', async () => {
    cache.set('key', 'value', 10);
    await new Promise(r => setTimeout(r, 15));
    expect(cache.get('key')).toBeUndefined();
  });

  it('getStale returns data with stale flag after TTL', async () => {
    cache.set('key', 'value', 10);
    await new Promise(r => setTimeout(r, 15));
    const result = cache.getStale('key');
    expect(result).toBeDefined();
    expect(result!.stale).toBe(true);
    expect(result!.data).toBe('value');
  });

  it('delete removes entry', () => {
    cache.set('key', 'value', 60000);
    cache.delete('key');
    expect(cache.get('key')).toBeUndefined();
  });

  it('clear removes all entries', () => {
    cache.set('a', 1, 60000);
    cache.set('b', 2, 60000);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});

// ============================================================
// Plugin Manager
// ============================================================

describe('PluginManager', () => {
  it('registers and runs plugins', async () => {
    const mgr = new PluginManager();
    const spy = vi.fn();
    mgr.register({ name: 'test', onRequest: spy });
    await mgr.runOnRequest({} as never);
    expect(spy).toHaveBeenCalled();
  });

  it('prevents duplicate plugin names', () => {
    const mgr = new PluginManager();
    mgr.register({ name: 'test' });
    expect(() => mgr.register({ name: 'test' })).toThrow('already registered');
  });

  it('runs response hooks in reverse order', async () => {
    const mgr = new PluginManager();
    const order: number[] = [];

    mgr.register({
      name: 'a',
      onResponse(ctx) { order.push(1); return ctx; },
    });
    mgr.register({
      name: 'b',
      onResponse(ctx) { order.push(2); return ctx; },
    });

    await mgr.runOnResponse({} as never);
    expect(order).toEqual([2, 1]);
  });
});

// ============================================================
// Interceptor Plugin
// ============================================================

describe('InterceptorPlugin', () => {
  it('modifies request headers', async () => {
    const plugin = createInterceptorPlugin();
    plugin.addRequest(ctx => ({
      ...ctx,
      headers: { ...ctx.headers, Authorization: 'Bearer token' },
    }));

    const ctx = { headers: {} };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (plugin.onRequest as any)(ctx);
    expect(result.headers.Authorization).toBe('Bearer token');
  });

  it('modifies response data', async () => {
    const plugin = createInterceptorPlugin();
    plugin.addResponse(ctx => ({ ...ctx, data: { wrapped: ctx.data } }));

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (plugin.onResponse as any)({ data: 'raw' });
    expect(result.data).toEqual({ wrapped: 'raw' });
  });
});

// ============================================================
// ApiClient Core
// ============================================================

describe('ApiClient', () => {
  let client: ApiClient;
  let mockAdapter: RequestAdapter;
  let responses: Map<string, AdapterResponse>;

  beforeEach(() => {
    responses = new Map();
    responses.set('GET:/api/user/123', {
      status: 200,
      data: { code: 200, data: { userId: '123', name: 'Alice' } },
      headers: {},
    });
    responses.set('POST:/api/user', {
      status: 200,
      data: { code: 200, data: { userId: '456', name: 'Bob' } },
      headers: {},
    });
    responses.set('GET:/api/order/xyz', {
      status: 200,
      data: { code: 200, data: { orderId: 'xyz', amount: 100 } },
      headers: {},
    });

    mockAdapter = createMockAdapter(responses);
    client = new ApiClient(makeTestConfig(), { adapter: mockAdapter });
  });

  it('compiles API methods lazily', () => {
    const method = client.getApiMethod('getUser');
    expect(method).toBeInstanceOf(Function);
    expect(method.apiKey).toBe('getUser');
  });

  it('makes requests through the adapter', async () => {
    const method = client.getApiMethod('getUser');
    const result = await method({ userId: '123' }, {});
    expect(result).toHaveProperty('data');
    expect((result as { data: { name: string } }).data.name).toBe('Alice');
  });

  it('caches responses within TTL', async () => {
    const method = client.getApiMethod('getUser');
    const r1 = await method({ userId: '123' }, {});
    const r2 = await method({ userId: '123' }, {});
    expect(r1).toBe(r2); // Same reference from cache
  });

  it('skips cache with skipCache option', async () => {
    const method = client.getApiMethod('getUser');
    const r1 = await method({ userId: '123' }, {}, { skipCache: true });
    const r2 = await method({ userId: '123' }, {}, { skipCache: true });
    expect(r1).not.toBe(r2);
  });

  it('throws on unknown API key', () => {
    expect(() => client.getApiMethod('unknownApi')).toThrow('Unknown API key');
  });

  it('compiles all methods eagerly', () => {
    client.compileAll();
    expect(client.getApiMethod('getUser')).toBeDefined();
    expect(client.getApiMethod('createUser')).toBeDefined();
    expect(client.getApiMethod('getOrder')).toBeDefined();
  });

  it('getEntity returns cached entity', () => {
    // Entities are cached after API calls
    expect(client.getEntity('user', '123')).toBeUndefined();
  });

  it('destroy cleans up', () => {
    client.destroy();
    expect(() => client.getApiMethod('getUser')).toThrow('destroyed');
  });

  it('returns entity from entity cache after API call', async () => {
    const config: ApiConfig = {
      getUser: {
        url: '/api/user/{userId}',
        method: 'GET',
        entities: [{ name: 'user', idKey: 'userId' }],
        onSuccess: ['user:loaded'],
        onError: { default: 'error' },
      },
    };
    const c = new ApiClient(config, { adapter: mockAdapter });
    const method = c.getApiMethod('getUser');
    await method({ userId: '123' }, {});

    const entity = c.getEntity('user', '123');
    expect(entity).toBeDefined();
    expect((entity as { name: string }).name).toBe('Alice');
  });
});

// ============================================================
// Factory / Singleton / Proxy
// ============================================================

describe('ApiClient Factory & Singleton', () => {
  beforeEach(() => {
    destroyApiClient();
  });

  it('createApiClient creates a proxy-wrapped client', () => {
    const client = createApiClient(makeTestConfig());
    expect(client).toBeDefined();
    expect(typeof (client as unknown as Record<string, unknown>).getApiMethod).toBe('function');
  });

  it('xxxAPI proxy access generates methods', () => {
    const client = createApiClient(makeTestConfig());
    const method = (client as unknown as Record<string, unknown>).getUserAPI as (...args: unknown[]) => unknown;
    expect(method).toBeInstanceOf(Function);
  });

  it('initApiClient returns singleton', () => {
    const c1 = initApiClient(makeTestConfig());
    const c2 = initApiClient(makeTestConfig());
    expect(c1).toBe(c2);
  });

  it('destroyApiClient cleans up singleton', () => {
    initApiClient(makeTestConfig());
    destroyApiClient();
    expect(() => initApiClient(makeTestConfig())).not.toThrow();
  });
});
