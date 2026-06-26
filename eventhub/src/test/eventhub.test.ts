import { describe, it, expect, vi } from 'vitest';
import { createEventHub } from '../index';

interface TestEvents {
  'user:login': { userId: string; timestamp: number };
  'user:login:success': { userId: string; timestamp: number };
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
  // hasListeners()
  // ============================================================

  describe('hasListeners()', () => {
    it('returns false when no listeners', () => {
      const hub = createTestHub();
      expect(hub.hasListeners()).toBe(false);
      expect(hub.hasListeners('user:login')).toBe(false);
    });

    it('returns true when direct handler exists for event', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      expect(hub.hasListeners('user:login')).toBe(true);
      expect(hub.hasListeners('order:created')).toBe(false);
    });

    it('returns true when wildcard pattern matches event', () => {
      const hub = createTestHub();
      hub.onPattern('user:*', vi.fn() as never);
      expect(hub.hasListeners('user:login')).toBe(true);
      expect(hub.hasListeners('order:created')).toBe(false);
    });

    it('returns true when onAny handler exists', () => {
      const hub = createTestHub();
      hub.onAny(vi.fn() as never);
      expect(hub.hasListeners('user:login')).toBe(true);
      expect(hub.hasListeners('order:created')).toBe(true);
    });

    it('returns true (no arg) when any listener exists', () => {
      const hub = createTestHub();
      expect(hub.hasListeners()).toBe(false);
      hub.onAny(vi.fn() as never);
      expect(hub.hasListeners()).toBe(true);
    });

    it('returns false after offAll()', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.onPattern('user:*', vi.fn() as never);
      hub.onAny(vi.fn() as never);
      hub.offAll();
      expect(hub.hasListeners()).toBe(false);
    });

    it('returns false for destroyed instance', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.dispose();
      expect(hub.hasListeners('user:login')).toBe(false);
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
  // meta events — beforeListenerAdd / beforeListenerRemove
  // ============================================================

  describe('beforeListenerAdd', () => {
    it('fires before the handler is added to listeners()', () => {
      const hub = createTestHub();
      const before = vi.fn();
      hub.on('beforeListenerAdd' as keyof TestEvents & string, before as never);

      const handler = vi.fn();
      hub.on('user:login', handler);

      expect(before).toHaveBeenCalledWith({ event: 'user:login', handler });
      // handler should be in listeners() after on() returns
      expect(hub.listeners('user:login')).toContain(handler);
    });

    it('receives event name and handler reference', () => {
      const hub = createTestHub();
      const before = vi.fn();
      hub.on('beforeListenerAdd' as keyof TestEvents & string, before as never);

      const handler = vi.fn();
      hub.on('user:login', handler);

      const payload = before.mock.calls[0][0];
      expect(payload.event).toBe('user:login');
      expect(payload.handler).toBe(handler);
    });

    it('throwing in beforeListenerAdd prevents the handler from being added', () => {
      const hub = createTestHub();
      hub.on('beforeListenerAdd' as keyof TestEvents & string, () => {
        throw new Error('blocked');
      });

      expect(() => hub.on('user:login', vi.fn())).toThrow('blocked');
      expect(hub.listenerCount('user:login')).toBe(0);
    });

    it('fires for onAny subscriptions', () => {
      const hub = createTestHub();
      const before = vi.fn();
      hub.on('beforeListenerAdd' as keyof TestEvents & string, before as never);

      const handler = vi.fn();
      hub.onAny(handler as never);

      expect(before).toHaveBeenCalledWith({ event: '*', handler });
    });

    it('fires for onPattern subscriptions', () => {
      const hub = createTestHub();
      const before = vi.fn();
      hub.on('beforeListenerAdd' as keyof TestEvents & string, before as never);

      const handler = vi.fn();
      hub.onPattern('user:*', handler as never);

      expect(before).toHaveBeenCalledWith({ event: 'user:*', handler });
    });

    it('fires for prependListener subscriptions', () => {
      const hub = createTestHub();
      const before = vi.fn();
      hub.on('beforeListenerAdd' as keyof TestEvents & string, before as never);

      const handler = vi.fn();
      hub.prependListener('user:login', handler);

      expect(before).toHaveBeenCalledWith({ event: 'user:login', handler });
    });

    it('fires for many() subscriptions', () => {
      const hub = createTestHub();
      const before = vi.fn();
      hub.on('beforeListenerAdd' as keyof TestEvents & string, before as never);

      const handler = vi.fn();
      hub.many('user:login', 3, handler);

      expect(before).toHaveBeenCalledWith({ event: 'user:login', handler });
    });

    it('does NOT fire when subscribing to beforeListenerAdd itself (#emittingMeta guard)', () => {
      const hub = createTestHub();
      const before = vi.fn();
      // Subscribing to beforeListenerAdd should not trigger beforeListenerAdd
      hub.on('beforeListenerAdd' as keyof TestEvents & string, before as never);
      expect(before).not.toHaveBeenCalled();
    });
  });

  describe('beforeListenerRemove', () => {
    it('fires before the handler is removed from listeners()', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      const unsub = hub.on('user:login', handler);

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      unsub();

      expect(before).toHaveBeenCalledWith({ event: 'user:login', handler });
      expect(hub.listeners('user:login')).not.toContain(handler);
    });

    it('throwing in beforeListenerRemove prevents the handler from being removed', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      const unsub = hub.on('user:login', handler);

      hub.on('beforeListenerRemove' as keyof TestEvents & string, () => {
        throw new Error('blocked');
      });

      expect(() => unsub()).toThrow('blocked');
      expect(hub.listeners('user:login')).toContain(handler);
    });

    it('fires for onAny unsubscription', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      const unsub = hub.onAny(handler as never);

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      unsub();

      expect(before).toHaveBeenCalledWith({ event: '*', handler });
    });

