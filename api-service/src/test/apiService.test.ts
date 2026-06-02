import { describe, it, expect } from 'vitest';
import { createApiService, OPTIMIZE_TYPES } from '../index';
import { generateCacheKey, hashString, stableNormalize, normalizeObject } from '../esm/apiService/cacheKeyGenerator';
import {
  debounceOptimizer,
  switchLockOptimizer,
  throttleOptimizer,
  linkLockOptimizer,
  returnControlOptimizer,
  debounceThrottleOptimizer
} from '../esm/apiService/optimizers';
import type { MethodWithMethodId } from '../esm/apiService/optimizers';

describe('OPTIMIZE_TYPES', () => {
  it('should export all optimization types', () => {
    expect(OPTIMIZE_TYPES.DEBOUNCE).toBe('debounce');
    expect(OPTIMIZE_TYPES.THROTTLE).toBe('throttle');
    expect(OPTIMIZE_TYPES.SWITCH_LOCK).toBe('switchLock');
    expect(OPTIMIZE_TYPES.LINK_LOCK).toBe('linkLock');
    expect(OPTIMIZE_TYPES.RETURN_CONTROL).toBe('return');
    expect(OPTIMIZE_TYPES.DEBOUNCE_THROTTLE).toBe('debounceThrottle');
  });
});

describe('createApiService', () => {
  it('should create an API service instance', () => {
    const api = createApiService({
      testEndpoint: {
        url: '/api/test/{id}',
        eventSuccess: ['TEST.SUCCESS'],
        eventErrors: { default: 'TEST.ERROR' },
      },
    });
    expect(api).toBeDefined();
  });

  it('should lazily create API methods via proxy', () => {
    const api = createApiService({
      testEndpoint: {
        url: '/api/test/{id}',
        eventSuccess: ['TEST.SUCCESS'],
        eventErrors: { default: 'TEST.ERROR' },
      },
    });
    const method = (api as unknown as Record<string, unknown>).testEndpointAPI;
    expect(typeof method).toBe('function');
  });
});

describe('generateCacheKey', () => {
  it('should generate consistent keys for same input', () => {
    const key1 = generateCacheKey('test', { a: 1, b: 2 }, { x: 'y' });
    const key2 = generateCacheKey('test', { b: 2, a: 1 }, { x: 'y' });
    expect(key1).toBe(key2);
  });

  it('should generate different keys for different input', () => {
    const key1 = generateCacheKey('test', { a: 1 }, {});
    const key2 = generateCacheKey('test', { a: 2 }, {});
    expect(key1).not.toBe(key2);
  });

  it('should handle empty params and data', () => {
    const key = generateCacheKey('api', null, undefined);
    expect(key).toBe('api:0:0');
  });
});

describe('hashString', () => {
  it('should generate consistent hashes', () => {
    const h1 = hashString('hello world');
    const h2 = hashString('hello world');
    expect(h1).toBe(h2);
  });

  it('should return zero-padded for empty string', () => {
    const result = hashString('');
    expect(result).toBe('00000000');
  });
});

describe('stableNormalize', () => {
  it('should sort object keys', () => {
    const input = { b: 1, a: 2, c: { z: 3, y: 4 } };
    const result = stableNormalize(input) as Record<string, unknown>;
    const keys = Object.keys(result);
    expect(keys).toEqual(['a', 'b', 'c']);
  });
});

describe('normalizeObject', () => {
  it('should sort object keys', () => {
    const result = normalizeObject({ b: 2, a: 1 }) as Record<string, unknown>;
    expect(Object.keys(result)).toEqual(['a', 'b']);
  });

  it('should handle Date objects', () => {
    const date = new Date('2026-01-01T00:00:00.000Z');
    const result = normalizeObject({ d: date }) as Record<string, unknown>;
    expect(result.d).toBe('2026-01-01T00:00:00.000Z');
  });

  it('should handle RegExp objects', () => {
    const result = normalizeObject({ r: /test/gi }) as Record<string, unknown>;
    expect(result.r).toBe('/test/gi');
  });

  it('should handle Map objects', () => {
    const map = new Map([['b', 2], ['a', 1]]);
    const result = normalizeObject({ m: map }) as Record<string, unknown>;
    const arr = result.m as [string, number][];
    // Should be sorted by key
    expect(arr[0][0]).toBe('a');
    expect(arr[1][0]).toBe('b');
  });

  it('should handle Set objects', () => {
    const set = new Set([3, 1, 2]);
    const result = normalizeObject({ s: set }) as Record<string, unknown>;
    expect(result.s).toEqual([1, 2, 3]);
  });

  it('should handle circular references', () => {
    const obj: Record<string, unknown> = { name: 'test' };
    obj.self = obj;
    const result = normalizeObject(obj) as Record<string, unknown>;
    expect(result.self).toBe('__CIRCULAR_REF__');
  });

  it('should handle special values: NaN, Infinity', () => {
    const result = normalizeObject({ nan: NaN, inf: Infinity, negInf: -Infinity, undef: undefined }) as Record<string, unknown>;
    expect(result.nan).toBe('__NaN__');
    expect(result.inf).toBe('__Infinity__');
    expect(result.negInf).toBe('__-Infinity__');
    expect(result.undef).toBe('__undefined__');
  });
});

