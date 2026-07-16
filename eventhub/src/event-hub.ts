import { globToRegex } from './utils/glob';
import type { SubscribeOptions, Unsubscribe, MetaEventPayloads } from './core/types';

type AnyHandler = (...args: unknown[]) => void;

interface CancellableWrapper extends AnyHandler {
  _cancelled?: boolean;
  _timer?: ReturnType<typeof setTimeout>;
}

// === throttle 策略 ===

function wrapThrottleBoth(fn: AnyHandler, ms: number): CancellableWrapper {
  let lastTime = 0;
  let lastArgs: unknown[] = [];
  const wrapped: CancellableWrapper = (...args: unknown[]) => {
    const now = Date.now();
    if (now - lastTime >= ms) {
      lastTime = now;
      if (wrapped._timer !== undefined) { clearTimeout(wrapped._timer); wrapped._timer = undefined; }
      if (!wrapped._cancelled) fn(...args);
    } else {
      lastArgs = args;
      if (wrapped._timer === undefined) {
        wrapped._timer = setTimeout(() => {
          wrapped._timer = undefined;
          lastTime = Date.now();
          if (!wrapped._cancelled) fn(...lastArgs);
        }, ms - (now - lastTime));
      }
    }
  };
  return wrapped;
}

function wrapThrottleLeading(fn: AnyHandler, ms: number): CancellableWrapper {
  let lastTime = 0;
  const wrapped: CancellableWrapper = (...args: unknown[]) => {
    const now = Date.now();
    if (now - lastTime >= ms) {
      lastTime = now;
      if (!wrapped._cancelled) fn(...args);
    }
  };
  return wrapped;
}

function wrapThrottleTrailing(fn: AnyHandler, ms: number): CancellableWrapper {
  let lastTime = 0;
  let lastArgs: unknown[] = [];
  const wrapped: CancellableWrapper = (...args: unknown[]) => {
    lastArgs = args;
    if (wrapped._timer !== undefined) return;
    const elapsed = Date.now() - lastTime;
    const delay = lastTime === 0 ? ms : Math.max(0, ms - elapsed);
    wrapped._timer = setTimeout(() => {
      wrapped._timer = undefined;
      lastTime = Date.now();
      if (!wrapped._cancelled) fn(...lastArgs);
    }, delay);
  };
  return wrapped;
}

function wrapDebounce(fn: AnyHandler, ms: number): CancellableWrapper {
  const wrapped: CancellableWrapper = (...args: unknown[]) => {
    if (wrapped._timer !== undefined) clearTimeout(wrapped._timer);
    wrapped._timer = setTimeout(() => {
      wrapped._timer = undefined;
      if (!wrapped._cancelled) fn(...args);
    }, ms);
  };
  return wrapped;
}

// === 内部类型 ===

interface HandlerRecord {
  raw: AnyHandler;
  original: AnyHandler;
}

interface WildcardRecord {
  pattern: string;
  regex: RegExp;
  record: HandlerRecord;
}

export interface EventHubOptions {
  delimiter?: string;
  /**
   * 批量移除 (offAll) 的 meta 事件通知策略：
   * - `'smart'` (默认)：单次移除带 handler；批量移除只带 event，发一次
   * - `'full'`：单次和批量都带 handler，逐条遍历通知
   * - `'lean'`：单次和批量都只带 event，不带 handler
   * - `'simple'`：所有移除都不触发 meta 事件
   */
  metaMode?: 'smart' | 'full' | 'lean' | 'simple';
  /**
   * emit() 中 handler 抛错时的处理策略（仅影响同步 emit，emitSerial 始终 failFast，emitAsync 始终 allSettled）：
   * - `'aggregate'` (默认)：收集全部错误，最后抛 AggregateError
   * - `'failFast'`：第一个错误立刻抛，停止后续 handler
   * - `'silent'`：忽略所有 handler 错误
   */
  emitMode?: 'aggregate' | 'failFast' | 'silent';
  /**
   * emit 时 handler 列表的遍历方式：
   * - `'safe'` (默认)：快照后迭代，emit 期间增删不影响当前循环
   * - `'fast'`：直接迭代，无额外分配，但 handler 中 unsubscribe 自身会跳过下一个
   */
  emitSafety?: 'safe' | 'fast';
  /**
   * listener 超过 maxListeners 时的行为：
   * - `'warn'` (默认)：console.warn 一次
   * - `'throw'`：抛错
   * - `'silent'`：忽略
   * - `(event, count) => void`：自定义回调
   */
  maxListenersAction?: 'warn' | 'throw' | 'silent' | ((event: string, count: number) => void);
}

const META_EVENT_NAMES = new Set([
  'beforeListenerAdd',
  'beforeListenerRemove',
  'listenerAdded',
  'listenerRemoved',
]);

export class EventHub<T = Record<string, unknown>> {
  #handlers = new Map<string, HandlerRecord[]>();
  #anyHandlers: HandlerRecord[] = [];
  #wildcardHandlers: WildcardRecord[] = [];
  #regexCache = new Map<string, RegExp>();
  #destroyed = false;
  #emittingMeta = false;
  #maxListeners: number = Infinity;
  #warned = new Set<string>();
  #delimiter: string;
  #metaMode: 'smart' | 'full' | 'lean' | 'simple';

