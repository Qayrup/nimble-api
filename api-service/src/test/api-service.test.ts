import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createApiClient, ApiClient, MemoryCache, ApiError, stop } from '../index';
import type { RequestAdapter, AdapterResponse, ApiOptions } from '../core/types';

// ============================================================
// Test helpers
// ============================================================

function createMockAdapter(responses: Map<string, AdapterResponse> = new Map()): RequestAdapter {
  return {
    async request(config) {
      const key = `${config.method}:${config.url}`;
      const tmpl = responses.get(key);
      return {
        status: tmpl?.status ?? 200,
        data: JSON.parse(JSON.stringify(tmpl?.data ?? { code: 200, data: 'ok' })),
        headers: tmpl?.headers ?? {},
      };
    },
  };
}

function makeClient(adapter?: RequestAdapter, opts?: ApiOptions) {
  return createApiClient({ adapter, ...opts });
}

// ============================================================
// HTTP Methods
// ============================================================

describe('ApiClient HTTP methods', () => {
  let client: ApiClient;
  let responses: Map<string, AdapterResponse>;

  beforeEach(() => {
    responses = new Map();
    responses.set('GET:/api/user/123', {
      status: 200,
      data: { name: 'Alice', userId: '123' },
      headers: {},
    });
    responses.set('POST:/api/user', {
      status: 201,
      data: { name: 'Bob', userId: '456' },
      headers: {},
    });
    responses.set('GET:/api/order/xyz', {
      status: 200,
      data: { orderId: 'xyz', amount: 100 },
      headers: {},
    });

    const adapter = createMockAdapter(responses);
    client = makeClient(adapter);
  });

  it('client.get() makes a GET request', async () => {
    const result = await client.get('/api/user/123');
    expect(result).toEqual({ name: 'Alice', userId: '123' });
  });

  it('client.post() makes a POST request', async () => {
    const result = await client.post('/api/user', { json: { name: 'Bob' } });
    expect(result).toEqual({ name: 'Bob', userId: '456' });
  });

  it('client.put() makes a PUT request', async () => {
    responses.set('PUT:/api/user/1', { status: 200, data: { ok: true }, headers: {} });
    const result = await client.put('/api/user/1', { json: { name: 'X' } });
    expect(result).toEqual({ ok: true });
  });

  it('client.patch() makes a PATCH request', async () => {
    responses.set('PATCH:/api/user/1', { status: 200, data: { ok: true }, headers: {} });
    const result = await client.patch('/api/user/1', { json: { name: 'X' } });
    expect(result).toEqual({ ok: true });
  });

  it('client.delete() makes a DELETE request', async () => {
    responses.set('DELETE:/api/user/1', { status: 200, data: { ok: true }, headers: {} });
    const result = await client.delete('/api/user/1');
    expect(result).toEqual({ ok: true });
  });

  it('throws ApiError on non-2xx status', async () => {
    responses.set('GET:/api/error', { status: 500, data: { error: 'boom' }, headers: {} });
    await expect(client.get('/api/error')).rejects.toThrow(ApiError);
  });

  it('ApiError contains structured data', async () => {
    responses.set('GET:/api/error', { status: 404, data: { msg: 'not found' }, headers: { 'x-id': '1' } });
    try {
      await client.get('/api/error');
      expect.fail('should throw');
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      const apiErr = err as ApiError;
      expect(apiErr.status).toBe(404);
      expect(apiErr.request.url).toBe('/api/error');
      expect(apiErr.request.method).toBe('GET');
    }
  });
});

// ============================================================
// Cache
// ============================================================