    it('fires for onPattern unsubscription', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      const unsub = hub.onPattern('user:*', handler as never);

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      unsub();

      expect(before).toHaveBeenCalledWith({ event: 'user:*', handler });
    });

    it('fires when many() auto-removes after N calls', () => {
      const hub = createTestHub();
      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      const handler = vi.fn();
      hub.many('user:login', 2, handler);

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      expect(before).not.toHaveBeenCalled(); // not yet

      hub.emit('user:login', { userId: '2', timestamp: 2 });
      expect(before).toHaveBeenCalledTimes(1);
      expect(before.mock.calls[0][0].handler).toBe(handler);
    });

    it('fires beforeListenerRemove when AbortSignal aborts', () => {
      const controller = new AbortController();
      const hub = createTestHub();
      const handler = vi.fn();
      hub.on('user:login', handler, { signal: controller.signal });

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      controller.abort();

      expect(before).toHaveBeenCalledWith({ event: 'user:login', handler });
      expect(hub.listeners('user:login')).not.toContain(handler);
    });

    it('does NOT fire when subscribing to beforeListenerRemove itself (#emittingMeta guard)', () => {
      const hub = createTestHub();
      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);
      expect(before).not.toHaveBeenCalled();
    });
  });

  describe('batch removal (beforeListenerRemove without handler)', () => {
    it('offAll(event) triggers beforeListenerRemove without handler field', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.on('user:login', vi.fn()); // 2 handlers

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      hub.offAll('user:login');

      expect(before).toHaveBeenCalledTimes(1);
      expect(before).toHaveBeenCalledWith({ event: 'user:login' });
      // handler field should be undefined for batch removal
      expect(before.mock.calls[0][0].handler).toBeUndefined();
      expect(hub.listeners('user:login')).toHaveLength(0);
    });

    it('offAll() triggers beforeListenerRemove per event, without handler', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.on('order:created', vi.fn());

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      hub.offAll();

      expect(before).toHaveBeenCalledTimes(2);
      expect(before).toHaveBeenCalledWith({ event: 'user:login' });
      expect(before).toHaveBeenCalledWith({ event: 'order:created' });
      // handler should be undefined for batch
      for (const call of before.mock.calls) {
        expect(call[0].handler).toBeUndefined();
      }
    });

    it('offAll() skips meta event handlers themselves', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      hub.offAll();

      // Should only report 'user:login', not 'beforeListenerRemove'
      expect(before).toHaveBeenCalledTimes(1);
      expect(before).toHaveBeenCalledWith({ event: 'user:login' });
    });
  });

  describe('clear() and dispose() do NOT trigger meta events', () => {
    it('clear() does not trigger beforeListenerRemove or listenerRemoved', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());

      const before = vi.fn();
      const after = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);
      hub.on('listenerRemoved' as keyof TestEvents & string, after as never);

      hub.clear();

      expect(before).not.toHaveBeenCalled();
      expect(after).not.toHaveBeenCalled();
      expect(hub.listeners('user:login')).toHaveLength(0);
    });

    it('dispose() does not trigger beforeListenerRemove or listenerRemoved', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());

      const before = vi.fn();
      const after = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);
      hub.on('listenerRemoved' as keyof TestEvents & string, after as never);

      hub.dispose();

      expect(before).not.toHaveBeenCalled();
      expect(after).not.toHaveBeenCalled();
    });
  });

  // ============================================================
  // metaMode: 'full' — 批量移除逐条带 handler
  // ============================================================

  describe('metaMode: full', () => {
    function createFullHub() {
      return createEventHub<TestEvents>({ metaMode: 'full' });
    }

    it('offAll(event) triggers per-handler beforeListenerRemove with handler', () => {
      const hub = createFullHub();
      const h1 = vi.fn();
      const h2 = vi.fn();
      hub.on('user:login', h1);
      hub.on('user:login', h2);

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      hub.offAll('user:login');

      expect(before).toHaveBeenCalledTimes(2);
      expect(before).toHaveBeenCalledWith({ event: 'user:login', handler: h1 });
      expect(before).toHaveBeenCalledWith({ event: 'user:login', handler: h2 });
    });

    it('offAll() triggers per-handler beforeListenerRemove for each direct handler', () => {
      const hub = createFullHub();
      const h1 = vi.fn();
      const h2 = vi.fn();
      hub.on('user:login', h1);
      hub.on('order:created', h2);

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      hub.offAll();

      expect(before).toHaveBeenCalledTimes(2);
      // Each with handler
      expect(before.mock.calls[0][0].handler).toBe(h1);
      expect(before.mock.calls[1][0].handler).toBe(h2);
    });

    it('single remove (off/unsub) still includes handler', () => {
      const hub = createFullHub();
      const handler = vi.fn();
      const unsub = hub.on('user:login', handler);

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      unsub();

      expect(before).toHaveBeenCalledWith({ event: 'user:login', handler });
    });
  });

  // ============================================================
  // metaMode: 'lean' — 单次和批量都只带 event，不带 handler
  // ============================================================

  describe('metaMode: lean', () => {
    function createLeanHub() {
      return createEventHub<TestEvents>({ metaMode: 'lean' });
    }

    it('single remove emits beforeListenerRemove without handler', () => {
      const hub = createLeanHub();
      const handler = vi.fn();
      const unsub = hub.on('user:login', handler);

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      unsub();

      expect(before).toHaveBeenCalledTimes(1);
      expect(before).toHaveBeenCalledWith({ event: 'user:login' });
      expect(before.mock.calls[0][0].handler).toBeUndefined();
    });

    it('offAll(event) emits beforeListenerRemove without handler', () => {
      const hub = createLeanHub();
      hub.on('user:login', vi.fn());
      hub.on('user:login', vi.fn());

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      hub.offAll('user:login');

      expect(before).toHaveBeenCalledTimes(1);
      expect(before).toHaveBeenCalledWith({ event: 'user:login' });
      expect(before.mock.calls[0][0].handler).toBeUndefined();
    });

    it('offAll() emits beforeListenerRemove per event, without handler', () => {
      const hub = createLeanHub();
      hub.on('user:login', vi.fn());
      hub.on('order:created', vi.fn());

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      hub.offAll();

      expect(before).toHaveBeenCalledTimes(2);
      for (const call of before.mock.calls) {
        expect(call[0].handler).toBeUndefined();
      }
    });

    it('listenerRemoved still fires after removal', () => {
      const hub = createLeanHub();
      const handler = vi.fn();
      const unsub = hub.on('user:login', handler);

      const after = vi.fn();
      hub.on('listenerRemoved' as keyof TestEvents & string, after as never);

      unsub();

      expect(after).toHaveBeenCalledWith({ event: 'user:login' });
    });
  });

  // ============================================================
  // metaMode: 'simple' — 移除不触发任何 meta 事件
  // ============================================================

  describe('metaMode: simple', () => {
    function createSimpleHub() {
      return createEventHub<TestEvents>({ metaMode: 'simple' });
    }

    it('single remove does NOT trigger beforeListenerRemove or listenerRemoved', () => {
      const hub = createSimpleHub();
      const handler = vi.fn();
      const unsub = hub.on('user:login', handler);

      const before = vi.fn();
      const after = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);
      hub.on('listenerRemoved' as keyof TestEvents & string, after as never);

      unsub();

      expect(before).not.toHaveBeenCalled();
      expect(after).not.toHaveBeenCalled();
    });

    it('offAll() does NOT trigger beforeListenerRemove or listenerRemoved', () => {
      const hub = createSimpleHub();
      hub.on('user:login', vi.fn());
      hub.on('order:created', vi.fn());

      const before = vi.fn();
      const after = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);
      hub.on('listenerRemoved' as keyof TestEvents & string, after as never);

      hub.offAll();

      expect(before).not.toHaveBeenCalled();
      expect(after).not.toHaveBeenCalled();
    });

    it('beforeListenerAdd and listenerAdded still fire (only removal is silent)', () => {
      const hub = createSimpleHub();
      const beforeAdd = vi.fn();
      const afterAdd = vi.fn();
      hub.on('beforeListenerAdd' as keyof TestEvents & string, beforeAdd as never);
      hub.on('listenerAdded' as keyof TestEvents & string, afterAdd as never);

      const handler = vi.fn();
      hub.on('user:login', handler);

      expect(beforeAdd).toHaveBeenCalledWith({ event: 'user:login', handler });
      expect(afterAdd).toHaveBeenCalledWith({ event: 'user:login' });
    });
  });

  // ============================================================
  // emitMode 错误策略
  // ============================================================

  describe('emitMode', () => {
    it('failFast — first error propagates immediately', () => {
      const hub = createEventHub<TestEvents>({ emitMode: 'failFast' });
      const calls: number[] = [];
      hub.on('user:login', () => { calls.push(1); throw new Error('boom'); });
      hub.on('user:login', () => { calls.push(2); });

      expect(() => hub.emit('user:login', { userId: 'x', timestamp: 1 })).toThrow('boom');
      // Second handler was never called
      expect(calls).toEqual([1]);
    });

    it('silent — handler errors are ignored', () => {
      const hub = createEventHub<TestEvents>({ emitMode: 'silent' });
      const calls: number[] = [];
      hub.on('user:login', () => { calls.push(1); throw new Error('boom'); });
      hub.on('user:login', () => { calls.push(2); });

      expect(() => hub.emit('user:login', { userId: 'x', timestamp: 1 })).not.toThrow();
      expect(calls).toEqual([1, 2]);
    });

    it('aggregate (default) — collects all errors into AggregateError', () => {
      const hub = createEventHub<TestEvents>({ emitMode: 'aggregate' });
      hub.on('user:login', () => { throw new Error('err1'); });
      hub.on('user:login', () => { throw new Error('err2'); });

      let caught: unknown;
      try { hub.emit('user:login', { userId: 'x', timestamp: 1 }); } catch (e) { caught = e; }

      expect(caught).toBeInstanceOf(AggregateError);
      expect((caught as AggregateError).errors).toHaveLength(2);
    });
  });

  // ============================================================
  // emitSafety
  // ============================================================

  describe('emitSafety', () => {
    it('safe (default) — handler removing itself does not affect current iteration', () => {
      const hub = createEventHub<TestEvents>({ emitSafety: 'safe' });
      const calls: number[] = [];
      hub.on('user:login', () => { calls.push(1); });
     const unsub2 = hub.on('user:login', () => { calls.push(2); unsub2(); });
      hub.on('user:login', () => { calls.push(3); });

      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(calls).toEqual([1, 2, 3]);
    });

    it('fast — handler removing itself skips the next handler', () => {
      const hub = createEventHub<TestEvents>({ emitSafety: 'fast' });
      const calls: number[] = [];
      hub.on('user:login', () => { calls.push(1); });
      const unsub2 = hub.on('user:login', () => { calls.push(2); unsub2(); });
      hub.on('user:login', () => { calls.push(3); });

      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      // In fast mode, removing handler 2 shifts the array, handler 3 is skipped
      expect(calls).not.toEqual([1, 2, 3]);
    });

    it('fast with failFast — no snapshot, first error propagates', () => {
      const hub = createEventHub<TestEvents>({ emitSafety: 'fast', emitMode: 'failFast' });
      const calls: number[] = [];
      hub.on('user:login', () => { calls.push(1); throw new Error('boom'); });
      hub.on('user:login', () => { calls.push(2); });

      expect(() => hub.emit('user:login', { userId: 'x', timestamp: 1 })).toThrow('boom');
      expect(calls).toEqual([1]);
    });
  });

  // ============================================================
  // maxListenersAction
  // ============================================================

  describe('maxListenersAction', () => {
    it('throw — throws when listener count exceeds limit', () => {
      const hub = createEventHub<TestEvents>({
        maxListenersAction: 'throw',
      });
      hub.setMaxListeners(2);
      hub.on('user:login', vi.fn());
      hub.on('user:login', vi.fn());
      expect(() => hub.on('user:login', vi.fn())).toThrow('MaxListenersExceeded');
    });

    it('custom callback — calls user function with event and count', () => {
      const cb = vi.fn();
      const hub = createEventHub<TestEvents>({
        maxListenersAction: cb,
      });
      hub.setMaxListeners(1);
      hub.on('user:login', vi.fn());
      hub.on('user:login', vi.fn());

      expect(cb).toHaveBeenCalledWith('user:login', 2);
    });

    it('silent — no warning and no throw', () => {
      const spy = vi.spyOn(console, 'warn');
      const hub = createEventHub<TestEvents>({
        maxListenersAction: 'silent',
      });
      hub.setMaxListeners(1);
      hub.on('user:login', vi.fn());
      hub.on('user:login', vi.fn());

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });
  });

  // ============================================================
  // throttleEdge
  // ============================================================

  describe('throttleEdge', () => {
    it('leading — fires immediately, ignores subsequent calls within window', () => {
      vi.useFakeTimers();
      const hub = createTestHub();
      const handler = vi.fn();
      hub.on('user:login', handler, { throttle: 100, throttleEdge: 'leading' });

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      expect(handler).toHaveBeenCalledTimes(1);

      hub.emit('user:login', { userId: '2', timestamp: 2 });
      hub.emit('user:login', { userId: '3', timestamp: 3 });
      expect(handler).toHaveBeenCalledTimes(1); // still 1

      vi.advanceTimersByTime(150);
      hub.emit('user:login', { userId: '4', timestamp: 4 });
      expect(handler).toHaveBeenCalledTimes(2);
      vi.useRealTimers();
    });

    it('trailing — defers all calls to end of window, no leading fire', () => {
      vi.useFakeTimers();
      const hub = createTestHub();
      const handler = vi.fn();
      hub.on('user:login', handler, { throttle: 100, throttleEdge: 'trailing' });

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      expect(handler).toHaveBeenCalledTimes(0); // pure trailing: first call deferred

      hub.emit('user:login', { userId: '2', timestamp: 2 });
      expect(handler).toHaveBeenCalledTimes(0); // timer pending, args updated

      vi.advanceTimersByTime(150);
      expect(handler).toHaveBeenCalledTimes(1); // trailing fired with last args
      expect(handler).toHaveBeenCalledWith({ userId: '2', timestamp: 2 });
      vi.useRealTimers();
    });

    it('chain API — hub.throttle(ms, { edge }) passes through', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.throttle(100, { edge: 'leading' }).on('user:login', handler);

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });
      expect(handler).toHaveBeenCalledTimes(1); // still in window
    });
  });

  // ============================================================
  // events() bufferOverflow
  // ============================================================

  describe('events() bufferOverflow', () => {
    it('dropOldest (default) — oldest event evicted when buffer full', async () => {
      const hub = createTestHub();
      const iterable = hub.events('user:login', { bufferMax: 2 });
      const iter = iterable[Symbol.asyncIterator]();

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });
      hub.emit('user:login', { userId: '3', timestamp: 3 }); // '1' dropped

      const r1 = await iter.next();
      expect(r1.value!.userId).toBe('2');
      const r2 = await iter.next();
      expect(r2.value!.userId).toBe('3');
    });

    it('dropNewest — newest event discarded when buffer full', async () => {
      const hub = createTestHub();
      const iterable = hub.events('user:login', { bufferMax: 2, bufferOverflow: 'dropNewest' });
      const iter = iterable[Symbol.asyncIterator]();

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });
      hub.emit('user:login', { userId: '3', timestamp: 3 }); // '3' dropped

      const r1 = await iter.next();
      expect(r1.value!.userId).toBe('1');
      const r2 = await iter.next();
      expect(r2.value!.userId).toBe('2');
    });
  });

  // ============================================================
  // offAll(event, handler) — remove all matching
  // ============================================================

  describe('offAll(event, handler)', () => {
    it('removes all instances of a handler', () => {
      const hub = createTestHub();
      const h1 = vi.fn();
      const h2 = vi.fn();
      hub.on('user:login', h1);
      hub.on('user:login', h2);
      hub.on('user:login', h1); // same handler registered twice

      hub.offAll('user:login', h1);

      const remaining = hub.listeners('user:login');
      expect(remaining).toHaveLength(1);
      expect(remaining[0]).toBe(h2);
    });

    it('does not affect other events', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.on('user:login', handler);
      hub.on('order:created', handler);

      hub.offAll('user:login', handler);

      expect(hub.listeners('user:login')).toHaveLength(0);
      expect(hub.listeners('order:created')).toHaveLength(1);
    });

    it('triggers beforeListenerRemove for each removed handler', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.on('user:login', handler);
      hub.on('user:login', handler);

      const before = vi.fn();
      hub.on('beforeListenerRemove' as keyof TestEvents & string, before as never);

      hub.offAll('user:login', handler);

      expect(before).toHaveBeenCalledTimes(2);
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
      hub.emit("order:created", { orderId: 'y', amount: 2 });
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
  // rawListeners()
  // ============================================================

  describe('rawListeners()', () => {
    it('returns raw handler (with debounce/throttle wrapper) for event', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.on('user:login', handler, { throttle: 100 });

      const raw = hub.rawListeners('user:login');
      expect(raw).toHaveLength(1);
      // raw is the throttled wrapper, NOT the original handler
      expect(raw[0]).not.toBe(handler);
      // listeners() returns the original
      expect(hub.listeners('user:login')[0]).toBe(handler);
    });

    it('returns all raw handlers when called without args', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.on('order:created', vi.fn());
      hub.onAny(vi.fn() as never);

      expect(hub.rawListeners()).toHaveLength(3);
    });

    it('includes wildcard-matching handlers for specific event', () => {
      const hub = createTestHub();
      hub.onPattern('user:*', vi.fn() as never);

      expect(hub.rawListeners('user:login')).toHaveLength(1);
      expect(hub.rawListeners('order:created')).toHaveLength(0);
    });

    it('returns empty array for destroyed instance', () => {
      const hub = createTestHub();
      hub.on('user:login', vi.fn());
      hub.dispose();
      expect(hub.rawListeners()).toEqual([]);
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
  // prependOnceListener()
  // ============================================================

  describe('prependOnceListener()', () => {
    it('fires at most once and auto-unsubscribes', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.prependOnceListener('user:login', handler);

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ userId: '1', timestamp: 1 });
    });

    it('inserts at front — fires before other handlers', () => {
      const hub = createTestHub();
      const order: number[] = [];
      hub.on('user:login', () => order.push(2));
      hub.prependOnceListener('user:login', () => order.push(1));

      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(order).toEqual([1, 2]);

      // Second emit — prependOnceListener already removed
      hub.emit('user:login', { userId: 'y', timestamp: 2 });
      expect(order).toEqual([1, 2, 2]); // only the regular handler fires
    });

    it('supports AbortSignal', () => {
      const hub = createTestHub();
      const controller = new AbortController();
      const handler = vi.fn();
      hub.prependOnceListener('user:login', handler, { signal: controller.signal });
      controller.abort();

      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('returns unsubscribe that works before first fire', () => {
      const hub = createTestHub();
      const handler = vi.fn();
      const unsub = hub.prependOnceListener('user:login', handler);
      unsub();

      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(handler).not.toHaveBeenCalled();
    });

    it('emits meta events for add and remove', () => {
      const hub = createTestHub();
      const beforeAdd = vi.fn();
      const afterAdd = vi.fn();
      const beforeRemove = vi.fn();
      hub.on('beforeListenerAdd' as keyof TestEvents & string, beforeAdd as never);
      hub.on('listenerAdded' as keyof TestEvents & string, afterAdd as never);
      hub.on('beforeListenerRemove' as keyof TestEvents & string, beforeRemove as never);

      const handler = vi.fn();
      hub.prependOnceListener('user:login', handler);

      expect(beforeAdd).toHaveBeenCalledWith({ event: 'user:login', handler });
      expect(afterAdd).toHaveBeenCalledWith({ event: 'user:login' });

      hub.emit('user:login', { userId: 'x', timestamp: 1 });
      expect(beforeRemove).toHaveBeenCalledWith({ event: 'user:login', handler });
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
      hub.emit('user:login', { userId: '2', timestamp: 2 });
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

  // ============================================================
  // debounce / throttle
  // ============================================================

  describe('debounce', () => {
    it('delays handler until event stream settles (options)', async () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.on('user:login', handler, { debounce: 50 });

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });
      hub.emit('user:login', { userId: '3', timestamp: 3 });

      expect(handler).not.toHaveBeenCalled();
      await new Promise(r => setTimeout(r, 60));
      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith({ userId: '3', timestamp: 3 });
    });

    it('chain: hub.debounce(ms).on()', async () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.debounce(50).on('user:login', handler);

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });

      expect(handler).not.toHaveBeenCalled();
      await new Promise(r => setTimeout(r, 60));
      expect(handler).toHaveBeenCalledTimes(1);
    });
  });

  describe('throttle', () => {
    it('fires first call immediately, then throttles (options)', async () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.on('user:login', handler, { throttle: 100 });

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });

      expect(handler).toHaveBeenCalledTimes(1);
      await new Promise(r => setTimeout(r, 110));
      hub.emit('user:login', { userId: '3', timestamp: 3 });
      expect(handler).toHaveBeenCalledTimes(2);
    });

    it('chain: hub.throttle(ms).on()', async () => {
      const hub = createTestHub();
      const handler = vi.fn();
      hub.throttle(100).on('user:login', handler);

      hub.emit('user:login', { userId: '1', timestamp: 1 });
      hub.emit('user:login', { userId: '2', timestamp: 2 });

      expect(handler).toHaveBeenCalledTimes(1);
    });
  });
});
