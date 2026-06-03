import { describe, it, expect, vi } from 'vitest';
import { createEventHub } from '../index';
import type { EventMap } from '../core/types';

interface TestEvents extends EventMap {
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
});