describe('Cache', () => {
  it('caches responses within TTL', async () => {
    const callCount = vi.fn();
    const adapter: RequestAdapter = {
      async request(config) {
        callCount();
        return { status: 200, data: { key: config.url }, headers: {} };
      },
    };
    const client = makeClient(adapter, { cache: { ttl: 60000 } });
    const r1 = await client.get('/api/data');
    const r2 = await client.get('/api/data');
    expect(r1).toEqual(r2);
    expect(callCount).toHaveBeenCalledTimes(1);
  });

  it('skips cache with skip option', async () => {
    const callCount = vi.fn();
    const adapter: RequestAdapter = {
      async request() {
        callCount();
        return { status: 200, data: { test: true }, headers: {} };
      },
    };
    const client = makeClient(adapter);
    await client.get('/api/data', { cache: { ttl: 60000 } });
    await client.get('/api/data', { cache: { ttl: 60000, skip: true } });
    expect(callCount).toHaveBeenCalledTimes(2);
  });

  it('SWR returns stale data then revalidates', async () => {
    let callCount = 0;
    const adapter: RequestAdapter = {
      async request() {
        callCount++;
        return { status: 200, data: { fresh: callCount }, headers: {} };
      },
    };
    const client = makeClient(adapter, { cache: { ttl: 10, mode: 'swr' } });

    const r1 = await client.get('/api/swr');
    expect(r1).toEqual({ fresh: 1 });
    expect(callCount).toBe(1);

    // Wait for TTL to expire
    await new Promise(r => setTimeout(r, 15));

    const r2 = await client.get('/api/swr');
    expect(r2).toEqual({ fresh: 1 }); // stale data returned
    // Wait for background revalidation
    await new Promise(r => setTimeout(r, 20));
    expect(callCount).toBe(2);
  });
});

// ============================================================
// Cache Control
// ============================================================

describe('CacheControl', () => {
  it('invalidates by tags', async () => {
    let callCount = 0;
    const adapter: RequestAdapter = {
      async request(config) {
        callCount++;
        return { status: 200, data: { url: config.url }, headers: {} };
      },
    };
    const client = makeClient(adapter, { cache: { ttl: 60000 } });

    await client.get('/api/user/1', { cache: { tags: ['user'] } });
    expect(callCount).toBe(1);

    // Second call should be cached
    await client.get('/api/user/1', { cache: { tags: ['user'] } });
    expect(callCount).toBe(1);

    // Invalidate — next call re-fetches
    client.cache.invalidate({ tags: ['user'] });
    await client.get('/api/user/1', { cache: { tags: ['user'] } });
    expect(callCount).toBe(2);
  });

  it('clears all cache', () => {
    const cache = new MemoryCache();
    cache.set('a', 1, 60000);
    cache.set('b', 2, 60000);
    cache.clear();
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
  });
});

// ============================================================
// MemoryCache (LRU + tags)
// ============================================================

describe('MemoryCache', () => {
  it('stores and retrieves', () => {
    const cache = new MemoryCache();
    cache.set('key', 'value', 60000);
    expect(cache.get('key')).toBe('value');
  });

  it('expires after TTL', async () => {
    const cache = new MemoryCache();
    cache.set('key', 'value', 10);
    await new Promise(r => setTimeout(r, 15));
    expect(cache.get('key')).toBeUndefined();
  });

  it('getStale returns stale flag', async () => {
    const cache = new MemoryCache();
    cache.set('key', 'value', 10);
    await new Promise(r => setTimeout(r, 15));
    const result = cache.getStale('key');
    expect(result).toBeDefined();
    expect(result!.stale).toBe(true);
  });

  it('LRU evicts oldest entry', () => {
    const cache = new MemoryCache(2);
    cache.set('a', 1, 60000);
    cache.set('b', 2, 60000);
    cache.set('c', 3, 60000); // evicts 'a'
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBe(2);
    expect(cache.get('c')).toBe(3);
    expect(cache.size).toBe(2);
  });

  it('LRU bumps on get', () => {
    const cache = new MemoryCache(2);
    cache.set('a', 1, 60000);
    cache.set('b', 2, 60000);
    cache.get('a'); // bumps 'a' to most recent
    cache.set('c', 3, 60000); // evicts 'b' (now LRU)
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('a')).toBe(1);
    expect(cache.get('c')).toBe(3);
  });

  it('tag-based invalidation', () => {
    const cache = new MemoryCache();
    cache.set('a', 1, 60000, ['user', 'list']);
    cache.set('b', 2, 60000, ['user']);
    cache.set('c', 3, 60000, ['order']);

    cache.invalidateByTags(['user']);
    expect(cache.get('a')).toBeUndefined();
    expect(cache.get('b')).toBeUndefined();
    expect(cache.get('c')).toBe(3); // not affected
  });

  it('has() checks TTL', async () => {
    const cache = new MemoryCache();
    cache.set('key', 'value', 10);
    expect(cache.has('key')).toBe(true);
    await new Promise(r => setTimeout(r, 15));
    expect(cache.has('key')).toBe(false);
  });

  it('delete removes entry', () => {
    const cache = new MemoryCache();
    cache.set('key', 'value', 60000);
    cache.delete('key');
    expect(cache.get('key')).toBeUndefined();
  });
});

