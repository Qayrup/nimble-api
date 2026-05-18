import { describe, it, expect } from 'vitest';
import { createApiService, OPTIMIZE_TYPES } from '../index';
import { generateCacheKey, hashString, stableNormalize } from '../esm/apiService/cacheKeyGenerator';
import { debounceOptimizer, switchLockOptimizer } from '../esm/apiService/optimizers';
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
    const method = (api as Record<string, unknown>).testEndpointAPI;
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

describe('optimizers', () => {
  it('debounceOptimizer should require methodId', () => {
    const method = (() => Promise.resolve()) as MethodWithMethodId;
    const cache = new Map();
    expect(() => debounceOptimizer(method, cache)).toThrow('缺少方法标识符');
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
});
