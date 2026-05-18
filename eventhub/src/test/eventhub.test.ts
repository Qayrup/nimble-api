import { describe, it, expect, beforeEach } from 'vitest';
import { createAdvancedEvent } from '../index';
import type { AdvancedEventEmitter } from '../esm/index';

describe('createAdvancedEvent', () => {
  let bus: AdvancedEventEmitter;

  beforeEach(() => {
    bus = createAdvancedEvent({}, { enabled: false });
  });

  it('should create an event bus instance', () => {
    expect(bus).toBeDefined();
    expect(typeof bus.on).toBe('function');
    expect(typeof bus.emit).toBe('function');
    expect(typeof bus.off).toBe('function');
  });

  it('should generate EVENTKEY with BUILT errors', () => {
    const keys = bus.getEvenKey();
    expect(keys).toHaveProperty('BUILT');
    expect((keys as Record<string, unknown>).BUILT).toHaveProperty('ERROR');
  });

  it('should register and emit events', () => {
    let received = '';
    bus.onKey('test.event', (msg: string) => {
      received = msg;
    });
    bus.emit('test.event', 'hello');
    expect(received).toBe('hello');
  });

  it('should respect maxListeners limit', () => {
    bus.setListenerLimit(2);
    bus.onKey('test.limit', () => {});
    bus.onKey('test.limit', () => {});
    expect(() => {
      // The third handler should trigger deBug which throws
      bus.onKey('test.limit', () => {});
    }).toThrow();
  });

  it('should detect duplicate handlers', () => {
    const handler = () => {};
    bus.onKey('test.dup', handler);
    expect(() => {
      bus.onKey('test.dup', handler);
    }).toThrow();
  });

  it('should remove handlers via off', () => {
    let count = 0;
    const handler = () => {
      count++;
    };
    bus.onKey('test.off', handler);
    bus.emit('test.off');
    expect(count).toBe(1);

    bus.off('test.off', handler);
    bus.emit('test.off');
    expect(count).toBe(1);
  });

  it('should support debounce mode', async () => {
    const results: number[] = [];
    bus.setListenerLimit(10);
    bus.onKey('test.debounce', (val: number) => {
      results.push(val);
    }, { mode: 'debounce', timing: 50 });

    bus.emit('test.debounce', 1);
    bus.emit('test.debounce', 2);
    bus.emit('test.debounce', 3);

    await new Promise((r) => setTimeout(r, 100));

    // Debounce should only fire the last one
    expect(results).toEqual([3]);
  });

  it('should support once option', () => {
    let count = 0;
    bus.onKey('test.once', () => {
      count++;
    }, { once: true });

    bus.emit('test.once');
    bus.emit('test.once');
    expect(count).toBe(1);
  });

  it('should clean up on destroy', () => {
    bus.onKey('test.destroy', () => {});
    bus.destroy();
    // After destroy, EVENTKEY should be empty
    expect(bus.EVENTKEY).toEqual({});
  });
});