// ============================================================
// Retry
// ============================================================

describe('Retry', () => {
  it('retries on 5xx errors', async () => {
    let attempts = 0;
    const adapter: RequestAdapter = {
      async request() {
        attempts++;
        if (attempts < 3) return { status: 500, data: { error: 'boom' }, headers: {} };
        return { status: 200, data: { ok: true }, headers: {} };
      },
    };
    const client = makeClient(adapter, { retry: { limit: 3, backoff: 'fixed', baseDelay: 10 } });

    const result = await client.get('/api/flaky');
    expect(result).toEqual({ ok: true });
    expect(attempts).toBe(3);
  });

  it('retry: false at client level disables retry', async () => {
    let attempts = 0;
    const adapter: RequestAdapter = {
      async request() {
        attempts++;
        return { status: 500, data: {}, headers: {} };
      },
    };
    const client = makeClient(adapter, { retry: false });

    await expect(client.get('/api/fail')).rejects.toThrow(ApiError);
    expect(attempts).toBe(1);
  });

  it('throws after exhausting retries', async () => {
    const adapter: RequestAdapter = {
      async request() {
        return { status: 500, data: {}, headers: {} };
      },
    };
    const client = makeClient(adapter, { retry: { limit: 1, backoff: 'fixed', baseDelay: 5 } });

    await expect(client.get('/api/fail')).rejects.toThrow(ApiError);
  });

  it('respects stop symbol in beforeRetry hook', async () => {
    let attempts = 0;
    const adapter: RequestAdapter = {
      async request() {
        attempts++;
        return { status: 500, data: {}, headers: {} };
      },
    };
    const client = makeClient(adapter, {
      retry: { limit: 3, backoff: 'fixed', baseDelay: 5 },
      hooks: {
        beforeRetry: [() => stop],
      },
    });

    await expect(client.get('/api/stop')).rejects.toThrow(ApiError);
    expect(attempts).toBe(1); // should stop after first attempt
  });
});

// ============================================================
// Hooks
// ============================================================

describe('Hooks', () => {
  it('beforeRequest modifies request', async () => {
    const adapter: RequestAdapter = {
      async request(config) {
        return { status: 200, data: { header: config.headers['Authorization'] }, headers: {} };
      },
    };
    const client = makeClient(adapter, {
      hooks: {
        beforeRequest: [(state) => ({
          ...state,
          request: { ...state.request, headers: { ...state.request.headers, Authorization: 'Bearer token' } },
        })],
      },
    });

    const result = await client.get('/api/auth');
    expect(result).toEqual({ header: 'Bearer token' });
  });

  it('afterResponse transforms response', async () => {
    const adapter: RequestAdapter = {
      async request() {
        return { status: 200, data: { raw: 'data' }, headers: {} };
      },
    };
    const client = makeClient(adapter, {
      hooks: {
        afterResponse: [(state) => ({
          ...state,
          response: { ...state.response!, data: { wrapped: state.response!.data } },
        })],
      },
    });

    const result = await client.get('/api/data');
    expect(result).toEqual({ wrapped: { raw: 'data' } });
  });

  it('beforeError can modify error', async () => {
    const adapter: RequestAdapter = {
      async request() {
        return { status: 500, data: {}, headers: {} };
      },
    };
    const client = makeClient(adapter, {
      retry: { limit: 1, baseDelay: 5 },
      hooks: {
        beforeError: [(state) => {
          state.error!.message = 'Custom error';
          return state;
        }],
      },
    });

    await expect(client.get('/api/error')).rejects.toThrow('Custom error');
  });
});

