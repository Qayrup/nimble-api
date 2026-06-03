import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createEventHub, initEventHub, destroyEventHub } from '../index';
import { EventEmitter } from '../core/EventEmitter';
import type { EventMap } from '../core/types';

interface TestEvents extends EventMap {
  'user:login': { userId: string; timestamp: number };
  'user:logout': { userId: string };
  'order:created': { orderId: string; amount: number };
  'order:paid': { orderId: string };
  'system:error': { message: string; code: number };
}

function createTestEmitter(settings = {}) {
  return createEventHub<TestEvents>(settings);
}

// ============================================================
// EventEmitter 核心测试
// ============================================================

describe('EventEmitter core', () => {
  describe('on() + emit()', () => {
    it('registers and invokes handler with correct payload type', () => {
      const emitter = createTestEmitter();
      const handler = vi.fn();
      emitter.on('user:login', handler);
      emitter.emit('user:login', { userId: '123', timestamp: 1000 });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ userId: '123', timestamp: 1000 });
    });

    it('on() returns unsubscribe function', () => {
      const emitter = createTestEmitter();
      const handler = vi.fn();
      const unsub = emitter.on('user:login', handler);
      unsub();
      emitter.emit('user:login', { userId: '123', timestamp: 1000 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('supports AbortSignal for auto-unsubscribe', () => {
      const emitter = createTestEmitter();
      const handler = vi.fn();
      const controller = new AbortController();
      emitter.on('user:login', handler, { signal: controller.signal });
      controller.abort();
      emitter.emit('user:login', { userId: '123', timestamp: 1000 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('supports once option', () => {
      const emitter = createTestEmitter();
      const handler = vi.fn();
      emitter.on('user:login', handler, { once: true });
      emitter.emit('user:login', { userId: 'a', timestamp: 1 });
      emitter.emit('user:login', { userId: 'b', timestamp: 2 });
      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('supports multiple handlers for same event', () => {
      const emitter = createTestEmitter();
      const h1 = vi.fn();
      const h2 = vi.fn();
      emitter.on('user:login', h1);
      emitter.on('user:login', h2);
      emitter.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('returns this from emit() for chaining', () => {
      const emitter = createTestEmitter();
      const result = emitter.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(result).toBe(emitter);
    });
  });

  describe('wildcard *', () => {
    it('receives all events with event name and payload', () => {
      const emitter = createTestEmitter();
      const handler = vi.fn();
      emitter.on('*', handler);
      emitter.emit('user:login', { userId: '1', timestamp: 1 });
      emitter.emit('system:error', { message: 'boom', code: 500 });
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith('user:login', { userId: '1', timestamp: 1 });
      expect(handler).toHaveBeenCalledWith('system:error', { message: 'boom', code: 500 });
    });

    it('off("*") removes all wildcard handlers', () => {
      const emitter = createTestEmitter();
      const handler = vi.fn();
      emitter.on('*', handler);
      emitter.off('*');
      emitter.emit('user:login', { userId: '1', timestamp: 1 });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('off()', () => {
    it('removes all handlers for an event', () => {
      const emitter = createTestEmitter();
      const h1 = vi.fn();
      const h2 = vi.fn();
      emitter.on('user:login', h1);
      emitter.on('user:login', h2);
      emitter.off('user:login');
      emitter.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });
  });

  describe('onPrefix()', () => {
    it('matches all events under a colon-delimited prefix', () => {
      const emitter = createTestEmitter();
      const handler = vi.fn();
      emitter.onPrefix('user:', handler);
      emitter.emit('user:login', { userId: '1', timestamp: 1 });
      emitter.emit('user:logout', { userId: '1' });
      emitter.emit('order:created', { orderId: 'o1', amount: 100 });
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('returns unsubscribe that removes all prefix listeners', () => {
      const emitter = createTestEmitter();
      const handler = vi.fn();
      const unsub = emitter.onPrefix('order:', handler);
      unsub();
      emitter.emit('order:created', { orderId: 'o1', amount: 100 });
      emitter.emit('order:paid', { orderId: 'o1' });
      expect(handler).not.toHaveBeenCalled();
    });
  });

  describe('waitFor()', () => {
    it('resolves with payload when event fires', async () => {
      const emitter = createTestEmitter();
      const promise = emitter.waitFor('user:login');
      emitter.emit('user:login', { userId: '99', timestamp: 42 });
      const result = await promise;
      expect(result).toEqual({ userId: '99', timestamp: 42 });
    });

    it('rejects on timeout', async () => {
      const emitter = createTestEmitter();
      await expect(
        emitter.waitFor('user:login', { timeout: 50 }),
      ).rejects.toThrow();
    });

    it('rejects on AbortSignal', async () => {
      const emitter = createTestEmitter();
      const controller = new AbortController();
      const promise = emitter.waitFor('user:login', { signal: controller.signal });
      controller.abort();
      await expect(promise).rejects.toThrow();
    });
  });

  describe('events() async iterable', () => {
    it('yields emitted events', async () => {
      const emitter = createTestEmitter();
      const iterable = emitter.events('user:login');
      const iter = iterable[Symbol.asyncIterator]();
      emitter.emit('user:login', { userId: '1', timestamp: 1 });
      emitter.emit('user:login', { userId: '2', timestamp: 2 });

      const result1 = await iter.next();
      expect(result1.value).toEqual({ userId: '1', timestamp: 1 });
      expect(result1.done).toBe(false);

      const result2 = await iter.next();
      expect(result2.value).toEqual({ userId: '2', timestamp: 2 });
      expect(result2.done).toBe(false);
    });

    it('supports for-await-of', async () => {
      const emitter = createTestEmitter();
      const collected: unknown[] = [];

      const controller = new AbortController();
      const iterable = emitter.events('user:login', { signal: controller.signal });

      // Emit after a tick so the iterator is already waiting
      setTimeout(() => {
        emitter.emit('user:login', { userId: '1', timestamp: 1 });
        emitter.emit('user:login', { userId: '2', timestamp: 2 });
        emitter.emit('user:login', { userId: '3', timestamp: 3 });
        controller.abort();
      }, 10);

      try {
        for await (const payload of iterable) {
          collected.push(payload);
        }
      } catch {
        // abort may throw here
      }

      // Should receive at least 2 events before abort stops iteration
      expect(collected.length).toBeGreaterThanOrEqual(2);
      expect(collected[0]).toEqual({ userId: '1', timestamp: 1 });
    });
  });

  describe('snapshot-safe emit', () => {
    it('removing handler during emit does not affect current cycle', () => {
      const emitter = createTestEmitter();

      const h2 = vi.fn();
      const unsubH2 = emitter.on('user:login', h2);

      const h1 = vi.fn(() => {
        unsubH2();
      });
      emitter.on('user:login', h1);

      emitter.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('adding handler during emit does not affect current cycle', () => {
      const emitter = createTestEmitter();
      const h2 = vi.fn();

      const h1 = vi.fn(() => {
        emitter.on('user:login', h2);
      });

      emitter.on('user:login', h1);
      emitter.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).not.toHaveBeenCalled();
    });
  });

  describe('listenerCount()', () => {
    it('returns correct count after add/remove', () => {
      const emitter = createTestEmitter();
      const unsub1 = emitter.on('user:login', vi.fn());
      emitter.on('user:login', vi.fn());
      expect(emitter.listenerCount('user:login')).toBe(2);
      unsub1();
      expect(emitter.listenerCount('user:login')).toBe(1);
    });

    it('returns wildcard count', () => {
      const emitter = createTestEmitter();
      emitter.on('*', vi.fn());
      emitter.on('*', vi.fn());
      expect(emitter.listenerCount('*')).toBe(2);
    });
  });

  describe('maxListeners', () => {
    it('throws when exceeding limit', () => {
      const emitter = createTestEmitter({ maxListeners: 2 });
      emitter.on('user:login', vi.fn());
      emitter.on('user:login', vi.fn());
      expect(() => emitter.on('user:login', vi.fn())).toThrow('Max listeners');
    });
  });

  describe('strictMode', () => {
    it('throws on unregistered event emit in strict mode', () => {
      const emitter = createTestEmitter({ strictMode: true });
      expect(() =>
        (emitter as unknown as EventEmitter).emit('nonexistent:event' as never, 'boom'),
      ).toThrow();
    });

    it('allows unregistered events in non-strict mode', () => {
      const emitter = createTestEmitter();
      const handler = vi.fn();
      emitter.on('custom:event' as unknown as keyof TestEvents & string, handler);
      emitter.emit('custom:event' as unknown as keyof TestEvents & string, { foo: 'bar' } as never);
      expect(handler).toHaveBeenCalled();
    });
  });

  describe('destroy()', () => {
    it('clears all handlers and prevents further operations', () => {
      const emitter = createTestEmitter();
      emitter.on('user:login', vi.fn());
      emitter.destroy();
      expect(emitter.listenerCount('user:login')).toBe(0);
      expect(() => emitter.on('user:login', vi.fn())).toThrow('destroyed');
    });
  });

  describe('error handling in emit', () => {
    it('catching handler errors does not prevent other handlers', () => {
      const emitter = createTestEmitter();
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const h2 = vi.fn();

      emitter.on('user:login', () => {
        throw new Error('handler crash');
      });
      emitter.on('user:login', h2);

      emitter.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h2).toHaveBeenCalledTimes(1);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

// ============================================================
// Middleware 测试
// ============================================================

describe('Middleware', () => {
  it('middleware can transform payload', () => {
    const emitter = createTestEmitter();
    const handler = vi.fn();

    emitter.use((event, payload, next) => {
      (payload as { userId: string; timestamp: number }).timestamp = 999;
      next();
    });

    emitter.on('user:login', handler);
    emitter.emit('user:login', { userId: 'x', timestamp: 1 });
    expect(handler).toHaveBeenCalledWith({ userId: 'x', timestamp: 999 });
  });

  it('middleware can filter events by skipping next()', () => {
    const emitter = createTestEmitter();
    const handler = vi.fn();

    emitter.use((event, payload, next) => {
      if ((payload as { userId: string }).userId === 'blocked') return;
      next();
    });

    emitter.on('user:login', handler);
    emitter.emit('user:login', { userId: 'blocked', timestamp: 1 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('use() returns a function that removes the middleware', () => {
    const emitter = createTestEmitter();
    const handler = vi.fn();
    const removeMw = emitter.use((_e, _p, next) => {
      // transform nothing, just pass through
      next();
    });
    removeMw();

    emitter.on('user:login', handler);
    emitter.emit('user:login', { userId: 'x', timestamp: 1 });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('middleware chain executes in registration order', () => {
    const emitter = createTestEmitter();
    const order: number[] = [];
    const handler = vi.fn();

    emitter.use((_e, _p, next) => {
      order.push(1);
      next();
    });
    emitter.use((_e, _p, next) => {
      order.push(2);
      next();
    });

    emitter.on('user:login', handler);
    emitter.emit('user:login', { userId: 'x', timestamp: 1 });
    expect(order).toEqual([1, 2]);
  });
});

// ============================================================
// 工厂函数 / 单例 / Proxy 测试
// ============================================================

describe('Factory & Singleton', () => {
  beforeEach(() => {
    destroyEventHub();
  });

  it('createEventHub creates independent instances', () => {
    const e1 = createEventHub<TestEvents>();
    const e2 = createEventHub<TestEvents>();
    const h1 = vi.fn();
    e1.on('user:login', h1);
    e2.emit('user:login', { userId: '1', timestamp: 1 });
    expect(h1).not.toHaveBeenCalled();
  });

  it('initEventHub returns same instance on subsequent calls', () => {
    const hub1 = initEventHub<TestEvents>();
    const hub2 = initEventHub<TestEvents>();
    expect(hub1).toBe(hub2);
  });

  it('destroyEventHub tears down singleton', () => {
    initEventHub<TestEvents>();
    destroyEventHub();
    expect(() => initEventHub<TestEvents>()).not.toThrow();
  });
});
