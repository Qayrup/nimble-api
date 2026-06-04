import { describe, it, expect, vi } from 'vitest';
import { createEventHub } from '../index';

interface TestEvents {
  'user:login': { userId: string; timestamp: number };
  'user:logout': { userId: string };
  'order:created': { orderId: string; amount: number };
  'system:error': { message: string; code: number };
}

function createTestHub() {
  return createEventHub<TestEvents>();
}

// ============================================================
// on() + emit()
// ============================================================

describe('EventHub core', () => {
  describe('on() + emit()', () => {
    it('registers and invokes handler with correct payload', async () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.on('user:login', handler);
      hub.emit('user:login', { userId: '123', timestamp: 1000 });
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ userId: '123', timestamp: 1000 });
    });

    it('on() returns unsubscribe function', async () => {
      const hub = createTestHub();
      const handler = vi.fn();
      const unsub = hub.on('user:login', handler);
      unsub();
      hub.emit('user:login', { userId: '123', timestamp: 1000 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('supports AbortSignal for auto-unsubscribe', async () => {
      const hub = createTestHub();
      const handler = vi.fn();
      const controller = new AbortController();
      hub.on('user:login', handler, { signal: controller.signal });
      controller.abort();
      hub.emit('user:login', { userId: '123', timestamp: 1000 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('supports multiple handlers for same event', async () => {
      const hub = createTestHub();
      const h1 = vi.fn();
      const h2 = vi.fn();
      hub.on('user:login', h1);
      hub.on('user:login', h2);
      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================
  // onAny()
  // ============================================================

  describe('onAny()', () => {
    it('receives all events with event name and payload', async () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.onAny(handler);
      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('system:error', { message: 'boom', code: 500 });
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith('user:login', { userId: '1', timestamp: 1 });
      expect(handler).toHaveBeenCalledWith('system:error', { message: 'boom', code: 500 });
    });
  });

  // ============================================================
  // once()
  // ============================================================

  describe('once()', () => {
    it('resolves with payload when event fires', async () => {
      const hub = createTestHub();
      const promise = hub.once('user:login');
      hub.emit('user:login', { userId: '99', timestamp: 42 });
      const result = await promise;
      expect(result).toEqual({ userId: '99', timestamp: 42 });
    });

    it('rejects on timeout', async () => {
      const hub = createTestHub();
      await expect(
        hub.once('user:login', { timeout: 50 }),
      ).rejects.toThrow();
    });

    it('rejects on AbortSignal', async () => {
      const hub = createTestHub();
      const controller = new AbortController();
      const promise = hub.once('user:login', { signal: controller.signal });
      controller.abort();
      await expect(promise).rejects.toThrow();
    });
  });

  // ============================================================
  // off() / offAll()
  // ============================================================

  describe('off() / offAll()', () => {
    it('off(event, handler) removes specific handler', async () => {
      const hub = createTestHub();
      const h1 = vi.fn();
      const h2 = vi.fn();
      hub.on('user:login', h1);
      hub.on('user:login', h2);
      hub.off('user:login', h1);
      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h1).not.toHaveBeenCalled();
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('offAll(event) removes all handlers for an event', async () => {
      const hub = createTestHub();
      const h1 = vi.fn();
      const h2 = vi.fn();
      hub.on('user:login', h1);
      hub.on('user:login', h2);
      hub.offAll('user:login');
      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h1).not.toHaveBeenCalled();
      expect(h2).not.toHaveBeenCalled();
    });

    it('offAll() removes all handlers', async () => {
      const hub = createTestHub();
      const h1 = vi.fn();
      hub.on('user:login', h1);
      hub.onAny(vi.fn());
      hub.offAll();
      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h1).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // emitSerial()
  // ============================================================

  describe('emitSerial()', () => {
    it('executes handlers sequentially', async () => {
      const hub = createTestHub();
      const order: number[] = [];

      hub.on('user:login', async () => {
        order.push(1);
        await new Promise(r => setTimeout(r, 10));
      });
      hub.on('user:login', () => {
        order.push(2);
      });

      await hub.emitSerial('user:login', { userId: 'x', timestamp: 1 });
      expect(order).toEqual([1, 2]);
    });
  });

  // ============================================================
  // waitFor()
  // ============================================================

  describe('waitFor()', () => {
    it('resolves with payload when event fires', async () => {
      const hub = createTestHub();
      const promise = hub.waitFor('user:login');
      hub.emit('user:login', { userId: '99', timestamp: 42 });
      const result = await promise;
      expect(result).toEqual({ userId: '99', timestamp: 42 });
    });

    it('rejects on timeout', async () => {
      const hub = createTestHub();
      await expect(
        hub.waitFor('user:login', { timeout: 50 }),
      ).rejects.toThrow();
    });
  });

  // ============================================================
  // events() async iterable
  // ============================================================

  describe('events() async iterable', () => {
    it('yields emitted events', async () => {
      const hub = createTestHub();
      const iterable = hub.events('user:login');
      const iter = iterable[Symbol.asyncIterator]();
      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });

      const result1 = await iter.next();
      expect(result1.value).toEqual({ userId: '1', timestamp: 1 });
      expect(result1.done).toBe(false);

      const result2 = await iter.next();
      expect(result2.value).toEqual({ userId: '2', timestamp: 2 });
      expect(result2.done).toBe(false);
    });

    it('drops oldest events when buffer exceeds max', async () => {
      const hub = createTestHub();
      const iterable = hub.events('user:login', { bufferMax: 2 });
      const iter = iterable[Symbol.asyncIterator]();

      // Emit 3 events without consuming — should only keep last 2
      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });
      hub.emit('user:login', { userId: '3', timestamp: 3 });

      const r1 = await iter.next();
      expect(r1.value).toEqual({ userId: '2', timestamp: 2 }); // '1' was dropped
      const r2 = await iter.next();
      expect(r2.value).toEqual({ userId: '3', timestamp: 3 });
    });
  });

  // ============================================================
  // Snapshot-safe emit
  // ============================================================

  describe('snapshot-safe emit', () => {
    it('removing handler during emit does not affect current cycle', async () => {
      const hub = createTestHub();

      const h2 = vi.fn();
      const unsubH2 = hub.on('user:login', h2);

      const h1 = vi.fn(() => {
        unsubH2();
      });
      hub.on('user:login', h1);

      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('adding handler during emit does not affect current cycle', async () => {
      const hub = createTestHub();
      const h2 = vi.fn();

      const h1 = vi.fn(() => {
        hub.on('user:login', h2);
      });

      hub.on('user:login', h1);
      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(h1).toHaveBeenCalledTimes(1);
      expect(h2).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Query methods
  // ============================================================

  describe('listenerCount() / eventNames()', () => {
    it('returns correct count', () => {
      const hub = createTestHub();
      const unsub1 = hub.on('user:login', vi.fn());
      hub.on('user:login', vi.fn());
      expect(hub.listenerCount('user:login')).toBe(2);
      unsub1();
      expect(hub.listenerCount('user:login')).toBe(1);
    });

    it('returns total count without argument', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.on('order:created', vi.fn());
      hub.onAny(vi.fn());
      expect(hub.listenerCount()).toBe(3);
    });

    it('returns event names', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.on('order:created', vi.fn());
      expect(hub.eventNames()).toEqual(['user:login', 'order:created']);
    });

    it('returns 0 for destroyed instance', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.dispose();
      expect(hub.listenerCount('user:login')).toBe(0);
      expect(hub.eventNames()).toEqual([]);
    });
  });

  // ============================================================
  // Lifecycle
  // ============================================================

  describe('lifecycle', () => {
    it('clear() removes all handlers but instance stays usable', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.clear();
      expect(hub.listenerCount()).toBe(0);
      // Instance is still usable
      hub.on('user:login', vi.fn());
      expect(hub.listenerCount()).toBe(1);
    });

    it('dispose() prevents further operations', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.dispose();
      expect(hub.listenerCount('user:login')).toBe(0);
      expect(() => hub.on('user:login', vi.fn())).toThrow('destroyed');
      expect(() => hub.emit('user:login' as never, {} as never)).toThrow('destroyed');
    });
  });

  // ============================================================
  // Error handling in emit
  // ============================================================

  describe('error handling in emit', () => {
    it('collects errors as AggregateError', () => {
      const hub = createTestHub();
      const h2 = vi.fn();

      hub.on('user:login', () => {
        throw new Error('handler crash');
      });
      hub.on('user:login', h2);

      expect(() => {
        hub.emit('user:login', { userId: 'x', timestamp: 1 });
      }).toThrow(AggregateError);
      expect(h2).toHaveBeenCalledTimes(1);
    });

    it('emitSerial stops on first error', async () => {
      const hub = createTestHub();
      const h2 = vi.fn();

      hub.on('user:login', async () => {
        throw new Error('handler crash');
      });
      hub.on('user:login', h2);

      await expect(
        hub.emitSerial('user:login', { userId: 'x', timestamp: 1 }),
      ).rejects.toThrow('handler crash');
      expect(h2).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // Meta events
  // ============================================================

  describe('meta events', () => {
    it('emits listenerAdded when subscribing', () => {
      const hub = createTestHub();
      const meta = vi.fn();
      hub.on('listenerAdded' as keyof TestEvents & string, meta as never);
      hub.on('user:login', vi.fn());
      expect(meta).toHaveBeenCalledWith({ event: 'user:login' });
    });

    it('emits listenerRemoved when unsubscribing', () => {
      const hub = createTestHub();
      const meta = vi.fn();
      hub.on('listenerRemoved' as keyof TestEvents & string, meta as never);
      const unsub = hub.on('user:login', vi.fn());
      unsub();
      expect(meta).toHaveBeenCalledWith({ event: 'user:login' });
    });

    it('emits listenerRemoved for each event on offAll()', () => {
      const hub = createTestHub();
      const meta = vi.fn();
      hub.on('listenerRemoved' as keyof TestEvents & string, meta as never);
      hub.on('user:login', vi.fn());
      hub.on('order:created', vi.fn());
      hub.offAll();
      expect(meta).toHaveBeenCalledTimes(2);
      expect(meta).toHaveBeenCalledWith({ event: 'user:login' });
      expect(meta).toHaveBeenCalledWith({ event: 'order:created' });
    });

    it('emits meta events for onAny', () => {
      const hub = createTestHub();
      const added = vi.fn();
      const removed = vi.fn();
      hub.on('listenerAdded' as keyof TestEvents & string, added as never);
      hub.on('listenerRemoved' as keyof TestEvents & string, removed as never);

      const unsub = hub.onAny(vi.fn());
      expect(added).toHaveBeenCalledWith({ event: '*' });

      unsub();
      expect(removed).toHaveBeenCalledWith({ event: '*' });
    });
  });

  // ============================================================
  // Symbol.dispose
  // ============================================================

  describe('Symbol.dispose', () => {
    it('disposes the instance', () => {
      const hub = createTestHub();
      hub[Symbol.dispose]();
      expect(() => hub.on('user:login', vi.fn())).toThrow('destroyed');
    });
  });

  // ============================================================
  // onPattern() wildcard matching
  // ============================================================

  describe('onPattern() wildcard matching', () => {
    it('matches events with * wildcard', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.onPattern('user:*', handler);
      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:logout', { userId: '1' });
      expect(handler).toHaveBeenCalledTimes(2);
      expect(handler).toHaveBeenCalledWith('user:login', { userId: '1', timestamp: 1 });
      expect(handler).toHaveBeenCalledWith('user:logout', { userId: '1' });
    });

    it('does not match non-matching events', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.onPattern('user:*', handler);
      hub.emit('order:created', { orderId: 'x', amount: 1 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('matches events with ? wildcard', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.onPattern('order:???????', handler);
      hub.emit('order:created', { orderId: 'x', amount: 1 });
      hub.emit('order:updated', { orderId: 'y', amount: 2 });
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('unsubscribe removes wildcard handler', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      const unsub = hub.onPattern('user:*', handler);
      unsub();
      hub.emit('user:login', { userId: '1', timestamp: 1 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('emits meta events for wildcard subscriptions', () => {
      const hub = createTestHub();
      const added = vi.fn();
      const removed = vi.fn();
      hub.on('listenerAdded' as keyof TestEvents & string, added as never);
      hub.on('listenerRemoved' as keyof TestEvents & string, removed as never);

      const unsub = hub.onPattern('user:*', vi.fn() as never);
      expect(added).toHaveBeenCalledWith({ event: 'user:*' });

      unsub();
      expect(removed).toHaveBeenCalledWith({ event: 'user:*' });
    });
  });

  // ============================================================
  // listeners()
  // ============================================================

  describe('listeners()', () => {
    it('returns handlers for a specific event', () => {
      const hub = createTestHub();
      const h1 = vi.fn();
      const h2 = vi.fn();
      hub.on('user:login', h1);
      hub.on('user:login', h2);
      hub.on('order:created', vi.fn());

      const result = hub.listeners('user:login');
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(h1);
      expect(result[1]).toBe(h2);
    });

    it('includes matching wildcard handlers for a specific event', () => {
      const hub = createTestHub();
      const exact = vi.fn();
      const wc = vi.fn();
      hub.on('user:login', exact);
      hub.onPattern('user:*', wc as never);

      const result = hub.listeners('user:login');
      expect(result).toHaveLength(2);
      expect(result[0]).toBe(exact);
    });

    it('returns all handlers when called without argument', () => {
      const hub = createTestHub();
      const h1 = vi.fn();
      const h2 = vi.fn();
      hub.on('user:login', h1);
      hub.onPattern('system:*', h2 as never);
      hub.onAny(vi.fn());

      expect(hub.listeners()).toHaveLength(3);
    });

    it('returns empty array for destroyed instance', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.dispose();
      expect(hub.listeners('user:login')).toEqual([]);
      expect(hub.listeners()).toEqual([]);
    });
  });

  // ============================================================
  // prependListener()
  // ============================================================

  describe('prependListener()', () => {
    it('fires prepended handler before normally registered handlers', () => {
      const hub = createTestHub();
      const order: number[] = [];

      hub.on('user:login', () => { order.push(1); });
      hub.prependListener('user:login', () => { order.push(0); });

      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(order).toEqual([0, 1]);
    });

    it('supports AbortSignal for auto-unsubscribe', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      const controller = new AbortController();
      hub.prependListener('user:login', handler, { signal: controller.signal });
      controller.abort();
      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('emitSerial respects prepend order', async () => {
      const hub = createTestHub();
      const order: number[] = [];

      hub.on('user:login', () => { order.push(2); });
      hub.prependListener('user:login', () => { order.push(1); });

      await hub.emitSerial('user:login', { userId: 'x', timestamp: 1 });
      expect(order).toEqual([1, 2]);
    });
  });

  // ============================================================
  // setMaxListeners()
  // ============================================================

  describe('setMaxListeners()', () => {
    it('warns when listener count exceeds max', () => {
      const hub = createTestHub();
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      hub.setMaxListeners(2);

      hub.on('user:login', vi.fn());
      hub.on('user:login', vi.fn());
      expect(spy).not.toHaveBeenCalled();

      hub.on('user:login', vi.fn()); // 3rd triggers warning
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][0]).toContain('MaxListenersExceededWarning');

      spy.mockRestore();
    });

    it('warns only once per event', () => {
      const hub = createTestHub();
      const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      hub.setMaxListeners(1);

      hub.on('user:login', vi.fn());
      hub.on('user:login', vi.fn()); // warn
      hub.on('user:login', vi.fn()); // no warn
      expect(spy).toHaveBeenCalledTimes(1);

      spy.mockRestore();
    });

    it('getMaxListeners returns current limit', () => {
      const hub = createTestHub();
      expect(hub.getMaxListeners()).toBe(Infinity);
      hub.setMaxListeners(10);
      expect(hub.getMaxListeners()).toBe(10);
    });
  });

  // ============================================================
  // once() filter
  // ============================================================

  describe('once() with filter', () => {
    it('resolves only when filter returns true', async () => {
      const hub = createTestHub();
      const promise = hub.once('user:login', {
        filter: (p) => p.userId === 'target',
      });

      hub.emit('user:login', { userId: 'wrong', timestamp: 1 });
      hub.emit('user:login', { userId: 'target', timestamp: 2 });

      const result = await promise;
      expect(result.userId).toBe('target');
    });

    it('never resolves if filter never matches', async () => {
      const hub = createTestHub();
      const promise = hub.once('user:login', {
        timeout: 50,
        filter: () => false,
      });

      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      await expect(promise).rejects.toThrow();
    });
  });

  // ============================================================
  // listenerCount + eventNames with wildcards
  // ============================================================

  describe('listenerCount / eventNames with wildcards', () => {
    it('listenerCount includes matching wildcard handlers', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.onPattern('user:*', vi.fn() as never);
      hub.onPattern('order:*', vi.fn() as never);

      expect(hub.listenerCount('user:login')).toBe(2); // exact + user:*
      expect(hub.listenerCount('order:created')).toBe(1); // only order:*
    });

    it('eventNames includes wildcard patterns', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.onPattern('system:*', vi.fn() as never);

      const names = hub.eventNames();
      expect(names).toContain('user:login');
      expect(names).toContain('system:*');
    });
  });

  // ============================================================
  // ** multi-level wildcard
  // ============================================================

  describe('** multi-level wildcard', () => {
    it('user:** matches user:login and user:login:success', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.onPattern('user:**', handler);

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login:success', { userId: '2', timestamp: 2 });
      hub.emit('order:created', { orderId: 'x', amount: 1 });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('user:* does NOT match user:login:success (single segment only)', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.onPattern('user:*', handler);

      hub.emit('user:login:success', { userId: '1', timestamp: 1 });

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // emitAsync()
  // ============================================================

  describe('emitAsync()', () => {
    it('returns allSettled results from handlers', async () => {
      const hub = createTestHub();
      hub.on('user:login', () => 'result-1');
      hub.on('user:login', () => 'result-2');

      const results = await hub.emitAsync('user:login', { userId: '1', timestamp: 1 });
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('fulfilled');
      expect(results[1].status).toBe('fulfilled');
    });

    it('collects rejected handlers without stopping others', async () => {
      const hub = createTestHub();
      const h2 = vi.fn();
      hub.on('user:login', () => { throw new Error('boom'); });
      hub.on('user:login', h2);

      const results = await hub.emitAsync('user:login', { userId: '1', timestamp: 1 });
      expect(h2).toHaveBeenCalledTimes(1);
      expect(results).toHaveLength(2);
      expect(results[0].status).toBe('rejected');
      expect(results[1].status).toBe('fulfilled');
    });

    it('includes wildcard handler results', async () => {
      const hub = createTestHub();
      hub.on('user:login', () => 'exact');
      hub.onPattern('user:*', () => 'wildcard' as never);

      const results = await hub.emitAsync('user:login', { userId: '1', timestamp: 1 });
      expect(results).toHaveLength(2);
    });
  });

  // ============================================================
  // many()
  // ============================================================

  describe('many()', () => {
    it('auto-unsubscribes after N invocations', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.many('user:login', 2, handler);

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });
      hub.emit('user:login', { userId: '3', timestamp: 3 });

      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('supports external unsubscribe before N', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      const unsub = hub.many('user:login', 5, handler);

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      unsub();
      hub.emit('user:login', { userId: '2', timestamp: 2 });

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits listenerRemoved after Nth invocation', () => {
      const hub = createTestHub();
      const meta = vi.fn();
      hub.on('listenerRemoved' as keyof TestEvents & string, meta as never);

      hub.many('user:login', 1, vi.fn());
      hub.emit('user:login', { userId: '1', timestamp: 1 });
      expect(meta).toHaveBeenCalledWith({ event: 'user:login' });
    });
  });
});