// ============================================================
// Extend
// ============================================================

describe('extend()', () => {
  it('creates derived instance with merged config', async () => {
    const adapter: RequestAdapter = {
      async request(config) {
        return { status: 200, data: { headers: config.headers }, headers: {} };
      },
    };
    const base = makeClient(adapter, { headers: { 'X-Base': '1' } });
    const child = base.extend({ headers: { 'X-Child': '2' } });

    const result = await child.get('/api/data');
    expect(result).toEqual({ headers: { 'X-Base': '1', 'X-Child': '2' } });
  });
});

// ============================================================
// Lifecycle
// ============================================================

describe('Lifecycle', () => {
  it('dispose prevents further operations', async () => {
    const client = makeClient();
    client.dispose();
    await expect(client.get('/api/data')).rejects.toThrow('destroyed');
  });

  it('[Symbol.dispose] disposes', async () => {
    const client = makeClient();
    client[Symbol.dispose]();
    await expect(client.get('/api/data')).rejects.toThrow('destroyed');
  });
});

// ============================================================
// createTypedApi
// ============================================================

describe('createTypedApi', () => {
  it('creates typed API methods with type inference from spec', async () => {
    const responses = new Map<string, AdapterResponse>();
    responses.set('GET:/api/user/123', { status: 200, data: { name: 'Alice' }, headers: {} });
    responses.set('POST:/api/user', { status: 201, data: { name: 'Bob' }, headers: {} });

    const client = makeClient(createMockAdapter(responses));

    const { createTypedApi } = await import('../typed');
    const api = createTypedApi(client, {
      getUser: {
        url: '/api/user/{userId}',
        _params: {} as { userId: string },
        _response: {} as { name: string },
      },
      createUser: {
        url: '/api/user',
        method: 'POST',
        _response: {} as { name: string },
      },
    });

    const user = await api.getUser({ params: { userId: '123' } });
    expect(user).toEqual({ name: 'Alice' });

    const newUser = await api.createUser({ body: { name: 'Bob' } });
    expect(newUser).toEqual({ name: 'Bob' });
  });

  it('lock: true prevents concurrent calls and returns null', async () => {
    let inFlight = 0;
    const adapter: RequestAdapter = {
      async request() {
        inFlight++;
        await new Promise(r => setTimeout(r, 50));
        return { status: 200, data: { ok: true }, headers: {} };
      },
    };
    const client = makeClient(adapter);
    const { createTypedApi } = await import('../typed');
    const api = createTypedApi(client, {
      guarded: { url: '/api/guard', lock: true },
    });

    const [r1, r2] = await Promise.all([
      api.guarded(),
      api.guarded(),
    ]);

    expect(r1).toEqual({ ok: true });
    expect(r2).toBeNull();
    expect(inFlight).toBe(1);
  });

  it('lock: true unlocks after completion for next call', async () => {
    const adapter: RequestAdapter = {
      async request() {
        return { status: 200, data: { ok: true }, headers: {} };
      },
    };
    const client = makeClient(adapter);
    const { createTypedApi } = await import('../typed');
    const api = createTypedApi(client, {
      guarded: { url: '/api/guard', lock: true },
    });

    const r1 = await api.guarded();
    const r2 = await api.guarded();

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true }); // not null — first call finished
  });

  it('endpoint without _params does not require params', async () => {
    const responses = new Map<string, AdapterResponse>();
    responses.set('GET:/api/users', { status: 200, data: ['ok'], headers: {} });
    const client = makeClient(createMockAdapter(responses));

    const { createTypedApi } = await import('../typed');
    const api = createTypedApi(client, {
      listUsers: { url: '/api/users' },
    });

    const result = await api.listUsers();
    expect(result).toEqual(['ok']);
  });
});