describe('optimizers', () => {
  it('debounceOptimizer should require methodId', () => {
    const method = (() => Promise.resolve()) as MethodWithMethodId;
    const cache = new Map();
    expect(() => debounceOptimizer(method, cache)).toThrow('缺少方法标识符');
  });

  it('debounceOptimizer should debounce rapid calls', async () => {
    const cache = new Map<symbol, { timer: ReturnType<typeof setTimeout> | null; lastResolve: ((v: unknown) => void) | null; lastReject: ((e: unknown) => void) | null }>();
    const methodId = Symbol('debounce-test');
    let callCount = 0;

    const method: MethodWithMethodId<number> = async () => {
      callCount++;
      return callCount;
    };
    method.methodId = methodId;

    const debounced = debounceOptimizer(method, cache, 50);
    const p1 = debounced();
    const p2 = debounced();
    const p3 = debounced();

    const [r1, r2, r3] = await Promise.allSettled([p1, p2, p3]);
    // First two are rejected (superseded), last one resolves
    expect(r1.status).toBe('rejected');
    expect(r2.status).toBe('rejected');
    expect(r3.status).toBe('fulfilled');
    expect(callCount).toBe(1);
  });

  it('throttleOptimizer should throttle calls', async () => {
    const cache = new Map<symbol, { lastCall: number; lastPromise: Promise<unknown> | null }>();
    const methodId = Symbol('throttle-test');
    let callCount = 0;

    const method: MethodWithMethodId<number> = async () => {
      callCount++;
      return callCount;
    };
    method.methodId = methodId;

    const throttled = throttleOptimizer(method, cache, 100);
    const r1 = await throttled();
    expect(r1).toBe(1);

    // Second call within window should share same promise
    const r2 = await throttled();
    expect(r2).toBe(1);
    expect(callCount).toBe(1);
  });

  it('switchLockOptimizer should lock concurrent calls', async () => {
    const lockMap = new Map<symbol, { value: boolean }>();
    const methodId = Symbol('test');
    let callCount = 0;

    const method: MethodWithMethodId = async () => {
      callCount++;
      return 'result';
    };
    method.methodId = methodId;

    const locked = switchLockOptimizer(method, lockMap);
    const [r1, r2] = await Promise.all([locked(), locked()]);
    expect(r1).toBe('result');
    expect(r2).toBeNull();
    expect(callCount).toBe(1);
  });

  it('linkLockOptimizer should prevent concurrent calls', async () => {
    const methodId = Symbol('link-test');
    const method: MethodWithMethodId<string> = async () => {
      await new Promise(r => setTimeout(r, 30));
      return 'done';
    };
    method.methodId = methodId;

    const locked = linkLockOptimizer(method);
    const p1 = locked();
    // p2 catches the expected rejection
    const p2 = locked().catch(e => e);

    const r1 = await p1;
    expect(r1).toBe('done');
    const r2 = await p2;
    expect(r2).toBeInstanceOf(Error);
    expect((r2 as Error).message).toBe('请求被限流：操作进行中');
  });

  it('returnControlOptimizer should return result when shouldReturn=true', async () => {
    const methodId = Symbol('return-test');
    const method: MethodWithMethodId<string> = async () => 'data';
    method.methodId = methodId;

    const controlled = returnControlOptimizer(method, true);
    const result = await controlled();
    expect(result).toBe('data');
  });

  it('returnControlOptimizer should return undefined when shouldReturn=false', async () => {
    const methodId = Symbol('return-test-2');
    const method: MethodWithMethodId<string> = async () => 'data';
    method.methodId = methodId;

    const controlled = returnControlOptimizer(method, false);
    const result = await controlled();
    expect(result).toBeUndefined();
  });

  it('debounceThrottleOptimizer should combine debounce and throttle', async () => {
    const debounceCache = new Map<symbol, { timer: ReturnType<typeof setTimeout> | null; lastResolve: ((v: unknown) => void) | null; lastReject: ((e: unknown) => void) | null }>();
    const throttleCache = new Map<symbol, { lastCall: number; lastPromise: Promise<unknown> | null }>();
    const methodId = Symbol('dt-test');
    let callCount = 0;

    const method: MethodWithMethodId<number> = async () => {
      callCount++;
      return callCount;
    };
    method.methodId = methodId;

    const optimized = debounceThrottleOptimizer(method, debounceCache, throttleCache, 50);
    optimized();
    optimized();
    const result = await optimized();

    expect(typeof result).toBe('number');
    expect(callCount).toBe(1);
  });
});
