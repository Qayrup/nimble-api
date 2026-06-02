import { describe, it, expect, beforeEach } from 'vitest';
import { createAdvancedEvent } from '../index';
import type { AdvancedEventEmitter } from '../esm/index';
import { EnhancedPathPrefixMatcher } from '../esm/PathPrefixMatcher';
import { safeObjectsToStrings, stringsToObject } from '../esm/objectTransformation';

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
    const keys = bus.getEventKey();
    expect(keys).toHaveProperty('BUILT');
    expect((keys as Record<string, unknown>).BUILT).toHaveProperty('ERROR');
  });

  it('should register and emit events', () => {
    let received = '';
    bus.onKey('test.event', (...args: unknown[]) => {
      received = args[0] as string;
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
    bus.onKey('test.debounce', (...args: unknown[]) => {
      results.push(args[0] as number);
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

  it('should support throttle mode', async () => {
    const results: number[] = [];
    bus.setListenerLimit(10);
    bus.onKey('test.throttle', (...args: unknown[]) => {
      results.push(args[0] as number);
    }, { mode: 'throttle', timing: 50 });

    bus.emit('test.throttle', 1);
    bus.emit('test.throttle', 2);
    bus.emit('test.throttle', 3);

    await new Promise((r) => setTimeout(r, 80));

    // Throttle (leading edge) fires first immediately, then last after delay
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]).toBe(1);
  });

  it('should support onAll with namespace prefix', () => {
    bus = createAdvancedEvent(
      { TEST: { A: '', B: '', C: '' } },
      { enabled: false, maxNamespaceBatchSize: 10 }
    );
    const received: string[] = [];
    const handler = (...args: unknown[]) => received.push(args[0] as string);

    bus.onAll('eventConfig:TEST', handler);
    bus.emit('eventConfig:TEST:A', 'a');
    bus.emit('eventConfig:TEST:B', 'b');
    bus.emit('eventConfig:TEST:C', 'c');

    expect(received).toEqual(['a', 'b', 'c']);
  });

  it('should support offAll with namespace prefix', () => {
    bus = createAdvancedEvent(
      { TEST: { A: '', B: '' } },
      { enabled: false, maxNamespaceBatchSize: 10 }
    );
    let count = 0;
    const handler = () => { count++; };

    bus.onAll('eventConfig:TEST', handler);
    bus.emit('eventConfig:TEST:A');
    expect(count).toBe(1);

    bus.offAll('eventConfig:TEST', handler);
    bus.emit('eventConfig:TEST:B');
    expect(count).toBe(1);
  });

  it('on() with namespace prefix should delegate to onAll', () => {
    bus = createAdvancedEvent(
      { DEMO: { X: '', Y: '' } },
      { enabled: false, maxNamespaceBatchSize: 10 }
    );
    const received: string[] = [];
    bus.on('eventConfig:DEMO', (...args: unknown[]) => received.push(args[0] as string));
    bus.emit('eventConfig:DEMO:X', 'x');
    bus.emit('eventConfig:DEMO:Y', 'y');
    expect(received).toEqual(['x', 'y']);
  });

  it('should allow setting custom deBug function', () => {
    let errorMsg = '';
    bus.setDeBug((msg) => {
      errorMsg = msg;
      throw new Error(msg);
    });
    expect(() => {
      bus.onKey('bad', 'not-a-function' as unknown as () => void);
    }).toThrow();
    expect(errorMsg).toContain('事件处理器必须为函数');
  });

  it('should reject unknown config keys', () => {
    expect(() => {
      createAdvancedEvent({}, { unknownKey: true } as Record<string, unknown>);
    }).toThrow(/未知配置项/);
  });
});

describe('EnhancedPathPrefixMatcher', () => {
  it('should build prefix map from paths', () => {
    const matcher = new EnhancedPathPrefixMatcher(['A:B:C', 'A:B:D', 'X:Y']);
    expect(matcher.isPathPrefix('A')).toBe(true);
    expect(matcher.isPathPrefix('A:B')).toBe(true);
    expect(matcher.isPathPrefix('X')).toBe(true);
    expect(matcher.isPathPrefix('A:B:C')).toBe(false); // full path, not a prefix
  });

  it('should get paths by prefix', () => {
    const matcher = new EnhancedPathPrefixMatcher(['A:B:C', 'A:B:D']);
    const paths = matcher.getPathsByPrefix('A:B');
    expect(paths).toEqual(['A:B:C', 'A:B:D']);
  });

  it('should add and remove paths dynamically', () => {
    const matcher = new EnhancedPathPrefixMatcher(['A:B:C']);
    matcher.addPath('A:B:E');
    expect(matcher.getPathsByPrefix('A:B')).toHaveLength(2);

    matcher.removePath('A:B:C');
    expect(matcher.getPathsByPrefix('A:B')).toEqual(['A:B:E']);
  });

  it('should clear all paths', () => {
    const matcher = new EnhancedPathPrefixMatcher(['A:B:C']);
    matcher.clear();
    expect(matcher.getPaths()).toEqual([]);
    expect(matcher.getAllPrefixes()).toEqual([]);
  });

  it('should not duplicate paths on addPath', () => {
    const matcher = new EnhancedPathPrefixMatcher(['A:B:C']);
    matcher.addPath('A:B:C');
    const paths = matcher.getPathsByPrefix('A:B');
    expect(paths).toEqual(['A:B:C']);
  });

  it('should rebuild prefix map', () => {
    const matcher = new EnhancedPathPrefixMatcher([]);
    matcher.addPath('X:Y:Z');
    matcher.rebuild();
    expect(matcher.isPathPrefix('X:Y')).toBe(true);
  });
});

describe('objectTransformation', () => {
  it('safeObjectsToStrings should convert nested objects to path strings', () => {
    const result = safeObjectsToStrings({ A: { B: 'leaf', C: 'leaf' } });
    expect(result.sort()).toEqual(['A:B', 'A:C']);
  });

  it('safeObjectsToStrings should detect structural conflicts', () => {
    expect(() => {
      safeObjectsToStrings(
        { A: { B: 'leaf' } },
        { A: 'also-leaf' }
      );
    }).toThrow(/结构冲突/);
  });

  it('stringsToObject should convert paths back to nested object', () => {
    const obj = stringsToObject(['A:B', 'A:C']);
    expect(obj).toHaveProperty('A');
    expect((obj.A as Record<string, unknown>).B).toBe('A:B');
    expect((obj.A as Record<string, unknown>).C).toBe('A:C');
  });

  it('stringsToObject should reject leaf-then-child conflicts', () => {
    expect(() => stringsToObject(['A:B', 'A:B:C'])).toThrow(/路径冲突/);
  });
});