// ============================================================
// searchParams array support
// ============================================================

describe('searchParams array support', () => {
  it('produces repeated keys for array values', async () => {
    const capturedUrls: string[] = [];
    const adapter: RequestAdapter = {
      async request(config) {
        capturedUrls.push(config.url);
        return { status: 200, data: { ok: true }, headers: {} };
      },
    };
    const client = makeClient(adapter);

    await client.get('/api/items', {
      searchParams: { ids: [1, 2, 3], category: 'books' },
    });

    const url = capturedUrls[0];
    expect(url).toContain('ids=1');
    expect(url).toContain('ids=2');
    expect(url).toContain('ids=3');
    expect(url).toContain('category=books');
  });

  it('skips null and undefined values', async () => {
    const capturedUrls: string[] = [];
    const adapter: RequestAdapter = {
      async request(config) {
        capturedUrls.push(config.url);
        return { status: 200, data: { ok: true }, headers: {} };
      },
    };
    const client = makeClient(adapter);

    await client.get('/api/items', {
      searchParams: { active: true, deleted: null, hidden: undefined },
    });

    const url = capturedUrls[0];
    expect(url).toContain('active=true');
    expect(url).not.toContain('deleted');
    expect(url).not.toContain('hidden');
  });
});

// ============================================================
// validateStatus
// ============================================================

describe('validateStatus', () => {
  it('accepts custom validateStatus', async () => {
    const adapter: RequestAdapter = {
      async request() {
        return { status: 304, data: null, headers: {} };
      },
    };
    const client = makeClient(adapter, {
      validateStatus: (status) => status === 304 || (status >= 200 && status < 300),
    });

    const result = await client.get('/api/cached');
    expect(result).toBeNull();
  });

  it('rejects when custom validateStatus returns false', async () => {
    const adapter: RequestAdapter = {
      async request() {
        return { status: 304, data: null, headers: {} };
      },
    };
    const client = makeClient(adapter);

    await expect(client.get('/api/cached')).rejects.toThrow(ApiError);
  });
});

// ============================================================
// head() / options()
// ============================================================

describe('head() / options()', () => {
  it('client.head() sends a HEAD request', async () => {
    let capturedMethod = '';
    const adapter: RequestAdapter = {
      async request(config) {
        capturedMethod = config.method;
        return { status: 200, data: null, headers: {} };
      },
    };
    const client = makeClient(adapter);

    await client.head('/api/health');
    expect(capturedMethod).toBe('HEAD');
  });

  it('client.options() sends an OPTIONS request', async () => {
    let capturedMethod = '';
    const adapter: RequestAdapter = {
      async request(config) {
        capturedMethod = config.method;
        return { status: 204, data: null, headers: { allow: 'GET,POST' } };
      },
    };
    const client = makeClient(adapter);

    await client.options('/api/cors');
    expect(capturedMethod).toBe('OPTIONS');
  });
});

// ============================================================
// Cache keyPrefix invalidation
// ============================================================

describe('Cache keyPrefix invalidation', () => {
  it('invalidateByKeyPrefix removes matching cache entries', () => {
    const cache = new MemoryCache();
    cache.set('GET:/api/user/1', { name: 'A' }, 60000);
    cache.set('GET:/api/user/2', { name: 'B' }, 60000);
    cache.set('GET:/api/order/1', { id: 1 }, 60000);

    cache.invalidateByKeyPrefix('GET:/api/user');

    expect(cache.get('GET:/api/user/1')).toBeUndefined();
    expect(cache.get('GET:/api/user/2')).toBeUndefined();
    expect(cache.get('GET:/api/order/1')).toBeDefined();
  });

  it('cache.invalidate with keyPrefix clears matching entries via client', async () => {
    let callCount = 0;
    const adapter: RequestAdapter = {
      async request(config) {
        callCount++;
        return { status: 200, data: { url: config.url }, headers: {} };
      },
    };
    const client = makeClient(adapter, { cache: { ttl: 60000 } });

    await client.get('/api/user/1');
    await client.get('/api/user/1'); // cached
    expect(callCount).toBe(1);

    client.cache.invalidate({ keyPrefix: '/api/user' });

    await client.get('/api/user/1'); // re-fetched
    expect(callCount).toBe(2);
  });
});