  // 惰性函数
  #removeHandler: (event: string, list: HandlerRecord[], record: HandlerRecord) => void;
  #removeAllHandlers: (event: string, list: HandlerRecord[]) => void;
  #doEmit: (event: string, payload: unknown) => void;
  #doEmitSerial: (event: string, payload: unknown) => Promise<void>;
  #doEmitAsync: (event: string, payload: unknown) => Promise<PromiseSettledResult<unknown>[]>;
  #onMaxListenersExceeded: (event: string, count: number) => void;
  #noop = (..._args: unknown[]): void => {};

  constructor(options?: EventHubOptions) {
    this.#delimiter = options?.delimiter ?? ':./';
    this.#metaMode = options?.metaMode ?? 'smart';

    // -- metaMode --
    if (this.#metaMode === 'simple') {
      this.#removeHandler = this.#removeSingleSilent;
      this.#removeAllHandlers = this.#removeAllSilent;
    } else if (this.#metaMode === 'full') {
      this.#removeHandler = this.#removeSingleWithMeta;
      this.#removeAllHandlers = this.#removeAllFull;
    } else if (this.#metaMode === 'lean') {
      this.#removeHandler = this.#removeSingleLean;
      this.#removeAllHandlers = this.#removeAllSmart;
    } else {
      this.#removeHandler = this.#removeSingleWithMeta;
      this.#removeAllHandlers = this.#removeAllSmart;
    }

    // -- emitSafety --
    const safety = options?.emitSafety ?? 'safe';
    const fast = safety === 'fast';

    // -- emitMode --
    const emode = options?.emitMode ?? 'aggregate';
    if (fast && emode === 'failFast') {
      this.#doEmit = this.#emitFailFastFast;
    } else if (fast && emode === 'silent') {
      this.#doEmit = this.#emitSilentFast;
    } else if (fast) {
      this.#doEmit = this.#emitAggregateFast;
    } else if (emode === 'failFast') {
      this.#doEmit = this.#emitFailFastSafe;
    } else if (emode === 'silent') {
      this.#doEmit = this.#emitSilentSafe;
    } else {
      this.#doEmit = this.#emitAggregateSafe;
    }

    this.#doEmitSerial = fast ? this.#emitSerialFast : this.#emitSerialSafe;
    this.#doEmitAsync = fast ? this.#emitAsyncFast : this.#emitAsyncSafe;

    // -- maxListenersAction --
    const maxAction = options?.maxListenersAction ?? 'warn';
    if (typeof maxAction === 'function') {
      this.#onMaxListenersExceeded = (event: string, count: number) => {
        if (count > this.#maxListeners) maxAction(event, count);
      };
    } else if (maxAction === 'throw') {
      this.#onMaxListenersExceeded = (event: string, count: number) => {
        if (count > this.#maxListeners) {
          throw new Error(
            `[@nimble-api/eventhub] MaxListenersExceeded: ${count} listeners on "${event}". Use setMaxListeners() to increase limit.`,
          );
        }
      };
    } else if (maxAction === 'silent') {
      this.#onMaxListenersExceeded = this.#noop as (event: string, count: number) => void;
    } else {
      this.#onMaxListenersExceeded = (event: string, count: number) => {
        if (count > this.#maxListeners && !this.#warned.has(event)) {
          this.#warned.add(event);
          console.warn(
            `[@nimble-api/eventhub] MaxListenersExceededWarning: Possible EventHub memory leak detected. ` +
            `${count} listeners added to "${event}". Use setMaxListeners() to increase limit.`,
          );
        }
      };
    }
  }

  // === 订阅 ===

  on<K extends keyof T & string>(
    event: K,
    handler: (payload: T[K]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    const raw = this.#wrapHandler(handler as AnyHandler, opts);
    const record: HandlerRecord = { raw, original: handler as AnyHandler };

    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, []);
    }
    this.#addHandler(event, this.#handlers.get(event)!, record, 'push');

    const unsub = (): void => {
      const handlers = this.#handlers.get(event);
      if (handlers) {
        this.#removeHandler(event, handlers, record);
        if (handlers.length === 0) this.#handlers.delete(event);
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  prependListener<K extends keyof T & string>(
    event: K,
    handler: (payload: T[K]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    const raw = this.#wrapHandler(handler as AnyHandler, opts);
    const record: HandlerRecord = { raw, original: handler as AnyHandler };

    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, []);
    }
    this.#addHandler(event, this.#handlers.get(event)!, record, 'unshift');

    const unsub = (): void => {
      const handlers = this.#handlers.get(event);
      if (handlers) {
        this.#removeHandler(event, handlers, record);
        if (handlers.length === 0) this.#handlers.delete(event);
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  onPattern(
    pattern: string,
    handler: (event: string, payload: T[keyof T]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    let regex = this.#regexCache.get(pattern);
    if (!regex) {
      regex = globToRegex(pattern, this.#delimiter);
      this.#regexCache.set(pattern, regex);
    }
    const raw = this.#wrapHandler(handler as AnyHandler, opts);
    const record: HandlerRecord = { raw, original: handler as AnyHandler };
    const wc: WildcardRecord = { pattern, regex, record };

    if (!this.#emittingMeta) {
      this.#emitMeta('beforeListenerAdd', { event: pattern, handler: record.original }, { throwOnError: true });
    }
    if (this.#maxListeners !== Infinity) {
      const pending = this.listenerCount(pattern as keyof T & string) + 1;
      if (pending > this.#maxListeners) this.#onMaxListenersExceeded(pattern, pending);
    }
    this.#wildcardHandlers.push(wc);
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerAdded', { event: pattern });
    }

    const unsub = (): void => {
      const idx = this.#wildcardHandlers.indexOf(wc);
      if (idx !== -1) {
        if (this.#metaMode !== 'simple' && !this.#emittingMeta) {
          this.#emitMeta('beforeListenerRemove',
            this.#metaMode === 'lean' ? { event: pattern } : { event: pattern, handler: wc.record.original },
            { throwOnError: true });
        }
        this.#cancelHandler(this.#wildcardHandlers[idx].record);
        this.#wildcardHandlers.splice(idx, 1);
        if (this.#metaMode !== 'simple' && !this.#emittingMeta) {
          this.#emitMeta('listenerRemoved', { event: pattern });
        }
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  onAny(
    handler: (event: keyof T & string, payload: T[keyof T]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    const raw = this.#wrapHandler(handler as AnyHandler, opts);
    const record: HandlerRecord = { raw, original: handler as AnyHandler };

    if (!this.#emittingMeta) {
      this.#emitMeta('beforeListenerAdd', { event: '*', handler: record.original }, { throwOnError: true });
    }
    if (this.#maxListeners !== Infinity) {
      const pending = this.listenerCount('*' as keyof T & string) + 1;
      if (pending > this.#maxListeners) this.#onMaxListenersExceeded('*', pending);
    }
    this.#anyHandlers.push(record);
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerAdded', { event: '*' });
    }

    const unsub = (): void => {
      const idx = this.#anyHandlers.indexOf(record);
      if (idx !== -1) {
        if (this.#metaMode !== 'simple' && !this.#emittingMeta) {
          this.#emitMeta('beforeListenerRemove',
            this.#metaMode === 'lean' ? { event: '*' } : { event: '*', handler: record.original },
            { throwOnError: true });
        }
        this.#cancelHandler(this.#anyHandlers[idx]);
        this.#anyHandlers.splice(idx, 1);
        if (this.#metaMode !== 'simple' && !this.#emittingMeta) {
          this.#emitMeta('listenerRemoved', { event: '*' });
        }
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  // === 一次性 ===

  once<K extends keyof T & string>(
    event: K,
    opts?: { signal?: AbortSignal; timeout?: number; filter?: (payload: T[K]) => boolean },
  ): Promise<T[K]> {
    this.#checkDestroyed();

    const signal = opts?.signal;
    if (signal?.aborted) {
      const err = new Error('[@nimble-api/eventhub] once() aborted');
      err.name = 'AbortError';
      return Promise.reject(err);
    }

    return new Promise<T[K]>((resolve, reject) => {
      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      let settled = false;
      const onAbort = (): void => {
        if (settled) return;
        settled = true;
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        unsub();
        const err = new Error('[@nimble-api/eventhub] once() aborted');
        err.name = 'AbortError';
        reject(err);
      };

      const unsub = this.on(
        event,
        (payload) => {
          if (opts?.filter && !opts.filter(payload)) return;
          settled = true;
          if (timeoutId !== undefined) clearTimeout(timeoutId);
          unsub();
          if (signal) signal.removeEventListener('abort', onAbort);
          resolve(payload);
        },
      );

      if (opts?.timeout != null) {
        timeoutId = setTimeout(() => {
          if (settled) return;
          settled = true;
          unsub();
          if (signal) signal.removeEventListener('abort', onAbort);
          const err = new Error('[@nimble-api/eventhub] once() timed out');
          err.name = 'TimeoutError';
          reject(err);
        }, opts.timeout);
      }

      // 先检查再 addEventListener 的模式在单线程 JS 中不存在竞态窗口（abort 只能通过 microtask/macrotask 触发）。先监听再检查的模式也可以，但当前顺序等价且更直观。
      if (signal) {
        if (signal.aborted) {
          onAbort();
        } else {
          signal.addEventListener('abort', onAbort, { once: true });
        }
      }
    });
  }

  many<K extends keyof T & string>(
    event: K,
    n: number,
    handler: (payload: T[K]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (n <= 0) throw new TypeError(`[@nimble-api/eventhub] many() n must be > 0, got ${n}`);
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    let count = 0;

    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, []);
    }

    const wrapped: HandlerRecord = {} as HandlerRecord;

    const innerHandler = ((payload: T[K]) => {
      handler(payload);
      count++;
      if (count >= n) {
        const handlers = this.#handlers.get(event);
        if (handlers) {
          this.#removeHandler(event, handlers, wrapped);
          if (handlers.length === 0) this.#handlers.delete(event);
        }
      }
    }) as AnyHandler;

    wrapped.raw = this.#wrapHandler(innerHandler, opts);
    wrapped.original = handler as AnyHandler;

    this.#addHandler(event, this.#handlers.get(event)!, wrapped, 'push');

    const unsub = (): void => {
      const handlers = this.#handlers.get(event);
      if (handlers) {
        this.#removeHandler(event, handlers, wrapped);
        if (handlers.length === 0) this.#handlers.delete(event);
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  prependOnceListener<K extends keyof T & string>(
    event: K,
    handler: (payload: T[K]) => void,
    opts?: SubscribeOptions,
  ): Unsubscribe {
    this.#checkDestroyed();
    if (typeof handler !== 'function') {
      throw new TypeError(`[@nimble-api/eventhub] Handler must be a function, got ${typeof handler}`);
    }

    if (!this.#handlers.has(event)) {
      this.#handlers.set(event, []);
    }

    const record: HandlerRecord = {} as HandlerRecord;

    let fired = false;
    const onceWrapper = ((payload: T[K]) => {
      if (fired) return;
      fired = true;
      handler(payload);
      const handlers = this.#handlers.get(event);
      if (handlers) {
        this.#removeHandler(event, handlers, record);
        if (handlers.length === 0) this.#handlers.delete(event);
      }
    }) as AnyHandler;

    record.raw = this.#wrapHandler(onceWrapper, opts);
    record.original = handler as AnyHandler;

    this.#addHandler(event, this.#handlers.get(event)!, record, 'unshift');

    const unsub = (): void => {
      const handlers = this.#handlers.get(event);
      if (handlers) {
        this.#removeHandler(event, handlers, record);
        if (handlers.length === 0) this.#handlers.delete(event);
      }
    };

    if (opts?.signal) {
      opts.signal.addEventListener('abort', unsub, { once: true });
    }

    return unsub;
  }

  // === 取消订阅 ===

  off<K extends keyof T & string>(
    event: K,
    handler: (payload: T[K]) => void,
  ): void {
    if (this.#destroyed) return;
    const handlers = this.#handlers.get(event);
    if (!handlers) return;

    for (let i = 0; i < handlers.length; i++) {
      if (handlers[i].original === (handler as AnyHandler)) {
        this.#removeHandler(event, handlers, handlers[i]);
        if (handlers.length === 0) this.#handlers.delete(event);
        return;
      }
    }
  }

  offAll(): void;
  offAll(event: keyof T & string): void;
  offAll(event: keyof T & string, handler: (payload: T[keyof T]) => void): void;
  offAll(event?: keyof T & string, handler?: (payload: T[keyof T]) => void): void {
    if (this.#destroyed) return;

    // offAll(event, handler) — remove all matching handlers (exact + wildcard)
    if (event !== undefined && handler !== undefined) {
      const handlers = this.#handlers.get(event);
      if (handlers) {
        for (let i = handlers.length - 1; i >= 0; i--) {
          if (handlers[i].original === handler) {
            this.#removeHandler(event, handlers, handlers[i]);
          }
        }
        if (handlers.length === 0) this.#handlers.delete(event);
      }

      // Wildcard: match by regex + handler reference
      for (let i = this.#wildcardHandlers.length - 1; i >= 0; i--) {
        const wc = this.#wildcardHandlers[i];
        if (wc.regex.test(event) && wc.record.original === handler) {
          if (this.#metaMode !== 'simple' && !this.#emittingMeta) {
            this.#emitMeta('beforeListenerRemove',
              this.#metaMode === 'lean' ? { event: wc.pattern } : { event: wc.pattern, handler: wc.record.original },
              { throwOnError: true });
          }
          this.#cancelHandler(wc.record);
          this.#wildcardHandlers.splice(i, 1);
          if (this.#metaMode !== 'simple' && !this.#emittingMeta) {
            this.#emitMeta('listenerRemoved', { event: wc.pattern });
          }
        }
      }
      return;
    }

    if (event) {
      const handlers = this.#handlers.get(event);
      if (handlers && handlers.length > 0) {
        this.#removeAllHandlers(event, handlers);
      }
      this.#handlers.delete(event);

      for (let i = this.#wildcardHandlers.length - 1; i >= 0; i--) {
        if (this.#wildcardHandlers[i].regex.test(event)) {
          const wc = this.#wildcardHandlers[i];
          if (this.#metaMode !== 'simple' && !this.#emittingMeta) {
            this.#emitMeta('beforeListenerRemove',
              this.#metaMode === 'lean' ? { event } : { event, handler: wc.record.original },
              { throwOnError: true });
          }
          this.#cancelHandler(wc.record);
          this.#wildcardHandlers.splice(i, 1);
          if (this.#metaMode !== 'simple' && !this.#emittingMeta) {
            this.#emitMeta('listenerRemoved', { event });
          }
        }
      }
    } else {
      for (const [eventName, handlers] of this.#handlers) {
        if (META_EVENT_NAMES.has(eventName)) {
          for (const record of handlers) this.#cancelHandler(record);
        } else if (handlers.length > 0) {
          this.#removeAllHandlers(eventName, handlers);
        }
      }

      // Process wildcard and any-handlers BEFORE clearing #handlers so meta event
      // listeners (beforeListenerRemove / listenerRemoved) can still receive events.
      for (const wh of this.#wildcardHandlers) {
        if (this.#metaMode !== 'simple' && !this.#emittingMeta) {
          this.#emitMeta('beforeListenerRemove',
            this.#metaMode === 'full' ? { event: wh.pattern, handler: wh.record.original } : { event: wh.pattern });
        }
        this.#cancelHandler(wh.record);
        if (this.#metaMode !== 'simple' && !this.#emittingMeta) {
          this.#emitMeta('listenerRemoved', { event: wh.pattern });
        }
      }
      this.#wildcardHandlers.length = 0;

      if (this.#anyHandlers.length > 0) {
        this.#removeAllHandlers('*', this.#anyHandlers);
      }

      this.#handlers.clear();
    }
  }

  // === 发射 ===

  emit<K extends keyof T & string>(event: K, payload: T[K]): void {
    this.#checkDestroyed();
    this.#doEmit(event as string, payload);
  }

  async emitSerial<K extends keyof T & string>(event: K, payload: T[K]): Promise<void> {
    this.#checkDestroyed();
    await this.#doEmitSerial(event as string, payload);
  }

  async emitAsync<K extends keyof T & string>(
    event: K,
    payload: T[K],
  ): Promise<PromiseSettledResult<unknown>[]> {
    this.#checkDestroyed();
    return this.#doEmitAsync(event as string, payload);
  }

  // === Promise 等待 ===

  waitFor<K extends keyof T & string>(
    event: K,
    opts?: { signal?: AbortSignal; timeout?: number; filter?: (payload: T[K]) => boolean },
  ): Promise<T[K]> {
    return this.once(event, opts);
  }

  // === AsyncIterable ===

  events<K extends keyof T & string>(
    event: K,
    opts?: {
      signal?: AbortSignal;
      /** Buffer 最大容量。0 表示无限制（慎用）。默认 1000。 */
      bufferMax?: number;
      /** Buffer 满时的策略。默认 `'dropOldest'` (FIFO)。 */
      bufferOverflow?: 'dropOldest' | 'dropNewest';
    },
  ): AsyncIterable<T[K]> {
    const maxBuffer = opts?.bufferMax ?? 1000;
    const overflow = opts?.bufferOverflow ?? 'dropOldest';

    return {
      [Symbol.asyncIterator]: (): AsyncIterator<T[K]> => {
        const queue: T[K][] = [];
        let resolveNext: ((v: IteratorResult<T[K]>) => void) | null = null;
        let done = false;

        const complete = (): void => {
          done = true;
          unsub();
          if (resolveNext) {
            resolveNext({ value: undefined, done: true });
            resolveNext = null;
          }
        };

        const unsub = this.on(
          event,
          (payload: T[K]) => {
            if (resolveNext) {
              resolveNext({ value: payload, done: false });
              resolveNext = null;
            } else {
              if (maxBuffer > 0 && queue.length >= maxBuffer) {
                if (overflow === 'dropNewest') return;
                queue.shift();
              }
              queue.push(payload);
            }
          },
          { signal: opts?.signal },
        );

        if (opts?.signal) {
          if (opts.signal.aborted) {
            complete();
          } else {
            opts.signal.addEventListener('abort', complete, { once: true });
          }
        }

        return {
          async next(): Promise<IteratorResult<T[K]>> {
            if (queue.length > 0) return { value: queue.shift()!, done: false };
            if (done) return { value: undefined, done: true };
            return new Promise<IteratorResult<T[K]>>((resolve) => { resolveNext = resolve; });
          },
          async return(): Promise<IteratorResult<T[K]>> {
            complete();
            return { value: undefined, done: true };
          },
        };
      },
    };
  }

  // === 查询 ===

  listeners<K extends keyof T & string>(event?: K): ((payload: T[K]) => void)[] {
    if (this.#destroyed) return [];

    if (event) {
      const result: AnyHandler[] = [];
      const handlers = this.#handlers.get(event);
      if (handlers) {
        for (const rec of handlers) result.push(rec.original);
      }
      for (const wh of this.#wildcardHandlers) {
        if (wh.regex.test(event)) result.push(wh.record.original);
      }
      return result as ((payload: T[K]) => void)[];
    }

    const result: AnyHandler[] = [];
    for (const handlers of this.#handlers.values()) {
      for (const rec of handlers) result.push(rec.original);
    }
    for (const wh of this.#wildcardHandlers) {
      result.push(wh.record.original);
    }
    for (const rec of this.#anyHandlers) {
      result.push(rec.original);
    }
    return result as ((payload: T[K]) => void)[];
  }

  rawListeners<K extends keyof T & string>(event?: K): ((payload: T[K]) => void)[] {
    if (this.#destroyed) return [];

    if (event) {
      const result: AnyHandler[] = [];
      const handlers = this.#handlers.get(event);
      if (handlers) {
        for (const rec of handlers) result.push(rec.raw);
      }
      for (const wh of this.#wildcardHandlers) {
        if (wh.regex.test(event)) result.push(wh.record.raw);
      }
      return result as ((payload: T[K]) => void)[];
    }

    const result: AnyHandler[] = [];
    for (const handlers of this.#handlers.values()) {
      for (const rec of handlers) result.push(rec.raw);
    }
    for (const wh of this.#wildcardHandlers) {
      result.push(wh.record.raw);
    }
    for (const rec of this.#anyHandlers) {
      result.push(rec.raw);
    }
    return result as ((payload: T[K]) => void)[];
  }

  listenerCount(event?: keyof T & string): number {
    if (this.#destroyed) return 0;
    if (event) {
      let count = this.#handlers.get(event)?.length ?? 0;
      for (const wh of this.#wildcardHandlers) {
        if (wh.regex.test(event)) count++;
      }
      return count;
    }
    let total = this.#anyHandlers.length + this.#wildcardHandlers.length;
    for (const handlers of this.#handlers.values()) {
      total += handlers.length;
    }
    return total;
  }

  hasListeners(event?: keyof T & string): boolean {
    if (this.#destroyed) return false;
    if (event) {
      if ((this.#handlers.get(event)?.length ?? 0) > 0) return true;
      for (const wh of this.#wildcardHandlers) {
        if (wh.regex.test(event)) return true;
      }
      // any-handlers are counted here (emit would call them) even though
      // listeners(event) cannot return them due to signature mismatch.
      return this.#anyHandlers.length > 0;
    }
    if (this.#anyHandlers.length > 0 || this.#wildcardHandlers.length > 0) return true;
    for (const handlers of this.#handlers.values()) {
      if (handlers.length > 0) return true;
    }
    return false;
  }

  eventNames(): (keyof T & string)[] {
    if (this.#destroyed) return [];
    const names = [...this.#handlers.keys()] as (keyof T & string)[];
    for (const wh of this.#wildcardHandlers) {
      names.push(wh.pattern as keyof T & string);
    }
    return names;
  }

  setMaxListeners(n: number): void {
    this.#maxListeners = n;
  }

  getMaxListeners(): number {
    return this.#maxListeners;
  }

  // === 流控链 ===

  debounce(ms: number) {
    return {
      on: <K extends keyof T & string>(
        event: K, handler: (payload: T[K]) => void, opts?: SubscribeOptions,
      ) => this.on(event, handler, { ...opts, debounce: ms }),
      onPattern: (
        pattern: string, handler: (event: string, payload: T[keyof T]) => void, opts?: SubscribeOptions,
      ) => this.onPattern(pattern, handler, { ...opts, debounce: ms }),
      onAny: (
        handler: (event: keyof T & string, payload: T[keyof T]) => void, opts?: SubscribeOptions,
      ) => this.onAny(handler, { ...opts, debounce: ms }),
    };
  }

  throttle(ms: number, opts?: { edge?: 'both' | 'leading' | 'trailing' }) {
    return {
      on: <K extends keyof T & string>(
        event: K, handler: (payload: T[K]) => void, subOpts?: SubscribeOptions,
      ) => this.on(event, handler, { ...subOpts, throttle: ms, throttleEdge: opts?.edge }),
      onPattern: (
        pattern: string, handler: (event: string, payload: T[keyof T]) => void, subOpts?: SubscribeOptions,
      ) => this.onPattern(pattern, handler, { ...subOpts, throttle: ms, throttleEdge: opts?.edge }),
      onAny: (
        handler: (event: keyof T & string, payload: T[keyof T]) => void, subOpts?: SubscribeOptions,
      ) => this.onAny(handler, { ...subOpts, throttle: ms, throttleEdge: opts?.edge }),
    };
  }

  // === 生命周期 ===

  clear(): void {
    for (const arr of this.#handlers.values()) {
      for (const record of arr) this.#cancelHandler(record);
    }
    for (const record of this.#anyHandlers) this.#cancelHandler(record);
    for (const wh of this.#wildcardHandlers) this.#cancelHandler(wh.record);
    this.#handlers.clear();
    this.#anyHandlers.length = 0;
    this.#wildcardHandlers.length = 0;
    this.#warned.clear();
    this.#regexCache.clear();
  }

  dispose(): void {
    this.#destroyed = true;
    for (const arr of this.#handlers.values()) {
      for (const record of arr) this.#cancelHandler(record);
    }
    for (const record of this.#anyHandlers) this.#cancelHandler(record);
    for (const wh of this.#wildcardHandlers) this.#cancelHandler(wh.record);
    this.#handlers.clear();
    this.#anyHandlers.length = 0;
    this.#wildcardHandlers.length = 0;
    this.#warned.clear();
    this.#regexCache.clear();
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  // === emit 实现（惰性赋值给 #doEmit / #doEmitSerial / #doEmitAsync）====

  // -- safe (snapshot) --
  #emitAggregateSafe(event: string, payload: unknown): void {
    const specific = this.#handlers.get(event);
    const specSnap = specific ? specific.slice() : [];
    const wildSnap = this.#wildcardHandlers.length > 0 ? this.#wildcardHandlers.slice() : [];
    const anySnap = this.#anyHandlers.length > 0 ? this.#anyHandlers.slice() : [];
    const errors: unknown[] = [];

    for (const r of specSnap) { try { r.raw(payload); } catch (e) { errors.push(e); } }
    for (const wh of wildSnap) {
      if (!wh.regex.test(event)) continue;
      try { wh.record.raw(event, payload); } catch (e) { errors.push(e); }
    }
    for (const r of anySnap) { try { r.raw(event, payload); } catch (e) { errors.push(e); } }

    if (errors.length > 0) {
      throw new AggregateError(errors, `[@nimble-api/eventhub] ${errors.length} handler(s) threw errors for "${event}"`);
    }
  }

  #emitFailFastSafe(event: string, payload: unknown): void {
    const specific = this.#handlers.get(event);
    const specSnap = specific ? specific.slice() : [];
    const wildSnap = this.#wildcardHandlers.length > 0 ? this.#wildcardHandlers.slice() : [];
    const anySnap = this.#anyHandlers.length > 0 ? this.#anyHandlers.slice() : [];

    for (const r of specSnap) r.raw(payload);
    for (const wh of wildSnap) {
      if (wh.regex.test(event)) wh.record.raw(event, payload);
    }
    for (const r of anySnap) r.raw(event, payload);
  }

  #emitSilentSafe(event: string, payload: unknown): void {
    const specific = this.#handlers.get(event);
    const specSnap = specific ? specific.slice() : [];
    const wildSnap = this.#wildcardHandlers.length > 0 ? this.#wildcardHandlers.slice() : [];
    const anySnap = this.#anyHandlers.length > 0 ? this.#anyHandlers.slice() : [];

    for (const r of specSnap) { try { r.raw(payload); } catch { /* silent */ } }
    for (const wh of wildSnap) {
      if (!wh.regex.test(event)) continue;
      try { wh.record.raw(event, payload); } catch { /* silent */ }
    }
    for (const r of anySnap) { try { r.raw(event, payload); } catch { /* silent */ } }
  }

  // -- fast (no snapshot) --
  #emitAggregateFast(event: string, payload: unknown): void {
    const specific = this.#handlers.get(event);
    const errors: unknown[] = [];

    if (specific) { for (const r of specific) { try { r.raw(payload); } catch (e) { errors.push(e); } } }
    for (const wh of this.#wildcardHandlers) {
      if (!wh.regex.test(event)) continue;
      try { wh.record.raw(event, payload); } catch (e) { errors.push(e); }
    }
    for (const r of this.#anyHandlers) { try { r.raw(event, payload); } catch (e) { errors.push(e); } }

    if (errors.length > 0) {
      throw new AggregateError(errors, `[@nimble-api/eventhub] ${errors.length} handler(s) threw errors for "${event}"`);
    }
  }

  #emitFailFastFast(event: string, payload: unknown): void {
    const specific = this.#handlers.get(event);
    if (specific) { for (const r of specific) r.raw(payload); }
    for (const wh of this.#wildcardHandlers) {
      if (wh.regex.test(event)) wh.record.raw(event, payload);
    }
    for (const r of this.#anyHandlers) r.raw(event, payload);
  }

  #emitSilentFast(event: string, payload: unknown): void {
    const specific = this.#handlers.get(event);
    if (specific) { for (const r of specific) { try { r.raw(payload); } catch { /* silent */ } } }
    for (const wh of this.#wildcardHandlers) {
      if (!wh.regex.test(event)) continue;
      try { wh.record.raw(event, payload); } catch { /* silent */ }
    }
    for (const r of this.#anyHandlers) { try { r.raw(event, payload); } catch { /* silent */ } }
  }

  // -- emitSerial --
  async #emitSerialSafe(event: string, payload: unknown): Promise<void> {
    const specific = this.#handlers.get(event);
    const specSnap = specific ? specific.slice() : [];
    const wildSnap = this.#wildcardHandlers.slice();
    const anySnap = this.#anyHandlers.slice();

    for (const r of specSnap) await r.raw(payload);
    for (const wh of wildSnap) {
      if (wh.regex.test(event)) await wh.record.raw(event, payload);
    }
    for (const r of anySnap) await r.raw(event, payload);
  }

  async #emitSerialFast(event: string, payload: unknown): Promise<void> {
    const specific = this.#handlers.get(event);
    if (specific) { for (const r of specific) await r.raw(payload); }
    for (const wh of this.#wildcardHandlers) {
      if (wh.regex.test(event)) await wh.record.raw(event, payload);
    }
    for (const r of this.#anyHandlers) await r.raw(event, payload);
  }

  // -- emitAsync --
  async #emitAsyncSafe(event: string, payload: unknown): Promise<PromiseSettledResult<unknown>[]> {
    const specific = this.#handlers.get(event);
    const specSnap = specific ? specific.slice() : [];
    const wildSnap = this.#wildcardHandlers.slice();
    const anySnap = this.#anyHandlers.slice();
    const promises: Promise<unknown>[] = [];

    for (const r of specSnap) promises.push(Promise.resolve().then(() => r.raw(payload)));
    for (const wh of wildSnap) {
      if (wh.regex.test(event)) promises.push(Promise.resolve().then(() => wh.record.raw(event, payload)));
    }
    for (const r of anySnap) promises.push(Promise.resolve().then(() => r.raw(event, payload)));

    return Promise.allSettled(promises);
  }

  async #emitAsyncFast(event: string, payload: unknown): Promise<PromiseSettledResult<unknown>[]> {
    const specific = this.#handlers.get(event);
    const promises: Promise<unknown>[] = [];

    if (specific) { for (const r of specific) promises.push(Promise.resolve().then(() => r.raw(payload))); }
    for (const wh of this.#wildcardHandlers) {
      if (wh.regex.test(event)) promises.push(Promise.resolve().then(() => wh.record.raw(event, payload)));
    }
    for (const r of this.#anyHandlers) promises.push(Promise.resolve().then(() => r.raw(event, payload)));

    return Promise.allSettled(promises);
  }

  // === metaMode 实现（构造时赋值给 #removeHandler / #removeAllHandlers）====

  #removeSingleWithMeta(event: string, list: HandlerRecord[], record: HandlerRecord): void {
    const idx = list.indexOf(record);
    if (idx === -1) return;
    if (!this.#emittingMeta) {
      this.#emitMeta('beforeListenerRemove', { event, handler: record.original }, { throwOnError: true });
    }
    this.#cancelHandler(list[idx]);
    list.splice(idx, 1);
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerRemoved', { event });
    }
  }

  #removeSingleLean(event: string, list: HandlerRecord[], record: HandlerRecord): void {
    const idx = list.indexOf(record);
    if (idx === -1) return;
    if (!this.#emittingMeta) {
      this.#emitMeta('beforeListenerRemove', { event });
    }
    this.#cancelHandler(list[idx]);
    list.splice(idx, 1);
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerRemoved', { event });
    }
  }

  #removeSingleSilent(_event: string, list: HandlerRecord[], record: HandlerRecord): void {
    const idx = list.indexOf(record);
    if (idx === -1) return;
    this.#cancelHandler(list[idx]);
    list.splice(idx, 1);
  }

  #removeAllSmart(event: string, list: HandlerRecord[]): void {
    if (list.length === 0) return;
    if (!this.#emittingMeta) {
      this.#emitMeta('beforeListenerRemove', { event });
    }
    for (const record of list) this.#cancelHandler(record);
    list.length = 0;
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerRemoved', { event });
    }
  }

  #removeAllFull(event: string, list: HandlerRecord[]): void {
    if (list.length === 0) return;
    const records = list.slice();
    for (const record of records) {
      if (!this.#emittingMeta) {
        this.#emitMeta('beforeListenerRemove', { event, handler: record.original }, { throwOnError: true });
      }
      this.#cancelHandler(record);
      if (!this.#emittingMeta) {
        this.#emitMeta('listenerRemoved', { event });
      }
    }
    list.length = 0;
  }

  #removeAllSilent(_event: string, list: HandlerRecord[]): void {
    if (list.length === 0) return;
    for (const record of list) this.#cancelHandler(record);
    list.length = 0;
  }

  // === 其他辅助方法 ===

  #addHandler(
    event: string,
    list: HandlerRecord[],
    record: HandlerRecord,
    pos: 'push' | 'unshift',
  ): void {
    if (!this.#emittingMeta) {
      this.#emitMeta('beforeListenerAdd', { event, handler: record.original }, { throwOnError: true });
    }
    // Check max listeners BEFORE push — if maxListenersAction is 'throw',
    // the error propagates before the handler is in the list (no orphan).
    if (this.#maxListeners !== Infinity) {
      const pending = this.listenerCount(event as keyof T & string) + 1;
      if (pending > this.#maxListeners) {
        this.#onMaxListenersExceeded(event, pending);
      }
    }
    pos === 'unshift' ? list.unshift(record) : list.push(record);
    if (!this.#emittingMeta) {
      this.#emitMeta('listenerAdded', { event });
    }
  }

  #wrapHandler(handler: AnyHandler, opts?: SubscribeOptions): AnyHandler {
    let wrapped = handler;
    if (opts?.throttle != null) {
      const edge = opts?.throttleEdge ?? 'both';
      if (edge === 'leading') {
        wrapped = wrapThrottleLeading(wrapped, opts.throttle);
      } else if (edge === 'trailing') {
        wrapped = wrapThrottleTrailing(wrapped, opts.throttle);
      } else {
        wrapped = wrapThrottleBoth(wrapped, opts.throttle);
      }
    }
    if (opts?.debounce != null) {
      wrapped = wrapDebounce(wrapped, opts.debounce);
    }
    return wrapped;
  }

  #cancelHandler(record: HandlerRecord): void {
    const w = record.raw as CancellableWrapper;
    if (w._cancelled !== undefined) w._cancelled = true;
    if (w._timer !== undefined) {
      clearTimeout(w._timer);
      w._timer = undefined;
    }
  }

  #checkDestroyed(): void {
    if (this.#destroyed) throw new Error('[@nimble-api/eventhub] Instance is destroyed');
  }

  #emitMeta<K extends keyof MetaEventPayloads>(
    event: K,
    payload: MetaEventPayloads[K],
    opts?: { throwOnError?: boolean },
  ): void {
    const handlers = this.#handlers.get(event);
    if (!handlers || handlers.length === 0) return;

    this.#emittingMeta = true;
    try {
      for (const record of handlers.slice()) {
        if (opts?.throwOnError) {
          record.raw(payload);
        } else {
          try { record.raw(payload); } catch { /* meta handler errors are silently ignored */ }
        }
      }
    } finally {
      this.#emittingMeta = false;
    }
  }
}