// ============================================================
// createBearerAuth
// ============================================================

describe('createBearerAuth', () => {
  it('adds Authorization header', async () => {
    const { createBearerAuth } = await import('../auth');

    let capturedHeaders: Record<string, string> = {};
    const adapter: RequestAdapter = {
      async request(config) {
        capturedHeaders = config.headers;
        return { status: 200, data: { authed: true }, headers: {} };
      },
    };

    const client = makeClient(adapter, {
      hooks: { beforeRequest: [createBearerAuth('my-token')] },
    });

    await client.get('/api/protected');
    expect(capturedHeaders['Authorization']).toBe('Bearer my-token');
  });

  it('supports dynamic token function', async () => {
    const { createBearerAuth } = await import('../auth');

    let token = 'first-token';
    let capturedHeaders: Record<string, string> = {};
    const adapter: RequestAdapter = {
      async request(config) {
        capturedHeaders = config.headers;
        return { status: 200, data: {}, headers: {} };
      },
    };

    const client = makeClient(adapter, {
      hooks: { beforeRequest: [createBearerAuth(() => token)] },
    });

    await client.get('/api/test');
    expect(capturedHeaders['Authorization']).toBe('Bearer first-token');

    token = 'refreshed-token';
    await client.get('/api/test');
    expect(capturedHeaders['Authorization']).toBe('Bearer refreshed-token');
  });
});

// ============================================================
// ErrorCode classification
// ============================================================

describe('ErrorCode classification', () => {
  it('sets ERR_BAD_REQUEST for 4xx', async () => {
    const adapter: RequestAdapter = {
      async request() {
        return { status: 404, data: { msg: 'not found' }, headers: {} };
      },
    };
    const client = makeClient(adapter, { retry: false });

    try {
      await client.get('/api/missing');
      expect.fail('should throw');
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('ERR_BAD_REQUEST');
    }
  });

  it('sets ERR_BAD_RESPONSE for 5xx', async () => {
    const adapter: RequestAdapter = {
      async request() {
        return { status: 500, data: {}, headers: {} };
      },
    };
    const client = makeClient(adapter, { retry: false });

    try {
      await client.get('/api/boom');
      expect.fail('should throw');
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('ERR_BAD_RESPONSE');
    }
  });
});

// ============================================================
// totalTimeout
// ============================================================

describe('totalTimeout', () => {
  it('throws after totalTimeout exceeded across retries', async () => {
    const adapter: RequestAdapter = {
      async request() {
        return { status: 500, data: {}, headers: {} };
      },
    };
    const client = makeClient(adapter, {
      retry: { limit: 5, backoff: 'fixed', baseDelay: 100 },
      totalTimeout: 50,
    });

    try {
      await client.get('/api/timeout');
      expect.fail('should throw');
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('ERR_TIMEOUT');
    }
  });
});

// ============================================================
// hooks.init
// ============================================================

describe('hooks.init', () => {
  it('mutates request options before normalization', async () => {
    let capturedHeaders: Record<string, string> = {};
    const adapter: RequestAdapter = {
      async request(config) {
        capturedHeaders = config.headers;
        return { status: 200, data: { ok: true }, headers: {} };
      },
    };

    const client = makeClient(adapter, {
      hooks: {
        init: [(opts) => ({ ...opts, headers: { ...opts.headers, 'X-Extra': '1' } })],
      },
    });

    await client.get('/api/data');
    expect(capturedHeaders['X-Extra']).toBe('1');
  });

  it('init hooks can inject searchParams', async () => {
    let capturedUrl = '';
    const adapter: RequestAdapter = {
      async request(config) {
        capturedUrl = config.url;
        return { status: 200, data: {}, headers: {} };
      },
    };

    const client = makeClient(adapter, {
      hooks: {
        init: [(opts) => ({ ...opts, searchParams: { ...opts.searchParams, injected: '1' } })],
      },
    });

    await client.get('/api/data');
    expect(capturedUrl).toContain('injected=1');
  });
});

// ============================================================
// beforeRequest short-circuit
// ============================================================

describe('beforeRequest short-circuit', () => {
  it('beforeRequest hook can short-circuit by setting response', async () => {
    let adapterCalled = false;
    const adapter: RequestAdapter = {
      async request() {
        adapterCalled = true;
        return { status: 200, data: {}, headers: {} };
      },
    };

    const client = makeClient(adapter, {
      hooks: {
        beforeRequest: [(state) => ({
          ...state,
          response: { status: 200, data: { mocked: true }, headers: {} },
        })],
      },
    });

    const result = await client.get('/api/mock');
    expect(result).toEqual({ mocked: true });
    expect(adapterCalled).toBe(false);
  });
});

// ============================================================
// paramsSerializer
// ============================================================

describe('paramsSerializer', () => {
  it('uses custom serializer for query params', async () => {
    let capturedUrl = '';
    const adapter: RequestAdapter = {
      async request(config) {
        capturedUrl = config.url;
        return { status: 200, data: {}, headers: {} };
      },
    };

    const client = makeClient(adapter, {
      paramsSerializer: (params) => {
        const parts: string[] = [];
        for (const [k, v] of Object.entries(params)) {
          if (Array.isArray(v)) {
            for (const item of v) {
              parts.push(`${encodeURIComponent(k)}[]=${encodeURIComponent(String(item))}`);
            }
          } else {
            parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
          }
        }
        return parts.join('&');
      },
    });

    await client.get('/api/items', {
      searchParams: { ids: [1, 2, 3], page: '1' },
    });

    expect(capturedUrl).toContain('ids[]=1');
    expect(capturedUrl).toContain('ids[]=2');
    expect(capturedUrl).toContain('ids[]=3');
    expect(capturedUrl).toContain('page=1');
  });
});

// ============================================================
// maxContentLength
// ============================================================

describe('maxContentLength', () => {
  it('throws when Content-Length exceeds max', async () => {
    const adapter: RequestAdapter = {
      async request() {
        return {
          status: 200,
          data: {},
          headers: { 'content-length': '99999999' },
        };
      },
    };
    const client = makeClient(adapter, { maxContentLength: 1024 });

    try {
      await client.get('/api/large');
      expect.fail('should throw');
    } catch (err) {
      const apiErr = err as ApiError;
      expect(apiErr.code).toBe('ERR_MAX_SIZE');
    }
  });
});

// ============================================================
// gcTime / staleTime separation
// ============================================================

describe('gcTime / staleTime separation', () => {
  it('gcTime defaults to Infinity (no auto GC)', () => {
    const cache = new MemoryCache();
    cache.set('key', 'value', 10);
    expect(cache.has('key')).toBe(true);
  });

  it('gcTime removes entry after inactivity', async () => {
    const cache = new MemoryCache();
    cache.set('key', 'value', 60000, [], 10);
    expect(cache.has('key')).toBe(true);
    await new Promise(r => setTimeout(r, 15));
    expect(cache.has('key')).toBe(false);
  });

  it('exportState and importState roundtrip', () => {
    const cache = new MemoryCache(100);
    cache.set('a', 1, 60000, ['tag1']);
    cache.set('b', 2, 60000, ['tag2']);

    const json = cache.exportState();
    const cache2 = new MemoryCache();
    cache2.importState(json);

    expect(cache2.get('a')).toBe(1);
    expect(cache2.get('b')).toBe(2);
    expect(cache2.maxSize).toBe(100);

    // Verify tag index was rebuilt
    expect(cache2.has('a')).toBe(true);
    cache2.invalidateByTags(['tag1']);
    expect(cache2.has('a')).toBe(false);
  });
});

// ============================================================
// debounce / throttle at typed API level
// ============================================================

describe('debounce / throttle on typed API', () => {
  it('endpoint-level debounce cancels previous call and resolves previous to null', async () => {
    let callCount = 0;
    const adapter: RequestAdapter = {
      async request() {
        callCount++;
        await new Promise(r => setTimeout(r, 20));
        return { status: 200, data: { ok: true }, headers: {} };
      },
    };
    const client = makeClient(adapter);
    const { createTypedApi } = await import('../typed');
    const api = createTypedApi(client, {
      search: { url: '/search', debounce: 50, _response: {} as { ok: boolean } },
    });

    const [r1, r2, r3] = await Promise.all([
      api.search({ params: { q: 'a' } }),
      api.search({ params: { q: 'ab' } }),
      api.search({ params: { q: 'abc' } }),
    ]);

    expect(r1).toBeNull();
    expect(r2).toBeNull();
    expect(r3).toEqual({ ok: true });
    expect(callCount).toBe(1);
  });

  it('endpoint-level throttle returns null for calls within window', async () => {
    let callCount = 0;
    const adapter: RequestAdapter = {
      async request() {
        callCount++;
        return { status: 200, data: { ok: true }, headers: {} };
      },
    };
    const client = makeClient(adapter);
    const { createTypedApi } = await import('../typed');
    const api = createTypedApi(client, {
      track: { url: '/track', method: 'POST', throttle: 100, _response: {} as { ok: boolean } },
    });

    const r1 = await api.track({ body: { x: 1 } });
    const r2 = await api.track({ body: { x: 2 } });

    expect(r1).toEqual({ ok: true });
    expect(r2).toBeNull();
    expect(callCount).toBe(1);
  });

  it('debounce: false at call-time disables endpoint debounce', async () => {
    let callCount = 0;
    const urls: string[] = [];
    const adapter: RequestAdapter = {
      async request(config) {
        callCount++;
        urls.push(config.url);
        return { status: 200, data: { ok: true }, headers: {} };
      },
    };
    const client = makeClient(adapter);
    const { createTypedApi } = await import('../typed');
    const api = createTypedApi(client, {
      search: { url: '/search', debounce: 300, _response: {} as { ok: boolean } },
    });

    const r1 = await api.search({ params: { q: 'a' }, debounce: false });
    const r2 = await api.search({ params: { q: 'b' }, debounce: false });

    expect(r1).toEqual({ ok: true });
    expect(r2).toEqual({ ok: true });
    expect(callCount).toBe(2);
  });

  it('lock + debounce combined: debounce wraps lock, lock holds during HTTP call', async () => {
    let callCount = 0;
    const adapter: RequestAdapter = {
      async request() {
        callCount++;
        await new Promise(r => setTimeout(r, 30));
        return { status: 200, data: { ok: true }, headers: {} };
      },
    };
    const client = makeClient(adapter);
    const { createTypedApi } = await import('../typed');
    const api = createTypedApi(client, {
      guarded: { url: '/guard', lock: true, debounce: 20, _response: {} as { ok: boolean } },
    });

    // rapid calls — debounce collapses to 1, lock ensures only 1 HTTP call
    const results = await Promise.all([
      api.guarded({ body: { x: 1 } }),
      api.guarded({ body: { x: 2 } }),
      api.guarded({ body: { x: 3 } }),
    ]);

    const nonNull = results.filter(r => r !== null);
    expect(nonNull).toHaveLength(1);
    expect(nonNull[0]).toEqual({ ok: true });
    expect(callCount).toBe(1);
  });
});
